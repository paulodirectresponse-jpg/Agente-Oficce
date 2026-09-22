import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openAgentOfficeDatabase } from './database.js';
import { ProviderConfigRepository } from './providerConfig.js';
import { DevelopmentSecretStore, SystemSecretStore } from './secretStore.js';

describe('provider configuration and secrets', () => {
  it('persists nonsecret config while keeping secret outside SQLite', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-provider-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const secrets = new DevelopmentSecretStore(dataDir);
    await secrets.set('claude-main', 'super-secret-key');
    new ProviderConfigRepository(database.connection).save({ provider_id: 'claude', base_url: 'https://provider.invalid', model: 'model', auth_scheme: 'x-api-key', auth_header: null, custom_headers: { 'x-client': 'agent-office' }, timeout_ms: 5000, health_endpoint: '/health', health_method: 'GET', secret_ref: 'claude-main' });
    expect(database.connection.prepare("SELECT COUNT(*) AS count FROM provider_configs WHERE custom_headers_json LIKE '%super-secret-key%'").get()).toEqual({ count: 0 });
    expect(await secrets.get('claude-main')).toBe('super-secret-key');
    const encryptedPath = path.join(dataDir, 'secrets.enc.json');
    const keyPath = path.join(dataDir, 'secrets.master.key');
    expect(fsSync.statSync(encryptedPath).mode & 0o400).toBe(0o400);
    expect(fsSync.statSync(keyPath).mode & 0o400).toBe(0o400);
    expect(fsSync.readFileSync(encryptedPath, 'utf8')).not.toContain('super-secret-key');
    if (process.platform !== 'win32') {
      expect((fsSync.statSync(encryptedPath).mode & 0o077)).toBe(0);
      expect((fsSync.statSync(keyPath).mode & 0o077)).toBe(0);
    }
    database.connection.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('keeps the production credential boundary explicit', async () => {
    await expect(new SystemSecretStore().get('claude')).rejects.toThrow('SYSTEM_SECRET_STORE_UNAVAILABLE');
  });

  it('persists max_tool_steps with a default of 20', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-provider-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const repository = new ProviderConfigRepository(database.connection);
    const base = { provider_id: 'claude', base_url: 'https://provider.invalid', model: 'model', auth_scheme: 'bearer' as const, auth_header: null, custom_headers: {}, timeout_ms: 5000, health_endpoint: '/v1/models', health_method: 'GET' as const, secret_ref: null };
    expect(repository.save(base).max_tool_steps).toBe(20);
    repository.save({ ...base, max_tool_steps: 7 });
    expect(repository.get('claude')?.max_tool_steps).toBe(7);
    database.connection.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
