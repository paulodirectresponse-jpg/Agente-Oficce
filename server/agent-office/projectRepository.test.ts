import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { ProjectRepository } from './projectRepository.js';

describe('ProjectRepository', () => {
  it('creates and lists a Windows-compatible path with spaces', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const projectDir = fs.mkdtempSync(path.join(dataDir, 'project with spaces-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const repository = new ProjectRepository(database.connection);
    const project = repository.create({ root_path: projectDir });
    expect(project.root_path).toBe(path.resolve(projectDir));
    expect(repository.list()).toHaveLength(1);
    expect(repository.get(project.id)?.name).toBe(path.basename(projectDir));
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('rejects a missing project path', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    expect(() => new ProjectRepository(database.connection).create({ root_path: path.join(dataDir, 'missing') })).toThrow('PROJECT_PATH_NOT_FOUND');
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});
