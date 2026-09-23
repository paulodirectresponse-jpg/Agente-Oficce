import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { agentOfficeMigrations, closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';

describe('Agent Office local database', () => {
  it('creates migrations and enables WAL in a configurable directory', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    expect(database.connection.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    expect(database.connection.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }, { version: 11 }, { version: 12 }, { version: 13 }, { version: 14 }, { version: 15 }]);
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()).toEqual({ name: 'projects' });
    expect(database.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'teams'").get()).toEqual({ name: 'teams' });
    expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });


  it('upgrades a migration-12 database through migration 15 without losing existing rows', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-upgrade-'));
    const databasePath = path.join(dataDir, 'office.sqlite');
    const legacy = new Database(databasePath);
    legacy.exec('PRAGMA foreign_keys = ON;');
    legacy.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
    for (const migration of agentOfficeMigrations.filter((item) => item.version <= 12)) {
      legacy.exec(migration.sql);
      legacy.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(migration.version, new Date().toISOString());
    }
    const now = new Date().toISOString();
    legacy.prepare(`INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES('keep','Keep',?,?,?)`).run(dataDir, now, now);
    legacy.close();

    const upgraded = openAgentOfficeDatabase({ dataDir, databasePath, logLevel: 'silent' });
    expect(upgraded.connection.prepare('SELECT name FROM projects WHERE id=?').get('keep')).toEqual({ name: 'Keep' });
    expect(upgraded.connection.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toEqual({ version: 15 });
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_delegations'").get()).toEqual({ name: 'runtime_delegations' });
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_fallbacks'").get()).toEqual({ name: 'provider_fallbacks' });
    expect(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='orchestration_events'").get()).toEqual({ name: 'orchestration_events' });
    expect(upgraded.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    upgraded.connection.close();
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
