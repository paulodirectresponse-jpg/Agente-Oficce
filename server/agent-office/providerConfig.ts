import type { Database } from 'better-sqlite3';

export type ProviderAuthScheme = 'bearer' | 'x-api-key' | 'custom';

export interface ProviderConfig {
  provider_id: string;
  base_url: string;
  model: string;
  auth_scheme: ProviderAuthScheme;
  auth_header: string | null;
  custom_headers: Record<string, string>;
  timeout_ms: number;
  health_endpoint: string;
  health_method: 'GET' | 'POST';
  secret_ref: string | null;
  max_tool_steps: number;
}

interface ProviderConfigRow {
  provider_id: string;
  base_url: string;
  model: string;
  auth_scheme: ProviderAuthScheme;
  auth_header: string | null;
  custom_headers_json: string;
  timeout_ms: number;
  health_endpoint: string;
  health_method: 'GET' | 'POST';
  secret_ref: string | null;
}

export class ProviderConfigRepository {
  constructor(private readonly database: Database) {}

  get(providerId: string): ProviderConfig | null {
    const row = this.database.prepare('SELECT * FROM provider_configs WHERE provider_id = ?').get(providerId) as ProviderConfigRow | undefined;
    if (!row) return null;
    return {
      provider_id: row.provider_id,
      base_url: row.base_url,
      model: row.model,
      auth_scheme: row.auth_scheme,
      auth_header: row.auth_header,
      custom_headers: JSON.parse(row.custom_headers_json) as Record<string, string>,
      timeout_ms: row.timeout_ms,
      health_endpoint: row.health_endpoint,
      health_method: row.health_method,
      secret_ref: row.secret_ref,
      max_tool_steps: 8,
    };
  }

  save(config: Omit<ProviderConfig, 'max_tool_steps'> & { max_tool_steps?: number }): ProviderConfig {
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO provider_configs (provider_id, base_url, model, auth_scheme, auth_header, custom_headers_json, timeout_ms, health_endpoint, health_method, secret_ref, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET base_url = excluded.base_url, model = excluded.model, auth_scheme = excluded.auth_scheme, auth_header = excluded.auth_header, custom_headers_json = excluded.custom_headers_json, timeout_ms = excluded.timeout_ms, health_endpoint = excluded.health_endpoint, health_method = excluded.health_method, secret_ref = excluded.secret_ref, updated_at = excluded.updated_at
    `).run(config.provider_id, config.base_url, config.model, config.auth_scheme, config.auth_header, JSON.stringify(config.custom_headers), config.timeout_ms, config.health_endpoint, config.health_method, config.secret_ref, updatedAt);
    return this.get(config.provider_id)!;
  }
}
