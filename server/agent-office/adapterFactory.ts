import type { Database } from 'better-sqlite3';
import type { AgentAdapter, AgentId } from './adapterFramework.js';
import { MockAdapter } from './adapterFramework.js';
import { createClaudeAdapter } from './claudeAdapter.js';
import { ProviderConfigRepository } from './providerConfig.js';
import type { SecretStore } from './secretStore.js';

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
  return registry;
}

export function resolveAgentId(requested: unknown, available: Map<string, AgentAdapter>): AgentId {
  const id = typeof requested === 'string' ? requested : '';
  if (id === 'claude' || id === 'kimi' || id === 'codex') return available.has(id) ? id : 'kimi';
  return available.has('claude') ? 'claude' : 'kimi';
}
