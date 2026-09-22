import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_READ_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_PATH_LENGTH = 4096;

export type LocalToolName =
  | 'list_files' | 'read_file' | 'search_files' | 'write_file' | 'apply_patch'
  | 'git_status' | 'git_diff'
  | 'npm_test' | 'npm_build' | 'npm_install' | 'node_script'
  | 'run_command' | 'run_tests';

export interface LocalToolContext {
  projectRoot: string;
  approvedWritePaths?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface LocalToolResult { ok: boolean; data?: Record<string, unknown>; error?: string; approval_required?: boolean; }

function bounded(value: string): string {
  return value.length > MAX_OUTPUT_BYTES ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n[output truncated]` : value;
}

function canonicalRoot(root: string): string {
  const resolved = fsSync.realpathSync(root);
  if (!fsSync.statSync(resolved).isDirectory()) throw new Error('PROJECT_ROOT_REQUIRED');
  return resolved;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateRequestedPath(requested: string): void {
  if (!requested || requested.length > MAX_PATH_LENGTH || requested.includes('\0')) throw new Error('INVALID_PATH');
  if (path.isAbsolute(requested) || path.win32.isAbsolute(requested) || path.posix.isAbsolute(requested)) {
    throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
  }
  // Reject explicit traversal before normalization. This also handles mixed separators on Windows.
  const segments = requested.replace(/\\/g, '/').split('/');
  if (segments.includes('..')) throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
}

function validateExistingAncestors(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (!isWithinRoot(root, candidate)) throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
  const segments = relative === '' ? [] : relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fsSync.existsSync(current)) break;
    const stat = fsSync.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('SYMLINK_ESCAPE');
    const real = fsSync.realpathSync(current);
    if (!isWithinRoot(root, real)) throw new Error('SYMLINK_ESCAPE');
  }
}

function safePath(context: LocalToolContext, requested: string, write = false): string {
  validateRequestedPath(requested);
  const root = canonicalRoot(context.projectRoot);
  const candidate = path.resolve(root, requested);
  if (!isWithinRoot(root, candidate)) throw new Error('PATH_OUTSIDE_PROJECT_ROOT');
  validateExistingAncestors(root, candidate);

  if (write && context.approvedWritePaths) {
    const normalizedRequested = path.normalize(requested);
    const approved = context.approvedWritePaths.some(item => {
      try {
        validateRequestedPath(item);
        return path.normalize(item) === normalizedRequested;
      } catch {
        return false;
      }
    });
    if (!approved) throw new Error('WRITE_TARGET_NOT_APPROVED');
  }
  return candidate;
}

function revalidateWriteTarget(context: LocalToolContext, requested: string): string {
  const target = safePath(context, requested, true);
  // mkdir may race with another process or expose a link/junction created after the first check.
  fsSync.mkdirSync(path.dirname(target), { recursive: true });
  return safePath(context, requested, true);
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

function rejectUnsafeArg(arg: string): void {
  if (arg.includes('\0') || /[\r\n]/.test(arg)) throw new Error('COMMAND_ARGUMENT_NOT_ALLOWED');
}

function parseLegacyCommand(command: string | string[]): string[] {
  // String commands are retained only for compatibility. Quotes/pipes/redirection are intentionally unsupported.
  const parts = Array.isArray(command) ? command : command.trim().split(/\s+/);
  if (!parts.length || !parts[0]) throw new Error('COMMAND_NOT_ALLOWED');
  parts.forEach(rejectUnsafeArg);
  return parts;
}

function validateGitArgs(args: string[]): void {
  const sub = args[0]?.toLowerCase();
  const lowered = args.map(arg => arg.toLowerCase());
  const destructive =
    (sub === 'reset' && lowered.includes('--hard'))
    || (sub === 'clean' && lowered.some(arg => arg === '-fd' || arg === '-df' || arg === '-fx' || arg === '-xdf'))
    || (sub === 'push' && lowered.some(arg => arg === '--force' || arg === '-f' || arg === '--force-with-lease'))
    || lowered.includes('--delete');
  if (destructive) throw new Error('DESTRUCTIVE_COMMAND_DENIED');
  if (!['status', 'diff'].includes(sub)) throw new Error('COMMAND_NOT_ALLOWED');
}

function validateNpmArgs(args: string[]): void {
  const sub = args[0]?.toLowerCase();
  if (sub === 'test') return;
  if (sub === 'run' && args.length >= 2 && ['test', 'build'].includes(args[1].toLowerCase())) return;
  throw new Error('COMMAND_NOT_ALLOWED');
}

function legacyCommandParts(command: string | string[]): { executable: string; args: string[] } {
  const parts = parseLegacyCommand(command);
  const executable = parts[0].toLowerCase();
  const args = parts.slice(1);
  if (executable === 'git') validateGitArgs(args);
  else if (executable === 'npm' || executable === 'npm.cmd') validateNpmArgs(args);
  else if (executable === 'node' || executable === 'node.exe') throw new Error('COMMAND_NOT_ALLOWED');
  else throw new Error('COMMAND_NOT_ALLOWED');
  return { executable, args };
}

async function runExecutable(context: LocalToolContext, executable: string, args: string[]): Promise<LocalToolResult> {
  try {
    args.forEach(rejectUnsafeArg);
    const result = await execFileAsync(executable, args, {
      cwd: canonicalRoot(context.projectRoot),
      timeout: context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      signal: context.signal,
      shell: false,
    });
    return { ok: true, data: { stdout: bounded(result.stdout), stderr: bounded(result.stderr), executable, args } };
  } catch (error: any) {
    // Windows may keep the executable/file handle for a few milliseconds after kill.
    // Do not report completion until the child has had a chance to release it.
    if (context.signal?.aborted || error?.name === 'AbortError') {
      await new Promise(resolve => setTimeout(resolve, 60));
      return { ok: false, error: 'TOOL_RUN_CANCELLED' };
    }
    if (error?.killed || error?.code === 'ETIMEDOUT') {
      await new Promise(resolve => setTimeout(resolve, 60));
      return { ok: false, error: 'COMMAND_TIMEOUT' };
    }
    return { ok: false, error: bounded(error?.stderr || error?.message || 'COMMAND_FAILED') };
  }
}

async function runLegacyCommand(context: LocalToolContext, command: string | string[]): Promise<LocalToolResult> {
  try {
    const { executable, args } = legacyCommandParts(command);
    return await runExecutable(context, executable, args);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'COMMAND_NOT_ALLOWED' };
  }
}

function nodeScriptPath(context: LocalToolContext, requested: string): string {
  const target = safePath(context, requested);
  const extension = path.extname(target).toLowerCase();
  if (!['.js', '.mjs', '.cjs'].includes(extension)) throw new Error('NODE_SCRIPT_NOT_ALLOWED');
  const stat = fsSync.statSync(target);
  if (!stat.isFile()) throw new Error('NODE_SCRIPT_NOT_ALLOWED');
  return path.relative(canonicalRoot(context.projectRoot), target);
}

export const localToolDefinitions: Array<{ name: LocalToolName; description: string }> = [
  { name: 'list_files', description: 'List files within the project root.' },
  { name: 'read_file', description: 'Read a bounded text file within the project root.' },
  { name: 'search_files', description: 'Search bounded text files within the project root.' },
  { name: 'write_file', description: 'Write an approved text file within the project root.' },
  { name: 'apply_patch', description: 'Apply a simple exact replacement to an approved file.' },
  { name: 'git_status', description: 'Inspect project Git status.' },
  { name: 'git_diff', description: 'Inspect project Git diff.' },
  { name: 'npm_test', description: 'Run the project test suite without a shell.' },
  { name: 'npm_build', description: 'Run the project build script without a shell.' },
  { name: 'npm_install', description: 'Install project dependencies without a shell. High-risk and approval-gated by registry.' },
  { name: 'node_script', description: 'Run an existing JavaScript entrypoint inside the project root. Inline evaluation is forbidden.' },
  { name: 'run_command', description: 'Legacy restricted command compatibility tool. Git status/diff and npm test/build only.' },
  { name: 'run_tests', description: 'Legacy alias for npm_test.' },
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
      const requested = String(input.path || '.');
      const target = safePath(context, requested);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const matches: Array<Record<string, unknown>> = [];
      for (const entry of entries.filter(item => item.isFile() && !item.isSymbolicLink())) {
        const relative = path.join(requested, entry.name);
        try {
          const content = await readSafe(context, relative);
          if (content.includes(needle)) matches.push({ path: relative });
        } catch { /* bounded search skips unsupported files */ }
      }
      return { ok: true, data: { matches } };
    }
    if (name === 'write_file') {
      const requested = String(input.path);
      const content = String(input.content ?? '');
      if (Buffer.byteLength(content) > MAX_READ_BYTES) throw new Error('FILE_TOO_LARGE');
      const target = revalidateWriteTarget(context, requested);
      await fs.writeFile(target, content, { encoding: 'utf8', flag: 'w' });
      // Revalidate after the write so a raced link/junction is detected and surfaced.
      safePath(context, requested, true);
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
      safePath(context, requested, true);
      return { ok: true, data: { path: requested } };
    }
    if (name === 'git_status') return runExecutable(context, 'git', ['status', '--short']);
    if (name === 'git_diff') return runExecutable(context, 'git', ['diff', '--', '.']);
    if (name === 'npm_test' || name === 'run_tests') return runExecutable(context, 'npm', ['test', '--', '--run']);
    if (name === 'npm_build') return runExecutable(context, 'npm', ['run', 'build']);
    if (name === 'npm_install') return runExecutable(context, 'npm', ['install']);
    if (name === 'node_script') {
      const script = nodeScriptPath(context, String(input.path ?? ''));
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      return runExecutable(context, 'node', [script, ...args]);
    }
    return runLegacyCommand(context, input.command as string | string[]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'LOCAL_TOOL_FAILED' };
  }
}
