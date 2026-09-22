import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeAgentOfficeDatabase, openAgentOfficeDatabase } from './database.js';
import { ProjectRepository } from './projectRepository.js';
import { getProjectRootSetting, setProjectRootSetting } from './appSettings.js';

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

  it('creates projects automatically inside the configured project root', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-root-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    const root = path.join(dataDir, 'workspace');
    const setting = setProjectRootSetting(database.connection, root);
    expect(setting).toMatchObject({ configured: true, path: path.resolve(root) });
    expect(getProjectRootSetting(database.connection)).toEqual(setting);

    const project = new ProjectRepository(database.connection).createInDefaultRoot('Meu Projeto');
    expect(project.name).toBe('Meu Projeto');
    expect(project.root_path).toBe(path.join(path.resolve(root), 'Meu Projeto'));
    expect(fs.existsSync(project.root_path)).toBe(true);

    expect(() => new ProjectRepository(database.connection).createInDefaultRoot('Meu Projeto'))
      .toThrow('PROJECT_FOLDER_ALREADY_EXISTS');

    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('requires the default root before automatic project creation', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-root-required-'));
    const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
    expect(getProjectRootSetting(database.connection).configured).toBe(false);
    expect(() => new ProjectRepository(database.connection).createInDefaultRoot('Teste'))
      .toThrow('PROJECT_ROOT_NOT_CONFIGURED');
    closeAgentOfficeDatabase(database);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

});
