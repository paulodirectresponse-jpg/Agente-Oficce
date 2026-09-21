import { describe, expect, it } from 'vitest';
import { createClaudeAdapter } from './claudeAdapter.js';

describe('ClaudeAdapter', () => {
  it('creates adapter with required interface', () => {
    const adapter = createClaudeAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'test-key', model: 'claude-3-5-sonnet' });
    expect(adapter.id).toBe('claude');
    expect(typeof adapter.healthCheck).toBe('function');
    expect(typeof adapter.getCapabilities).toBe('function');
    expect(typeof adapter.startRun).toBe('function');
    expect(typeof adapter.cancel).toBe('function');
  });

  it('healthCheck returns unavailable without network', async () => {
    const adapter = createClaudeAdapter({ baseUrl: 'http://127.0.0.1:9999', apiKey: 'test-key', model: 'test' });
    const health = await adapter.healthCheck();
    expect(health.status).toBe('unavailable');
    expect(health.details).toBeDefined();
  });
});