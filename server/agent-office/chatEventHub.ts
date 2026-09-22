export interface ChatStreamEnvelope {
  sequence: number;
  run_id: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
}

type Listener = (event: ChatStreamEnvelope) => void;

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled']);

export class ChatEventHub {
  private readonly buffers = new Map<string, ChatStreamEnvelope[]>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly terminal = new Set<string>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxEventsPerRun: number;
  private readonly retentionMs: number;

  constructor(options: { maxEventsPerRun?: number; retentionMs?: number } = {}) {
    this.maxEventsPerRun = options.maxEventsPerRun ?? 2000;
    this.retentionMs = options.retentionMs ?? 15 * 60 * 1000;
  }

  publish(runId: string, event: string, data: Record<string, unknown> = {}): ChatStreamEnvelope {
    const buffer = this.buffers.get(runId) ?? [];
    const envelope: ChatStreamEnvelope = {
      sequence: (buffer.at(-1)?.sequence ?? 0) + 1,
      run_id: runId,
      event,
      data,
      timestamp: new Date().toISOString(),
    };
    buffer.push(envelope);
    if (buffer.length > this.maxEventsPerRun) {
      buffer.splice(0, buffer.length - this.maxEventsPerRun);
    }
    this.buffers.set(runId, buffer);

    for (const listener of this.listeners.get(runId) ?? []) {
      listener(envelope);
    }

    if (TERMINAL_EVENTS.has(event)) {
      this.terminal.add(runId);
      const existing = this.cleanupTimers.get(runId);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => this.clear(runId), this.retentionMs);
      timer.unref?.();
      this.cleanupTimers.set(runId, timer);
    }

    return envelope;
  }

  snapshot(runId: string, afterSequence = 0): ChatStreamEnvelope[] {
    return (this.buffers.get(runId) ?? []).filter((event) => event.sequence > afterSequence);
  }

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => {
      const current = this.listeners.get(runId);
      current?.delete(listener);
      if (current && current.size === 0) this.listeners.delete(runId);
    };
  }

  isTerminal(runId: string): boolean {
    return this.terminal.has(runId);
  }

  clear(runId: string): void {
    this.buffers.delete(runId);
    this.listeners.delete(runId);
    this.terminal.delete(runId);
    const timer = this.cleanupTimers.get(runId);
    if (timer) clearTimeout(timer);
    this.cleanupTimers.delete(runId);
  }
}

export const chatEventHub = new ChatEventHub();
