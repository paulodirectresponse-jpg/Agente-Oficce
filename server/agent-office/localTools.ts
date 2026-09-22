import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_READ_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export type LocalToolName = 'list_files' | 'read_file' | 'search_files' | 'write_file' | 'apply_patch' | 'git_status' | 'git_diff' | 'run_command' | 'run_tests';
export interface LocalToolContext { projectRoot: string; approvedWritePaths?: string[]; timeoutMs?: number; signal?: AbortSignal; }
export interface LocalToolResult { ok: boolean; data?: Record<string, unknown>; error?: string; approval_required?: boolean; }

function bounded(value: string): string { return value.length > MAX_OUTPUT_BYTES ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n[output truncated]` : value; }

function canonicalRoot(root: string): string { return fsSync.realpathSync(root); }
function safePath(context: LocalToolContext, requested: string, write = false): string {
  if (path.isAbsolute(requested)) throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
  const root = canonicalRoot(context.projectRoot);
  const candidate = path.resolve(root, requested);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
  if (write && context.approvedWritePaths && !context.approvedWritePaths.includes(requested)) throw new Error('WRITE_TARGET_NOT_APPROVED');
  const parent = path.dirname(candidate);
  if (fsSync.existsSync(parent) && fsSync.realpathSync(parent) !== path.resolve(root, path.relative(root, parent))) throw new Error('SYMLINK_ESCAPE');
  if (fsSync.existsSync(candidate) && fsSync.lstatSync(candidate).isSymbolicLink()) throw new Error('SYMLINK_ESCAPE');
  return candidate;
}

async function readSafe(context: LocalToolContext, requested: string): Promise<string> {
  const target = safePath(context, requested);
  const stat = await fs.stat(target);
  if (!stat.isFile()) throw new Error('FILE_REQUIRED');
  if (stat.size > MAX_READ_BYTES) throw new Error('FILE_TOO_LARGE');
  const buffer = await fs.readFile(target);
  if (buffer.includes(0)) throw new Error('BINARY_FILE_NOT_ALLOWED');
  return buffer.toString('utf8');
}

function commandParts(command: string | string[]): { executable: string; args: string[] } {
  const parts = Array.isArray(command) ? command : command.trim().split(/\s+/);
  const executable = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  if (!executable || !['git', 'npm', 'node'].includes(executable)) throw new Error('COMMAND_NOT_ALLOWED');
  const joined = [executable, ...args].join(' ').toLowerCase();
  const destructive = executable === 'git' && ((args[0] === 'reset' && args[1] === '--hard') || (args[0] === 'push' && args.includes('--force')) || (args[0] === 'clean' && args.includes('-fd')))
    || executable === 'rm' || executable === 'kill'
    || /drop\s+database/.test(joined);
  if (destructive) throw new Error('DESTRUCTIVE_COMMAND_DENIED');
  return { executable, args };
}

async function runAllowed(context: LocalToolContext, command: string | string[]): Promise<LocalToolResult> {
  try {
    const { executable, args } = commandParts(command);
    const result = await execFileAsync(executable, args, {
      cwd: canonicalRoot(context.projectRoot),
      timeout: context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      signal: context.signal,
    });
    return { ok: true, data: { stdout: bounded(result.stdout), stderr: bounded(result.stderr), executable, args } };
  } catch (error: any) {
    if (context.signal?.aborted || error?.name === 'AbortError') return { ok: false, error: 'TOOL_RUN_CANCELLED' };
    if (error?.killed || error?.code === 'ETIMEDOUT') return { ok: false, error: 'COMMAND_TIMEOUT' };
    return { ok: false, error: bounded(error?.stderr || error?.message || 'COMMAND_FAILED') };
  }
}

export const localToolDefinitions: Array<{ name: LocalToolName; description: string }> = [
  { name: 'list_files', description: 'List files within the project root.' },
  { name: 'read_file', description: 'Read a bounded text file within the project root.' },
  { name: 'search_files', description: 'Search bounded text files within the project root.' },
  { name: 'write_file', description: 'Write an approved text file within the project root.' },
  { name: 'apply_patch', description: 'Apply a simple exact replacement to an approved file.' },
  { name: 'git_status', description: 'Inspect project Git status.' },
  { name: 'git_diff', description: 'Inspect project Git diff.' },
  { name: 'run_command', description: 'Run an allowlisted executable with bounded output.' },
  { name: 'run_tests', description: 'Run the project test command without a shell.' },
];

export async function executeLocalTool(name: LocalToolName, input: Record<string, unknown>, context: LocalToolContext): Promise<LocalToolResult> {
  try {
    if (name === 'read_file') return { ok: true, data: { path: input.path, content: await readSafe(context, String(input.path)) } };
    if (name === 'list_files') {
      const requested = String(input.path || '.');
      const directory = safePath(context, requested);
      const entries = await fs.readdir(directory, { withFileTypes: true });
      return { ok: true, data: { path: requested, files: entries.filter(entry => !entry.isSymbolicLink()).map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })) } };
    }
    if (name === 'search_files') {
      const needle = String(input.pattern ?? input.query ?? '');
      if (!needle) throw new Error('SEARCH_QUERY_REQUIRED');
      const target = safePath(context, String(input.path || '.'));
      const entries = await fs.readdir(target, { withFileTypes: true });
      const matches: Array<Record<string, unknown>> = [];
      for (const entry of entries.filter(item => item.isFile())) {
        const relative = path.join(String(input.path || '.'), entry.name);
        try { const content = await readSafe(context, relative); if (content.includes(needle)) matches.push({ path: relative }); } catch { /* skip unsupported files */ }
      }
      return { ok: true, data: { matches } };
    }
    if (name === 'write_file') {
      const target = safePath(context, String(input.path), true);
      const content = String(input.content ?? '');
      if (Buffer.byteLength(content) > MAX_READ_BYTES) throw new Error('FILE_TOO_LARGE');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
      return { ok: true, data: { path: input.path, bytes: Buffer.byteLength(content) } };
    }
    if (name === 'apply_patch') {
      const requested = String(input.path);
      const original = await readSafe(context, requested);
      const oldText = String(input.old_text ?? '');
      const newText = String(input.new_text ?? '');
      if (!oldText || !original.includes(oldText) || original.indexOf(oldText) !== original.lastIndexOf(oldText)) throw new Error('PATCH_CONTEXT_INVALID');
      const target = safePath(context, requested, true);
      await fs.writeFile(target, original.replace(oldText, newText), 'utf8');
      return { ok: true, data: { path: requested } };
    }
    if (name === 'git_status') return runAllowed(context, ['git', 'status', '--short']);
    if (name === 'git_diff') return runAllowed(context, ['git', 'diff', '--', '.']);
    if (name === 'run_tests') return runAllowed(context, ['npm', 'test', '--', '--run']);
    return runAllowed(context, input.command as string | string[]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'LOCAL_TOOL_FAILED' };
  }
}
