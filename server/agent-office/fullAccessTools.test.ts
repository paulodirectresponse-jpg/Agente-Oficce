import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeFullAccessTool, getFullAccessToolHealth } from './fullAccessTools.js';

describe('Block 1 full access tools', () => {
  it('writes outside the project root when the OS account allows it', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-full-access-'));
    const projectRoot = path.join(base, 'project');
    const sibling = path.join(base, 'outside', 'note.txt');
    await fs.mkdir(projectRoot, { recursive: true });

    const write = await executeFullAccessTool('fs_write_any', { path: sibling, content: 'full access' }, { projectRoot });
    expect(write.ok).toBe(true);
    expect(await fs.readFile(sibling, 'utf8')).toBe('full access');

    await fs.rm(base, { recursive: true, force: true });
  });

  it('runs a real shell command and a real git command', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-runtime-shell-'));

    const shell = await executeFullAccessTool('shell_command', { command: 'node --version' }, { projectRoot: root });
    expect(shell.ok).toBe(true);
    expect(String(shell.data?.stdout ?? '')).toMatch(/^v\d+/);

    const git = await executeFullAccessTool('git_command', { args: ['--version'] }, { projectRoot: root });
    expect(git.ok).toBe(true);
    expect(String(git.data?.stdout ?? '')).toContain('git version');

    await fs.rm(root, { recursive: true, force: true });
  });

  it('protects catastrophic filesystem roots even under Full Access', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-runtime-delete-'));
    const driveRoot = path.parse(root).root;
    const result = await executeFullAccessTool('fs_delete', { path: driveRoot, recursive: true }, { projectRoot: root });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CRITICAL_DELETE_TARGET_DENIED');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports runtime health without pretending unavailable tools are healthy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ao-runtime-health-'));
    const health = await getFullAccessToolHealth(root);
    expect(health.some(item => item.id === 'files' && item.status === 'healthy')).toBe(true);
    expect(health.some(item => item.id === 'shell' && item.status === 'healthy')).toBe(true);
    expect(health.some(item => item.id === 'git')).toBe(true);
    expect(health.some(item => item.id === 'github')).toBe(true);
    expect(health.some(item => item.id === 'browser')).toBe(true);
    expect(health.some(item => item.id === 'computer')).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  }, 15000);
});
