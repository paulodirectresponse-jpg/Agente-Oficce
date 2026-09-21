import { getAgentOfficeConfig } from './config.js';

type LogPayload = Record<string, unknown>;

function write(level: 'info' | 'error', message: string, payload?: LogPayload): void {
  const config = getAgentOfficeConfig();
  if (config.logLevel === 'silent' || (config.logLevel !== 'debug' && level === 'info' && message.startsWith('[debug]'))) return;
  const suffix = payload ? ` ${JSON.stringify(payload)}` : '';
  const line = `[Agent Office] ${level.toUpperCase()} ${message}${suffix}`;
  (level === 'error' ? console.error : console.info)(line);
}

export const agentOfficeLogger = {
  info(message: string, payload?: LogPayload): void { write('info', message, payload); },
  error(message: string, payload?: LogPayload): void { write('error', message, payload); },
  debug(message: string, payload?: LogPayload): void { write('info', `[debug] ${message}`, payload); },
};
