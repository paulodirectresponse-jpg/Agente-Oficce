import fs from 'node:fs';
import path from 'node:path';

export interface AgentOfficeConfig {
  dataDir: string;
  databasePath: string;
  logLevel: 'silent' | 'info' | 'debug';
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

export function getAgentOfficeConfig(env: NodeJS.ProcessEnv = process.env): AgentOfficeConfig {
  const dataDir = path.resolve(nonEmpty(env.AGENT_OFFICE_DATA_DIR, path.join(process.cwd(), '.agent-office')));
  const databasePath = path.resolve(nonEmpty(env.AGENT_OFFICE_DATABASE_PATH, path.join(dataDir, 'agent-office.sqlite')));
  const logLevel = env.AGENT_OFFICE_LOG_LEVEL === 'silent' || env.AGENT_OFFICE_LOG_LEVEL === 'debug' ? env.AGENT_OFFICE_LOG_LEVEL : 'info';
  return { dataDir, databasePath, logLevel };
}

export function ensureAgentOfficeDataDir(config = getAgentOfficeConfig()): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
