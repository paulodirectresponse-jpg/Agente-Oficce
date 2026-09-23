import { openAgentOfficeDatabase } from './database.js';
import { getAgentOfficeConfig } from './config.js';
import { DevelopmentSecretStore } from './secretStore.js';
import { ProviderRepositoryV2 } from './v2DataModel.js';
import { UniversalProviderEngine } from './universalProviderEngine.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startProviderHealthMonitor(intervalMs = 5 * 60_000): void {
  if (timer) return;

  const tick = async () => {
    if (running) return;
    running = true;
    const database = openAgentOfficeDatabase();
    try {
      const providers = new ProviderRepositoryV2(database.connection)
        .list()
        .filter(provider => provider.enabled);
      const engine = new UniversalProviderEngine(
        database.connection,
        new DevelopmentSecretStore(getAgentOfficeConfig().dataDir),
      );
      for (const provider of providers) {
        try {
          await engine.testConnection(provider.id);
        } catch {
          // The engine persists the failure state. Health monitoring must never crash the Office.
        }
      }
    } finally {
      database.connection.close();
      running = false;
    }
  };

  timer = setInterval(() => { void tick(); }, Math.max(30_000, intervalMs));
  timer.unref?.();
}

export function stopProviderHealthMonitor(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
