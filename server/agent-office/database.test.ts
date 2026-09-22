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
    expect(database.connection.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }]);
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()).toEqual({ name: 'projects' });
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });


  it('fails closed when persisted foreign-key corruption is detected', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-integrity-'));
    const config = { dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' as const };
    const database = openAgentOfficeDatabase(config);
    database.connection.pragma('foreign_keys = OFF');
    const now = new Date().toISOString();
    database.connection.prepare(`
      INSERT INTO conversations (id, project_id, title, created_at, updated_at)
      VALUES ('broken-conversation', 'missing-project', 'Broken', ?, ?)
    `).run(now, now);
    database.connection.close();

    expect(() => openAgentOfficeDatabase(config)).toThrow('DATABASE_FOREIGN_KEY_CHECK_FAILED');
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
