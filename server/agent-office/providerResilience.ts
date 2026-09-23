import crypto from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { Provider } from './v2DataModel.js';
import { ChatRunCancelledError, providerRequestGate } from './runtimeControls.js';

export interface ProviderRuntimeConfig {
  maxConcurrent: number;
  minIntervalMs: number;
  rpmLimit: number;
  tpmLimit: number;
  cooldownSeconds: number;
  circuitFailureThreshold: number;
  circuitResetSeconds: number;
  rateWindowMs: number;
}

export interface ProviderRuntimeSnapshot {
  provider_id: string;
  operational_status: string;
  active_requests: number;
  queued_requests: number;
  rpm_used: number;
  tpm_used: number;
  rpm_limit: number;
  tpm_limit: number;
  cooldown_until: string | null;
  circuit_state: 'closed' | 'open' | 'half_open';
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface ProviderFallback {
  id: string;
  source_provider_id: string;
  source_model: string | null;
  target_provider_id: string;
  target_model: string | null;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface WindowState {
  minuteStartedAt: number;
  requests: number;
  tokens: number;
  active: number;
  queued: number;
  circuitState: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  cooldownUntil: number;
  circuitOpenedAt: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  baseStatus: string;
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function resilienceConfig(provider: Provider): ProviderRuntimeConfig {
  const config = provider.protocol_config ?? {};
  return {
    maxConcurrent: Math.max(1, Math.min(50, num(config, 'max_concurrent_requests', 2))),
    minIntervalMs: Math.max(0, num(config, 'min_request_interval_ms', 0)),
    rpmLimit: Math.max(0, num(config, 'rpm_limit', 0)),
    tpmLimit: Math.max(0, num(config, 'tpm_limit', 0)),
    cooldownSeconds: Math.max(1, num(config, 'cooldown_seconds', 30)),
    circuitFailureThreshold: Math.max(1, num(config, 'circuit_failure_threshold', 5)),
    circuitResetSeconds: Math.max(1, num(config, 'circuit_reset_seconds', 60)),
    rateWindowMs: Math.max(100, num(config, 'rate_window_ms', 60_000)),
  };
}

function nowIso(): string { return new Date().toISOString(); }
function retryableStatus(status?: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as any).code ?? '') : '';
  const status = 'status' in error ? Number((error as any).status) : undefined;
  return retryableStatus(status)
    || ['PROVIDER_TIMEOUT','PROVIDER_NETWORK_ERROR','PROVIDER_RATE_LIMITED','PROVIDER_COOLDOWN','PROVIDER_CIRCUIT_OPEN'].includes(code);
}

export class ProviderFallbackRepository {
  constructor(private readonly database: Database) {}

  list(sourceProviderId: string, sourceModel?: string | null): ProviderFallback[] {
    const rows = this.database.prepare(`
      SELECT * FROM provider_fallbacks
      WHERE source_provider_id = ? AND enabled = 1
        AND (source_model IS NULL OR source_model = ?)
      ORDER BY CASE WHEN source_model = ? THEN 0 ELSE 1 END, priority ASC, created_at ASC
    `).all(sourceProviderId, sourceModel ?? null, sourceModel ?? null) as any[];
    return rows.map(row => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  listAll(sourceProviderId: string): ProviderFallback[] {
    const rows = this.database.prepare(`
      SELECT * FROM provider_fallbacks
      WHERE source_provider_id = ?
      ORDER BY source_model, priority ASC, created_at ASC
    `).all(sourceProviderId) as any[];
    return rows.map(row => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  replace(sourceProviderId: string, fallbacks: Array<{ target_provider_id: string; target_model?: string | null; source_model?: string | null }>): ProviderFallback[] {
    const timestamp = nowIso();
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM provider_fallbacks WHERE source_provider_id = ?').run(sourceProviderId);
      const insert = this.database.prepare(`
        INSERT INTO provider_fallbacks (
          id, source_provider_id, source_model, target_provider_id, target_model,
          priority, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      fallbacks.forEach((item, index) => {
        insert.run(
          crypto.randomUUID(),
          sourceProviderId,
          item.source_model ?? null,
          item.target_provider_id,
          item.target_model ?? null,
          index,
          timestamp,
          timestamp,
        );
      });
    });
    transaction();
    return this.listAll(sourceProviderId);
  }
}

export class ProviderResilienceManager {
  private static readonly sharedStates = new Map<string, WindowState>();
  private readonly states = ProviderResilienceManager.sharedStates;

  constructor(private readonly database: Database) {}

  private state(providerId: string): WindowState {
    let state = this.states.get(providerId);
    if (!state) {
      const row = this.database.prepare('SELECT * FROM provider_runtime_state WHERE provider_id = ?').get(providerId) as any;
      state = {
        minuteStartedAt: Date.now(),
        requests: 0,
        tokens: 0,
        active: 0,
        queued: 0,
        circuitState: row?.circuit_state === 'open' || row?.circuit_state === 'half_open' ? row.circuit_state : 'closed',
        consecutiveFailures: Number(row?.consecutive_failures || 0),
        cooldownUntil: row?.cooldown_until ? Date.parse(row.cooldown_until) || 0 : 0,
        circuitOpenedAt: row?.circuit_state === 'open' ? Date.parse(row.updated_at) || 0 : 0,
        lastSuccessAt: row?.last_success_at ?? null,
        lastFailureAt: row?.last_failure_at ?? null,
        lastError: row?.last_error ?? null,
        baseStatus: row?.operational_status ?? 'unknown',
      };
      this.states.set(providerId, state);
    }
    return state;
  }

  private rotateMinute(state: WindowState, windowMs = 60_000): void {
    if (Date.now() - state.minuteStartedAt >= windowMs) {
      state.minuteStartedAt = Date.now();
      state.requests = 0;
      state.tokens = 0;
    }
  }

  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      const abort = () => {
        clearTimeout(timer);
        reject(new ChatRunCancelledError());
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }

  private persist(provider: Provider, state: WindowState, status?: string): void {
    const config = resilienceConfig(provider);
    const operational = status
      ?? (state.circuitState === 'open' ? 'unavailable'
        : state.cooldownUntil > Date.now() ? 'rate_limited'
          : state.queued > 0 ? 'queued'
            : state.active > 0 ? 'busy'
              : state.baseStatus !== 'unknown' ? state.baseStatus : 'healthy');
    this.database.prepare(`
      INSERT INTO provider_runtime_state (
        provider_id, operational_status, active_requests, queued_requests,
        rpm_used, tpm_used, cooldown_until, circuit_state, consecutive_failures,
        last_success_at, last_failure_at, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id) DO UPDATE SET
        operational_status=excluded.operational_status,
        active_requests=excluded.active_requests,
        queued_requests=excluded.queued_requests,
        rpm_used=excluded.rpm_used,
        tpm_used=excluded.tpm_used,
        cooldown_until=excluded.cooldown_until,
        circuit_state=excluded.circuit_state,
        consecutive_failures=excluded.consecutive_failures,
        last_success_at=excluded.last_success_at,
        last_failure_at=excluded.last_failure_at,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `).run(
      provider.id, operational, state.active, state.queued, state.requests, state.tokens,
      state.cooldownUntil > Date.now() ? new Date(state.cooldownUntil).toISOString() : null,
      state.circuitState, state.consecutiveFailures, state.lastSuccessAt, state.lastFailureAt,
      state.lastError, nowIso(),
    );
    void config;
  }

  async acquire(provider: Provider, estimatedTokens: number, signal?: AbortSignal): Promise<() => void> {
    const config = resilienceConfig(provider);
    const state = this.state(provider.id);
    this.rotateMinute(state, config.rateWindowMs);

    if (state.circuitState === 'open') {
      const resetAt = state.circuitOpenedAt + config.circuitResetSeconds * 1000;
      if (Date.now() < resetAt) {
        this.persist(provider, state, 'unavailable');
        const error = new Error('PROVIDER_CIRCUIT_OPEN') as Error & { code?: string };
        error.code = 'PROVIDER_CIRCUIT_OPEN';
        throw error;
      }
      state.circuitState = 'half_open';
    }

    if (state.cooldownUntil > Date.now()) {
      this.persist(provider, state, 'rate_limited');
      const error = new Error('PROVIDER_COOLDOWN') as Error & { code?: string };
      error.code = 'PROVIDER_COOLDOWN';
      throw error;
    }

    while (
      (config.rpmLimit > 0 && state.requests >= config.rpmLimit)
      || (config.tpmLimit > 0 && state.tokens + Math.max(0, estimatedTokens) > config.tpmLimit)
    ) {
      state.queued += 1;
      this.persist(provider, state, 'queued');
      const wait = Math.max(25, config.rateWindowMs - (Date.now() - state.minuteStartedAt));
      try {
        await this.delay(wait, signal);
      } finally {
        state.queued = Math.max(0, state.queued - 1);
      }
      this.rotateMinute(state, config.rateWindowMs);
    }

    state.queued += 1;
    this.persist(provider, state, 'queued');
    let releaseGate: (() => void) | null = null;
    try {
      releaseGate = await providerRequestGate.acquire(provider.id, {
        maxConcurrent: config.maxConcurrent,
        minIntervalMs: config.minIntervalMs,
        signal,
      });
    } finally {
      state.queued = Math.max(0, state.queued - 1);
    }

    state.active += 1;
    state.requests += 1;
    state.tokens += Math.max(0, estimatedTokens);
    this.persist(provider, state, 'busy');

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      releaseGate?.();
      this.persist(provider, state);
    };
  }

  recordSuccess(provider: Provider, model: string, actualTokens = 0): void {
    const state = this.state(provider.id);
    state.circuitState = 'closed';
    state.consecutiveFailures = 0;
    state.cooldownUntil = 0;
    state.lastSuccessAt = nowIso();
    state.lastError = null;
    state.baseStatus = 'healthy';
    if (actualTokens > 0) state.tokens += actualTokens;
    this.persist(provider, state, state.active > 0 ? 'busy' : 'healthy');
    this.database.prepare(`
      INSERT INTO provider_model_runtime_state (
        provider_id, model_id, operational_status, last_success_at, last_failure_at, last_error, updated_at
      ) VALUES (?, ?, 'healthy', ?, NULL, NULL, ?)
      ON CONFLICT(provider_id,model_id) DO UPDATE SET
        operational_status='healthy', last_success_at=excluded.last_success_at,
        last_error=NULL, updated_at=excluded.updated_at
    `).run(provider.id, model, state.lastSuccessAt, nowIso());
  }

  recordFailure(provider: Provider, model: string, error: any): void {
    const state = this.state(provider.id);
    const config = resilienceConfig(provider);
    state.consecutiveFailures += 1;
    state.lastFailureAt = nowIso();
    state.lastError = String(error?.message || error?.code || 'Provider request failed').slice(0, 1000);

    if (Number(error?.status) === 429 || error?.code === 'PROVIDER_RATE_LIMITED') {
      state.cooldownUntil = Date.now() + config.cooldownSeconds * 1000;
    }
    if (state.consecutiveFailures >= config.circuitFailureThreshold && isRetryableProviderError(error)) {
      state.circuitState = 'open';
      state.circuitOpenedAt = Date.now();
    }
    const httpStatus = Number(error?.status);
    const status = httpStatus === 401 || httpStatus === 403
      ? 'auth_error'
      : httpStatus === 400 || error?.code === 'PROVIDER_SECRET_MISSING'
        ? 'misconfigured'
        : state.circuitState === 'open'
          ? 'unavailable'
          : state.cooldownUntil > Date.now() ? 'rate_limited' : 'degraded';
    state.baseStatus = status;
    this.persist(provider, state, status);
    this.database.prepare(`
      INSERT INTO provider_model_runtime_state (
        provider_id, model_id, operational_status, last_success_at, last_failure_at, last_error, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?)
      ON CONFLICT(provider_id,model_id) DO UPDATE SET
        operational_status=excluded.operational_status,
        last_failure_at=excluded.last_failure_at,
        last_error=excluded.last_error,
        updated_at=excluded.updated_at
    `).run(provider.id, model, status, state.lastFailureAt, state.lastError, nowIso());
  }

  snapshot(provider: Provider): ProviderRuntimeSnapshot {
    const state = this.state(provider.id);
    const config = resilienceConfig(provider);
    this.rotateMinute(state, config.rateWindowMs);
    this.persist(provider, state);
    const row = this.database.prepare('SELECT * FROM provider_runtime_state WHERE provider_id = ?').get(provider.id) as any;
    return {
      provider_id: provider.id,
      operational_status: row?.operational_status ?? 'unknown',
      active_requests: Number(row?.active_requests || 0),
      queued_requests: Number(row?.queued_requests || 0),
      rpm_used: Number(row?.rpm_used || 0),
      tpm_used: Number(row?.tpm_used || 0),
      rpm_limit: config.rpmLimit,
      tpm_limit: config.tpmLimit,
      cooldown_until: row?.cooldown_until ?? null,
      circuit_state: row?.circuit_state ?? 'closed',
      consecutive_failures: Number(row?.consecutive_failures || 0),
      last_success_at: row?.last_success_at ?? null,
      last_failure_at: row?.last_failure_at ?? null,
      last_error: row?.last_error ?? null,
      updated_at: row?.updated_at ?? nowIso(),
    };
  }

  modelStates(providerId: string): Array<Record<string, unknown>> {
    return this.database.prepare(`
      SELECT * FROM provider_model_runtime_state
      WHERE provider_id = ?
      ORDER BY model_id
    `).all(providerId) as Array<Record<string, unknown>>;
  }
}
