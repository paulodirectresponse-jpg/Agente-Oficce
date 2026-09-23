import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { ProviderRepositoryV2 } from './v2DataModel.js';
import { ProviderFallbackRepository, ProviderResilienceManager } from './providerResilience.js';
import { UniversalProviderEngine } from './universalProviderEngine.js';
import type { SecretStore } from './secretStore.js';

class EmptySecrets implements SecretStore {
  async get(): Promise<string | null> { return null; }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
}

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-provider-resilience-'));
  const database = openAgentOfficeDatabase({
    dataDir,
    databasePath: path.join(dataDir, 'office.sqlite'),
    logLevel: 'silent',
  });
  const providers = new ProviderRepositoryV2(database.connection);
  return {
    dataDir,
    database,
    providers,
    cleanup() {
      database.connection.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

describe('Block 2 provider resilience', () => {
  it('persists fallback chains in priority order', () => {
    const f = fixture();
    try {
      f.providers.create({ id: 'primary-a', name: 'Primary', protocol_driver: 'openai_chat', base_url: 'https://primary.invalid', auth_driver: 'none' });
      f.providers.create({ id: 'fallback-a', name: 'Fallback', protocol_driver: 'openai_chat', base_url: 'https://fallback.invalid', auth_driver: 'none' });
      f.providers.create({ id: 'fallback-b', name: 'Fallback 2', protocol_driver: 'openai_chat', base_url: 'https://fallback2.invalid', auth_driver: 'none' });
      const repo = new ProviderFallbackRepository(f.database.connection);
      const saved = repo.replace('primary-a', [
        { target_provider_id: 'fallback-a', target_model: 'model-a' },
        { target_provider_id: 'fallback-b', target_model: 'model-b' },
      ]);
      expect(saved.map(item => item.target_provider_id)).toEqual(['fallback-a', 'fallback-b']);
      expect(repo.list('primary-a', 'primary-model')).toHaveLength(2);
    } finally { f.cleanup(); }
  });

  it('queues on RPM exhaustion and resumes after the rate window', async () => {
    const f = fixture();
    try {
      const provider = f.providers.create({
        id: 'rpm-provider',
        name: 'RPM',
        protocol_driver: 'openai_chat',
        base_url: 'https://rpm.invalid',
        auth_driver: 'none',
        protocol_config: { rpm_limit: 1, rate_window_ms: 120, max_concurrent_requests: 5 },
      });
      const manager = new ProviderResilienceManager(f.database.connection);
      const release = await manager.acquire(provider, 1);
      release();

      const started = Date.now();
      const second = await manager.acquire(provider, 1);
      const elapsed = Date.now() - started;
      second();

      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(manager.snapshot(provider).rpm_used).toBe(1);
    } finally { f.cleanup(); }
  });

  it('opens circuit after retryable failures and exposes runtime state', async () => {
    const f = fixture();
    try {
      const provider = f.providers.create({
        id: 'circuit-provider',
        name: 'Circuit',
        protocol_driver: 'openai_chat',
        base_url: 'https://circuit.invalid',
        auth_driver: 'none',
        protocol_config: { circuit_failure_threshold: 2, circuit_reset_seconds: 30 },
      });
      const manager = new ProviderResilienceManager(f.database.connection);
      const error = Object.assign(new Error('temporary outage'), { code: 'PROVIDER_HTTP_ERROR', status: 503 });
      manager.recordFailure(provider, 'model-x', error);
      manager.recordFailure(provider, 'model-x', error);

      expect(manager.snapshot(provider).circuit_state).toBe('open');
      await expect(manager.acquire(provider, 1)).rejects.toMatchObject({ code: 'PROVIDER_CIRCUIT_OPEN' });
    } finally { f.cleanup(); }
  });

  it('falls back to the configured provider on a retryable provider error', async () => {
    const f = fixture();
    try {
      f.providers.create({
        id: 'primary-fallback',
        name: 'Primary',
        protocol_driver: 'openai_chat',
        base_url: 'https://primary.example',
        auth_driver: 'none',
        protocol_config: { retry_attempts: 0 },
      });
      f.providers.create({
        id: 'secondary-fallback',
        name: 'Secondary',
        protocol_driver: 'openai_chat',
        base_url: 'https://secondary.example',
        auth_driver: 'none',
      });
      f.providers.createModel('primary-fallback', { model_id: 'main-model', enabled: true, is_default: true });
      f.providers.createModel('secondary-fallback', { model_id: 'backup-model', enabled: true, is_default: true });
      new ProviderFallbackRepository(f.database.connection).replace('primary-fallback', [
        { target_provider_id: 'secondary-fallback', target_model: 'backup-model' },
      ]);

      const calls: string[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('primary.example')) {
          return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: 'fallback ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const engine = new UniversalProviderEngine(f.database.connection, new EmptySecrets(), fetchImpl);
      const result = await engine.complete('primary-fallback', {
        model: 'main-model',
        messages: [{ role: 'user', content: 'hello' }],
      });

      expect(result.text).toBe('fallback ok');
      expect(calls.some(url => url.includes('primary.example'))).toBe(true);
      expect(calls.some(url => url.includes('secondary.example'))).toBe(true);
      expect(new ProviderResilienceManager(f.database.connection).snapshot(f.providers.get('primary-fallback')!).operational_status).toMatch(/degraded|unavailable/);
      expect(new ProviderResilienceManager(f.database.connection).snapshot(f.providers.get('secondary-fallback')!).operational_status).toBe('healthy');
    } finally { f.cleanup(); }
  });

  it('does not fallback on authentication failures', async () => {
    const f = fixture();
    try {
      f.providers.create({ id: 'auth-primary', name: 'Auth', protocol_driver: 'openai_chat', base_url: 'https://auth.example', auth_driver: 'none' });
      f.providers.create({ id: 'auth-secondary', name: 'Secondary', protocol_driver: 'openai_chat', base_url: 'https://secondary-auth.example', auth_driver: 'none' });
      f.providers.createModel('auth-primary', { model_id: 'main', enabled: true, is_default: true });
      f.providers.createModel('auth-secondary', { model_id: 'backup', enabled: true, is_default: true });
      new ProviderFallbackRepository(f.database.connection).replace('auth-primary', [
        { target_provider_id: 'auth-secondary', target_model: 'backup' },
      ]);

      let secondaryCalls = 0;
      const fetchImpl: typeof fetch = async (input) => {
        if (String(input).includes('secondary-auth.example')) secondaryCalls += 1;
        return new Response(JSON.stringify({ error: { message: 'bad auth' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      };

      const engine = new UniversalProviderEngine(f.database.connection, new EmptySecrets(), fetchImpl);
      await expect(engine.complete('auth-primary', {
        model: 'main',
        messages: [{ role: 'user', content: 'hello' }],
      })).rejects.toMatchObject({ status: 401 });
      expect(secondaryCalls).toBe(0);
      expect(new ProviderResilienceManager(f.database.connection).snapshot(f.providers.get('auth-primary')!).operational_status).toBe('auth_error');
    } finally { f.cleanup(); }
  });
});
