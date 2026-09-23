import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Database } from 'better-sqlite3';
import { getProjectRootSetting } from './appSettings.js';

export interface AgentOfficeProject {
  id: string;
  name: string;
  objective: string;
  lifecycle_status: 'active' | 'paused' | 'completed' | 'archived';
  root_path: string;
  git_enabled: boolean;
  git_branch: string | null;
  completed_at: string | null;
  archived_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  name?: string;
  root_path: string;
}

function now(): string { return new Date().toISOString(); }

function safeFolderName(name: string): string {
  const trimmed = name.trim();
  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) throw new Error('PROJECT_NAME_INVALID');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) throw new Error('PROJECT_NAME_INVALID');
  return cleaned;
}

function id(): string { return crypto.randomUUID(); }

function detectGit(rootPath: string): { enabled: boolean; branch: string | null } {
  try {
    const branch = execFileSync('git', ['-C', rootPath, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { enabled: true, branch: branch || null };
  } catch {
    return { enabled: false, branch: null };
  }
}

function normalizeProject(row: any): AgentOfficeProject {
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(row.metadata_json || '{}'); } catch {}
  return {
    ...row,
    objective: row.objective ?? '',
    lifecycle_status: row.lifecycle_status ?? 'active',
    git_enabled: Boolean(row.git_enabled),
    completed_at: row.completed_at ?? null,
    archived_at: row.archived_at ?? null,
    metadata,
  };
}

export class ProjectRepository {
  constructor(private readonly database: Database) {}

  createInDefaultRoot(name: string): AgentOfficeProject {
    const setting = getProjectRootSetting(this.database);
    if (!setting.configured) throw new Error('PROJECT_ROOT_NOT_CONFIGURED');

    const projectName = String(name || '').trim();
    if (!projectName) throw new Error('PROJECT_NAME_REQUIRED');
    const folderName = safeFolderName(projectName);
    const root = path.resolve(setting.path);
    const projectPath = path.resolve(root, folderName);
    const relative = path.relative(root, projectPath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('PROJECT_NAME_INVALID');
    }
    if (fs.existsSync(projectPath)) throw new Error('PROJECT_FOLDER_ALREADY_EXISTS');

    fs.mkdirSync(projectPath, { recursive: false });
    try {
      return this.create({ name: projectName, root_path: projectPath });
    } catch (error) {
      try { fs.rmdirSync(projectPath); } catch {}
      throw error;
    }
  }

  create(input: CreateProjectInput): AgentOfficeProject {
    const rootPath = path.resolve(input.root_path);
    if (!fs.existsSync(rootPath)) throw new Error('PROJECT_PATH_NOT_FOUND');
    if (!fs.statSync(rootPath).isDirectory()) throw new Error('PROJECT_PATH_NOT_DIRECTORY');
    const detected = detectGit(rootPath);
    const timestamp = now();
    const project: AgentOfficeProject = {
      id: id(),
      name: input.name?.trim() || path.basename(rootPath) || rootPath,
      objective: '',
      lifecycle_status: 'active',
      root_path: rootPath,
      git_enabled: detected.enabled,
      git_branch: detected.branch,
      completed_at: null,
      archived_at: null,
      metadata: {},
      created_at: timestamp,
      updated_at: timestamp,
    };
    try {
      this.database.prepare(`INSERT INTO projects (id, name, objective, lifecycle_status, root_path, git_enabled, git_branch, completed_at, archived_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        project.id, project.name, project.objective, project.lifecycle_status, project.root_path, project.git_enabled ? 1 : 0, project.git_branch, project.completed_at, project.archived_at, JSON.stringify(project.metadata), project.created_at, project.updated_at,
      );
    } catch (error: any) {
      if (String(error?.code || '').includes('CONSTRAINT') || String(error?.message || '').includes('UNIQUE')) throw new Error('PROJECT_ALREADY_EXISTS');
      throw error;
    }
    this.database.prepare(`INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id(), project.id, 'Conversa principal', timestamp, timestamp);
    this.database.prepare(`INSERT INTO project_memory (project_id, updated_at) VALUES (?, ?)`).run(project.id, timestamp);
    return project;
  }

  list(): AgentOfficeProject[] {
    return this.database.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(normalizeProject);
  }

  get(projectId: string): AgentOfficeProject | null {
    const row = this.database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    return row ? normalizeProject(row) : null;
  }

  refresh(projectId: string): AgentOfficeProject {
    const project = this.get(projectId);
    if (!project) throw new Error('PROJECT_NOT_FOUND');
    const detected = detectGit(project.root_path);
    const updatedAt = now();
    this.database.prepare('UPDATE projects SET git_enabled = ?, git_branch = ?, updated_at = ? WHERE id = ?').run(detected.enabled ? 1 : 0, detected.branch, updatedAt, projectId);
    return this.get(projectId)!;
  }
}
