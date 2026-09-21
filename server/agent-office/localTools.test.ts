import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeLocalTool } from './localTools.js';

describe('local tool layer', () => {
  it('confines reads and writes to project root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-tools-'));
    await fs.writeFile(path.join(root, 'note.txt'), 'hello');
    const context = { projectRoot: root, approvedWritePaths: ['out.txt'] };
    expect((await executeLocalTool('read_file', { path: 'note.txt' }, context)).ok).toBe(true);
    expect((await executeLocalTool('read_file', { path: '../outside.txt' }, context)).error).toBe('PATH_OUTSIDE_PROJECT_ROOT');
    expect((await executeLocalTool('write_file', { path: 'out.txt', content: 'saved' }, context)).ok).toBe(true);
    expect((await executeLocalTool('write_file', { path: 'not-approved.txt', content: 'nope' }, context)).error).toBe('WRITE_TARGET_NOT_APPROVED');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('denies destructive commands and runs tests without a shell', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-tools-'));
    const context = { projectRoot: root };
    expect((await executeLocalTool('run_command', { command: ['git', 'reset', '--hard'] }, context)).error).toBe('DESTRUCTIVE_COMMAND_DENIED');
    const result = await executeLocalTool('run_command', { command: ['node', '-e', 'process.stdout.write("ok")'] }, context);
    expect(result.ok).toBe(true);
    expect(result.data?.stdout).toBe('ok');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects symlink escapes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-tools-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-outside-'));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
      fsSync.symlinkSync(outside, path.join(root, 'linked'), 'junction');
      const result = await executeLocalTool('read_file', { path: 'linked/secret.txt' }, { projectRoot: root });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('SYMLINK_ESCAPE');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
