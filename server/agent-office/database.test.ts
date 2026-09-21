import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';

describe('Agent Office local database', () => {
  it('creates migrations and enables WAL in a configurable directory', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    expect(database.connection.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(database.connection.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()).toEqual({ name: 'projects' });
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
