import { describe, expect, it } from 'vitest';
import { ChatRunControlRegistry, ProviderRequestGate } from './runtimeControls.js';

describe('runtime controls', () => {
  it('cancels registered chat runs', () => {
    const registry = new ChatRunControlRegistry();
    const signal = registry.register('run-1');
    expect(signal.aborted).toBe(false);
    expect(registry.isActive('run-1')).toBe(true);
    expect(registry.cancel('run-1')).toBe(true);
    expect(signal.aborted).toBe(true);
    registry.finish('run-1');
    expect(registry.isActive('run-1')).toBe(false);
  });

  it('limits concurrent provider requests', async () => {
    const gate = new ProviderRequestGate();
    const releaseFirst = await gate.acquire('p', { maxConcurrent: 1, minIntervalMs: 0 });
    let acquired = false;
    const second = gate.acquire('p', { maxConcurrent: 1, minIntervalMs: 0 }).then((release) => {
      acquired = true;
      release();
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acquired).toBe(false);
    releaseFirst();
    await second;
    expect(acquired).toBe(true);
  });

  it('aborts queued provider requests', async () => {
    const gate = new ProviderRequestGate();
    const releaseFirst = await gate.acquire('p', { maxConcurrent: 1, minIntervalMs: 0 });
    const controller = new AbortController();
    const queued = gate.acquire('p', { maxConcurrent: 1, minIntervalMs: 0, signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toThrow('CHAT_RUN_CANCELLED');
    releaseFirst();
  });
});
