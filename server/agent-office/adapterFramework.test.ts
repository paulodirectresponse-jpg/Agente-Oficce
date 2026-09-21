import { describe, expect, it } from 'vitest';
import { adapterRegistry, MockAdapter, type AgentAdapter, type AgentEvent } from './adapterFramework.js';

describe('Adapter Framework', () => {
  it('registers and retrieves adapters', () => {
    expect(adapterRegistry.getAll()).toContain(MockAdapter);
    expect(adapterRegistry.get('kimi')).toBe(MockAdapter);
    expect(adapterRegistry.get('codex')).toBeUndefined();
  });

  it('MockAdapter produces normalized events', async () => {
    const events: AgentEvent[] = [];
    for await (const event of MockAdapter.startRun({ taskId: 't1', contextPack: 'ctx', projectRoot: '/tmp' })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe('delta');
    expect(events[events.length - 1].type).toBe('complete');
    expect(events.every(e => typeof e.timestamp === 'string')).toBe(true);
  });

  it('MockAdapter health check returns structured status', async () => {
    const health = await MockAdapter.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.capabilities).toBeDefined();
  });
});