import type { Database } from 'better-sqlite3';
import type { AgentAdapter, AgentId } from './adapterFramework.js';
import { MockAdapter } from './adapterFramework.js';
import { createClaudeAdapter } from './claudeAdapter.js';
import { createKimiAdapter } from './kimiAdapter.js';
import { createCodexAdapter } from './codexAdapter.js';
import { ProviderConfigRepository } from './providerConfig.js';
import type { SecretStore } from './secretStore.js';

async function probeCodexInstalled(): Promise<boolean> {
  try {
    const { spawn } = await import('node:child_process');
    const child = spawn('codex', ['--version'], { timeout: 3000, windowsHide: true });
    const code = await new Promise<number | null>(resolve => {
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 3500);
      child.on('close', exitCode => {
        clearTimeout(timer);
        resolve(exitCode);
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    return code === 0;
  } catch {
    return false;
  }
}

export async function buildAdapterRegistry(database: Database, secrets: SecretStore): Promise<Map<string, AgentAdapter>> {
  const registry = new Map<string, AgentAdapter>();
  registry.set(MockAdapter.id, MockAdapter);
  const configs = new ProviderConfigRepository(database);
  const claudeConfig = configs.get('claude');
  if (claudeConfig?.secret_ref) {
    const apiKey = await secrets.get(claudeConfig.secret_ref);
    if (apiKey) {
      registry.set('claude', createClaudeAdapter({
        baseUrl: claudeConfig.base_url,
        apiKey,
        model: claudeConfig.model,
        timeoutMs: claudeConfig.timeout_ms,
        authScheme: claudeConfig.auth_scheme,
        customAuthHeader: claudeConfig.auth_header ?? undefined,
        healthCheckEndpoint: claudeConfig.health_endpoint,
        healthCheckMethod: claudeConfig.health_method,
        maxToolSteps: claudeConfig.max_tool_steps,
      }));
    }
  }
  const kimiConfig = configs.get('kimi');
  if (kimiConfig?.secret_ref) {
    const apiKey = await secrets.get(kimiConfig.secret_ref);
    if (apiKey) {
      registry.set('kimi', createKimiAdapter({
        baseUrl: kimiConfig.base_url,
        apiKey,
        model: kimiConfig.model,
        timeoutMs: kimiConfig.timeout_ms,
        maxToolSteps: kimiConfig.max_tool_steps,
      }));
    }
  }
  if (await probeCodexInstalled()) {
    registry.set('codex', createCodexAdapter({}));
  }
  return registry;
}

export function resolveAgentId(requested: unknown, available: Map<string, AgentAdapter>): AgentId {
  const id = typeof requested === 'string' ? requested : '';
  if (id === 'claude' || id === 'kimi' || id === 'codex') return available.has(id) ? id : 'kimi';
  return available.has('claude') ? 'claude' : 'kimi';
}
