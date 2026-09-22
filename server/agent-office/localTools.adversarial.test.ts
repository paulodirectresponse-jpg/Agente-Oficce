import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeLocalTool } from './localTools.js';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-office-adversarial-'));
}

describe('V3 filesystem adversarial hardening', () => {
  it('rejects traversal and absolute paths for read/list/search/write/patch', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'inside.txt'), 'inside');
    const absolute = path.join(root, 'inside.txt');
    const context = { projectRoot: root };
    const cases = [
      executeLocalTool('read_file', { path: '../outside.txt' }, context),
      executeLocalTool('read_file', { path: absolute }, context),
      executeLocalTool('list_files', { path: '..' }, context),
      executeLocalTool('search_files', { path: '..', pattern: 'x' }, context),
      executeLocalTool('write_file', { path: '../outside.txt', content: 'x' }, context),
      executeLocalTool('apply_patch', { path: '../outside.txt', old_text: 'x', new_text: 'y' }, context),
    ];
    for (const result of await Promise.all(cases)) {
      expect(result.ok).toBe(false);
      expect(result.error).toBe('PATH_OUTSIDE_PROJECT_ROOT');
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects nested link/junction ancestors, including a not-yet-existing child', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await fs.writeFile(path.join(outside, 'secret.txt'), 'secret');
    try {
      fsSync.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const read = await executeLocalTool('read_file', { path: 'linked/secret.txt' }, { projectRoot: root });
      expect(read).toMatchObject({ ok: false, error: 'SYMLINK_ESCAPE' });

      const write = await executeLocalTool('write_file', { path: 'linked/new/deep.txt', content: 'escape' }, { projectRoot: root });
      expect(write).toMatchObject({ ok: false, error: 'SYMLINK_ESCAPE' });
      expect(fsSync.existsSync(path.join(outside, 'new', 'deep.txt'))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('allows a valid deep write but rejects binary and oversized reads', async () => {
    const root = await tempRoot();
    const context = { projectRoot: root };
    const write = await executeLocalTool('write_file', { path: 'a/b/c/file.txt', content: 'ok' }, context);
    expect(write.ok).toBe(true);
    expect(await fs.readFile(path.join(root, 'a/b/c/file.txt'), 'utf8')).toBe('ok');

    await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([1, 0, 2]));
    expect((await executeLocalTool('read_file', { path: 'binary.bin' }, context)).error).toBe('BINARY_FILE_NOT_ALLOWED');

    await fs.writeFile(path.join(root, 'large.txt'), Buffer.alloc(256 * 1024 + 1, 65));
    expect((await executeLocalTool('read_file', { path: 'large.txt' }, context)).error).toBe('FILE_TOO_LARGE');
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('V3 command adversarial hardening', () => {
  it('denies unknown, destructive, inline-node and unexpected npm commands', async () => {
    const root = await tempRoot();
    const context = { projectRoot: root };
    const denied: Array<string | string[]> = [
      ['powershell', '-Command', 'echo unsafe'],
      ['cmd', '/c', 'echo unsafe'],
      ['node', '-e', 'process.exit(0)'],
      ['node', 'arbitrary.js'],
      ['npm', 'exec', 'anything'],
      ['npm', 'install'],
      ['npm', 'run', 'arbitrary-script'],
      ['git', 'reset', '--hard'],
      ['git', 'clean', '-fd'],
      ['git', 'push', '--force'],
    ];
    for (const command of denied) {
      const result = await executeLocalTool('run_command', { command }, context);
      expect(result.ok, JSON.stringify(command)).toBe(false);
      expect(['COMMAND_NOT_ALLOWED', 'DESTRUCTIVE_COMMAND_DENIED']).toContain(result.error);
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('node_script accepts only an existing project-local JavaScript entrypoint', async () => {
    const root = await tempRoot();
    const outside = await tempRoot();
    await fs.writeFile(path.join(root, 'safe.mjs'), 'process.stdout.write("safe")');
    await fs.writeFile(path.join(root, 'unsafe.txt'), 'process.stdout.write("unsafe")');
    await fs.writeFile(path.join(outside, 'outside.mjs'), 'process.stdout.write("outside")');
    const context = { projectRoot: root };

    expect((await executeLocalTool('node_script', { path: 'safe.mjs' }, context)).ok).toBe(true);
    expect((await executeLocalTool('node_script', { path: 'unsafe.txt' }, context)).error).toBe('NODE_SCRIPT_NOT_ALLOWED');
    expect((await executeLocalTool('node_script', { path: '../outside.mjs' }, context)).error).toBe('PATH_OUTSIDE_PROJECT_ROOT');

    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('preserves cancellation and timeout for explicit node scripts', async () => {
    const root = await tempRoot();
    await fs.writeFile(path.join(root, 'wait.mjs'), 'setTimeout(() => process.stdout.write("late"), 5000)');

    const timeout = await executeLocalTool('node_script', { path: 'wait.mjs' }, { projectRoot: root, timeoutMs: 20 });
    expect(timeout.ok).toBe(false);
    expect(['COMMAND_TIMEOUT', 'TOOL_RUN_CANCELLED']).toContain(timeout.error);

    const controller = new AbortController();
    const pending = executeLocalTool('node_script', { path: 'wait.mjs' }, { projectRoot: root, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const cancelled = await pending;
    expect(cancelled).toMatchObject({ ok: false, error: 'TOOL_RUN_CANCELLED' });

    await fs.rm(root, { recursive: true, force: true });
  });
});
