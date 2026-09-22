import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Database } from 'better-sqlite3';

export interface ProjectRootSetting {
  path: string;
  configured: boolean;
}

const KEY = 'project_root_dir';

function now(): string { return new Date().toISOString(); }

export function suggestedProjectRoot(): string {
  return path.join(os.homedir(), 'Documents', 'Agent Office Projects');
}

export function getProjectRootSetting(database: Database): ProjectRootSetting {
  const row = database.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(KEY) as { value_json: string } | undefined;
  if (!row) return { path: suggestedProjectRoot(), configured: false };
  try {
    const parsed = JSON.parse(row.value_json) as { path?: unknown };
    if (typeof parsed.path === 'string' && parsed.path.trim()) {
      return { path: path.resolve(parsed.path), configured: true };
    }
  } catch {
    // Fall through to suggested path.
  }
  return { path: suggestedProjectRoot(), configured: false };
}

export function setProjectRootSetting(database: Database, value: string): ProjectRootSetting {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('PROJECT_ROOT_REQUIRED');
  const root = path.resolve(raw);
  fs.mkdirSync(root, { recursive: true });
  if (!fs.statSync(root).isDirectory()) throw new Error('PROJECT_ROOT_NOT_DIRECTORY');

  database.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(KEY, JSON.stringify({ path: root }), now());

  return { path: root, configured: true };
}
