import { describe, expect, it } from 'vitest';
import { ChatEventHub } from './chatEventHub.js';

describe('ChatEventHub', () => {
  it('buffers events, replays by sequence and marks terminal runs', () => {
    const hub = new ChatEventHub({ maxEventsPerRun: 10, retentionMs: 60_000 });
    hub.publish('run-1', 'run.created', { ok: true });
    hub.publish('run-1', 'response.delta', { text: 'A' });

    expect(hub.snapshot('run-1').map((event) => event.sequence)).toEqual([1, 2]);
    expect(hub.snapshot('run-1', 1).map((event) => event.event)).toEqual(['response.delta']);

    const received: string[] = [];
    const unsubscribe = hub.subscribe('run-1', (event) => received.push(event.event));
    hub.publish('run-1', 'run.completed', {});
    unsubscribe();

    expect(received).toEqual(['run.completed']);
    expect(hub.isTerminal('run-1')).toBe(true);
    hub.clear('run-1');
    expect(hub.snapshot('run-1')).toEqual([]);
  });
});
