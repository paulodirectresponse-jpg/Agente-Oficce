export class ChatRunCancelledError extends Error {
  readonly code = 'CHAT_RUN_CANCELLED';
  constructor() {
    super('CHAT_RUN_CANCELLED');
  }
}

interface ProviderGate {
  active: number;
  queue: Array<() => void>;
  lastStartedAt: number;
}

export class ProviderRequestGate {
  private readonly gates = new Map<string, ProviderGate>();

  private gate(providerId: string): ProviderGate {
    let gate = this.gates.get(providerId);
    if (!gate) {
      gate = { active: 0, queue: [], lastStartedAt: 0 };
      this.gates.set(providerId, gate);
    }
    return gate;
  }

  async acquire(
    providerId: string,
    options: { maxConcurrent: number; minIntervalMs: number; signal?: AbortSignal },
  ): Promise<() => void> {
    const gate = this.gate(providerId);
    const maxConcurrent = Math.max(1, options.maxConcurrent);

    while (gate.active >= maxConcurrent) {
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const index = gate.queue.indexOf(resume);
          if (index >= 0) gate.queue.splice(index, 1);
          reject(new ChatRunCancelledError());
        };
        gate.queue.push(resume);
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    if (options.signal?.aborted) throw new ChatRunCancelledError();
    const wait = Math.max(0, gate.lastStartedAt + Math.max(0, options.minIntervalMs) - Date.now());
    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve();
        }, wait);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new ChatRunCancelledError());
        };
        if (options.signal?.aborted) onAbort();
        else options.signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    gate.active += 1;
    gate.lastStartedAt = Date.now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      gate.active = Math.max(0, gate.active - 1);
      gate.queue.shift()?.();
    };
  }
}

export class ChatRunControlRegistry {
  private readonly controllers = new Map<string, AbortController>();

  register(runId: string): AbortSignal {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller.signal;
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  finish(runId: string): void {
    this.controllers.delete(runId);
  }

  isActive(runId: string): boolean {
    return this.controllers.has(runId);
  }
}

export const providerRequestGate = new ProviderRequestGate();
export const chatRunControls = new ChatRunControlRegistry();
