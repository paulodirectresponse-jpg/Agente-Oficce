import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

export type FullAccessToolRisk = 'read' | 'write' | 'execute' | 'external' | 'destructive';

export interface FullAccessToolDefinition {
  name: string;
  description: string;
  risk: FullAccessToolRisk;
  input_schema: Record<string, unknown>;
  default_enabled: boolean;
}

export interface FullAccessToolContext {
  projectRoot: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface FullAccessToolResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface ManagedProcess {
  process: ChildProcessWithoutNullStreams;
  command: string;
  startedAt: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const managedProcesses = new Map<string, ManagedProcess>();

function bounded(value: string): string {
  return value.length > MAX_OUTPUT_BYTES ? value.slice(-MAX_OUTPUT_BYTES) + '\n[output truncated]' : value;
}

function absolutePath(projectRoot: string, requested: string): string {
  if (!requested?.trim()) throw new Error('PATH_REQUIRED');
  const value = requested.trim();
  return path.resolve(path.isAbsolute(value) ? value : path.join(projectRoot, value));
}

function dangerousDeleteTarget(target: string): boolean {
  const normalized = path.resolve(target);
  const root = path.parse(normalized).root;
  if (normalized === root) return true;
  const home = path.resolve(os.homedir());
  if (normalized === home) return true;
  if (process.platform === 'win32') {
    const windowsDir = path.resolve(process.env.WINDIR || 'C:\\Windows');
    const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(v => path.resolve(String(v)));
    if (normalized.toLowerCase() === windowsDir.toLowerCase()) return true;
    if (programFiles.some(v => normalized.toLowerCase() === v.toLowerCase())) return true;
  }
  return normalized === '/' || normalized === '/usr' || normalized === '/etc' || normalized === '/bin' || normalized === '/sbin';
}

function executableForShell(): { executable: string; prefix: string[] } {
  return process.platform === 'win32'
    ? { executable: 'powershell.exe', prefix: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'] }
    : { executable: '/bin/sh', prefix: ['-lc'] };
}

async function runExecutable(
  executable: string,
  args: string[],
  context: FullAccessToolContext,
  cwd?: string,
  env?: Record<string, string>,
): Promise<FullAccessToolResult> {
  try {
    const result = await execFileAsync(executable, args, {
      cwd: cwd || context.projectRoot,
      timeout: context.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      signal: context.signal,
      env: { ...process.env, ...env },
      shell: false,
    });
    return {
      ok: true,
      data: {
        stdout: bounded(String(result.stdout ?? '')),
        stderr: bounded(String(result.stderr ?? '')),
        executable,
        args,
        cwd: cwd || context.projectRoot,
      },
    };
  } catch (error: any) {
    if (context.signal?.aborted || error?.name === 'AbortError') return { ok: false, error: 'TOOL_RUN_CANCELLED' };
    if (error?.killed || error?.code === 'ETIMEDOUT') return { ok: false, error: 'COMMAND_TIMEOUT' };
    return { ok: false, error: bounded(String(error?.stderr || error?.message || 'COMMAND_FAILED')) };
  }
}

async function runShell(command: string, context: FullAccessToolContext, cwd?: string): Promise<FullAccessToolResult> {
  if (!command.trim()) return { ok: false, error: 'COMMAND_REQUIRED' };
  const shell = executableForShell();
  return runExecutable(shell.executable, [...shell.prefix, command], context, cwd);
}

function startManagedProcess(command: string, context: FullAccessToolContext, cwd?: string): FullAccessToolResult {
  if (!command.trim()) return { ok: false, error: 'COMMAND_REQUIRED' };
  const shell = executableForShell();
  const id = crypto.randomUUID();
  const child = spawn(shell.executable, [...shell.prefix, command], {
    cwd: cwd || context.projectRoot,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  const entry: ManagedProcess = {
    process: child,
    command,
    startedAt: new Date().toISOString(),
    stdout: '',
    stderr: '',
    exitCode: null,
  };
  managedProcesses.set(id, entry);
  child.stdout.on('data', chunk => { entry.stdout = bounded(entry.stdout + String(chunk)); });
  child.stderr.on('data', chunk => { entry.stderr = bounded(entry.stderr + String(chunk)); });
  child.on('exit', code => { entry.exitCode = code; });
  context.signal?.addEventListener('abort', () => child.kill(), { once: true });
  return { ok: true, data: { process_id: id, pid: child.pid, command, cwd: cwd || context.projectRoot } };
}

function processStatus(id: string): FullAccessToolResult {
  const item = managedProcesses.get(id);
  if (!item) return { ok: false, error: 'PROCESS_NOT_FOUND' };
  return {
    ok: true,
    data: {
      process_id: id,
      pid: item.process.pid,
      running: item.exitCode === null && !item.process.killed,
      exit_code: item.exitCode,
      stdout: item.stdout,
      stderr: item.stderr,
      command: item.command,
      started_at: item.startedAt,
    },
  };
}

function stopProcess(id: string): FullAccessToolResult {
  const item = managedProcesses.get(id);
  if (!item) return { ok: false, error: 'PROCESS_NOT_FOUND' };
  item.process.kill();
  return { ok: true, data: { process_id: id, stopped: true } };
}

async function powershell(script: string, context: FullAccessToolContext): Promise<FullAccessToolResult> {
  if (process.platform !== 'win32') return { ok: false, error: 'WINDOWS_ONLY_TOOL' };
  return runExecutable('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], context);
}

function psQuote(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

async function ensureEdgeDebug(context: FullAccessToolContext): Promise<FullAccessToolResult> {
  if (process.platform !== 'win32') return { ok: false, error: 'BROWSER_AUTOMATION_REQUIRES_WINDOWS_EDGE' };
  try {
    const probe = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(1200) });
    if (probe.ok) return { ok: true, data: { already_running: true } };
  } catch {}
  const candidates = [
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)']!, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
  ].filter(Boolean);
  const edge = candidates.find(candidate => fsSync.existsSync(candidate));
  if (!edge) return { ok: false, error: 'EDGE_NOT_FOUND' };
  const profile = path.join(os.tmpdir(), 'agent-office-edge-profile');
  const child = spawn(edge, ['--remote-debugging-port=9222', '--remote-allow-origins=*', '--user-data-dir=' + profile, 'about:blank'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      const probe = await fetch('http://127.0.0.1:9222/json/version', { signal: AbortSignal.timeout(800) });
      if (probe.ok) return { ok: true, data: { launched: true, executable: edge } };
    } catch {}
  }
  return { ok: false, error: 'EDGE_DEBUG_START_FAILED' };
}

async function cdpCall(method: string, params: Record<string, unknown>, context: FullAccessToolContext): Promise<FullAccessToolResult> {
  const ready = await ensureEdgeDebug(context);
  if (!ready.ok) return ready;
  const payload = Buffer.from(JSON.stringify({ id: 1, method, params }), 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    "$targets=Invoke-RestMethod 'http://127.0.0.1:9222/json/list'",
    "$target=$targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1",
    "if(-not $target){ throw 'BROWSER_PAGE_NOT_FOUND' }",
    "$ws=[System.Net.WebSockets.ClientWebSocket]::new()",
    "$ct=[Threading.CancellationToken]::None",
    "$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl,$ct).GetAwaiter().GetResult()",
    "$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(" + psQuote(payload) + "))",
    "$bytes=[Text.Encoding]::UTF8.GetBytes($json)",
    "$seg=[ArraySegment[byte]]::new($bytes)",
    "$ws.SendAsync($seg,[System.Net.WebSockets.WebSocketMessageType]::Text,$true,$ct).GetAwaiter().GetResult()",
    "$buffer=New-Object byte[] 1048576",
    "while($true){",
    "  $recv=$ws.ReceiveAsync([ArraySegment[byte]]::new($buffer),$ct).GetAwaiter().GetResult()",
    "  $text=[Text.Encoding]::UTF8.GetString($buffer,0,$recv.Count)",
    "  $obj=$text | ConvertFrom-Json",
    "  if($obj.id -eq 1){ $text; break }",
    "}",
    "$ws.Dispose()",
  ].join(';');
  const result = await powershell(script, context);
  if (!result.ok) return result;
  const stdout = String(result.data?.stdout ?? '').trim();
  try {
    const parsed = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).pop() || '{}');
    if (parsed.error) return { ok: false, error: parsed.error.message || 'BROWSER_CDP_ERROR' };
    return { ok: true, data: { result: parsed.result ?? {} } };
  } catch {
    return { ok: false, error: 'BROWSER_CDP_INVALID_RESPONSE' };
  }
}

async function browserOpen(url: string, context: FullAccessToolContext): Promise<FullAccessToolResult> {
  const ready = await ensureEdgeDebug(context);
  if (!ready.ok) return ready;
  try {
    const response = await fetch('http://127.0.0.1:9222/json/new?' + encodeURIComponent(url), { method: 'PUT', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, error: 'BROWSER_OPEN_FAILED_' + response.status };
    const data = await response.json() as Record<string, unknown>;
    return { ok: true, data: { url, target_id: data.id } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'BROWSER_OPEN_FAILED' };
  }
}

async function computerScreenshot(requested: string, context: FullAccessToolContext): Promise<FullAccessToolResult> {
  if (process.platform !== 'win32') return { ok: false, error: 'WINDOWS_ONLY_TOOL' };
  const target = absolutePath(context.projectRoot, requested || path.join('.agent-office', 'screenshots', 'screen.png'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$b=[System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height',
    '$g=[System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)',
    '$bmp.Save(' + psQuote(target) + ',[System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose();$bmp.Dispose()',
  ].join(';');
  const result = await powershell(script, context);
  return result.ok ? { ok: true, data: { path: target } } : result;
}

async function commandExists(command: string, context: FullAccessToolContext): Promise<boolean> {
  const probe = process.platform === 'win32'
    ? await runExecutable('where.exe', [command], { ...context, timeoutMs: 3000 })
    : await runExecutable('/bin/sh', ['-lc', 'command -v ' + command], { ...context, timeoutMs: 3000 });
  return probe.ok;
}

export async function getFullAccessToolHealth(projectRoot: string, activeTest = false): Promise<Array<Record<string, unknown>>> {
  const context: FullAccessToolContext = { projectRoot, timeoutMs: 4000 };
  const results: Array<Record<string, unknown>> = [];
  const add = (id: string, label: string, status: string, detail: string) => results.push({ id, label, status, detail });
  add('files', 'Files', 'healthy', 'Leitura e escrita local disponíveis.');
  add('shell', process.platform === 'win32' ? 'PowerShell' : 'Shell', 'healthy', process.platform === 'win32' ? 'PowerShell disponível pelo Windows.' : 'Shell POSIX disponível.');
  const gitAvailable = await commandExists('git', context);
  add('git', 'Git', gitAvailable ? 'healthy' : 'unavailable', gitAvailable ? 'Git CLI encontrado.' : 'Git CLI não encontrado.');
  const ghAvailable = await commandExists('gh', context);
  add('github', 'GitHub', ghAvailable ? 'healthy' : 'unavailable', ghAvailable ? 'GitHub CLI encontrado; autenticação é validada no uso.' : 'Instale/autentique GitHub CLI (gh).');
  if (process.platform === 'win32') {
    const edgeCandidates = [
      process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)']!, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    ].filter(Boolean);
    const edgeInstalled = edgeCandidates.some(candidate => fsSync.existsSync(candidate));
    const browser = activeTest && edgeInstalled ? await ensureEdgeDebug(context) : null;
    const browserOk = edgeInstalled && (!activeTest || browser?.ok === true);
    add('browser', 'Browser', browserOk ? 'healthy' : 'unavailable', browserOk ? (activeTest ? 'Microsoft Edge automation testada e pronta.' : 'Microsoft Edge encontrado; use “Testar todas” para teste ativo.') : String(browser?.error ?? 'Microsoft Edge não encontrado.'));
    add('computer', 'Computer Use', 'healthy', 'Captura de tela, mouse e teclado disponíveis no Windows.');
  } else {
    add('browser', 'Browser', 'degraded', 'Automação visual principal é direcionada ao Windows desktop.');
    add('computer', 'Computer Use', 'unavailable', 'Computer Use nativo requer Windows.');
  }
  for (const [id, label, cli] of [['railway','Railway','railway'],['vercel','Vercel','vercel'],['netlify','Netlify','netlify'],['fly','Fly.io','flyctl']] as const) {
    const available = await commandExists(cli, context);
    add(id, label, available ? 'healthy' : 'unconfigured', available ? cli + ' CLI encontrado.' : cli + ' CLI não encontrado.');
  }
  return results;
}

export const fullAccessToolDefinitions: FullAccessToolDefinition[] = [
  { name: 'fs_create_directory', description: 'Create a directory anywhere the Agent Office process can access.', risk: 'write', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'fs_copy', description: 'Copy a file or directory on the local computer.', risk: 'write', default_enabled: true, input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from','to'], additionalProperties: false } },
  { name: 'fs_move', description: 'Move or rename a file or directory on the local computer.', risk: 'write', default_enabled: true, input_schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from','to'], additionalProperties: false } },
  { name: 'fs_delete', description: 'Delete a file or directory. Drive roots and critical OS roots are always blocked.', risk: 'destructive', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean' } }, required: ['path'], additionalProperties: false } },
  { name: 'fs_read_any', description: 'Read a bounded UTF-8 file using a relative or absolute path.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } },
  { name: 'fs_write_any', description: 'Write a UTF-8 file using a relative or absolute path.', risk: 'write', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path','content'], additionalProperties: false } },
  { name: 'shell_command', description: 'Execute a PowerShell command on Windows or a shell command on other platforms.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['command'], additionalProperties: false } },
  { name: 'process_start', description: 'Start a long-running shell process and return a process id.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' } }, required: ['command'], additionalProperties: false } },
  { name: 'process_status', description: 'Inspect stdout, stderr and status of a managed long-running process.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: { process_id: { type: 'string' } }, required: ['process_id'], additionalProperties: false } },
  { name: 'process_stop', description: 'Stop a managed long-running process.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { process_id: { type: 'string' } }, required: ['process_id'], additionalProperties: false } },
  { name: 'git_command', description: 'Run Git with arbitrary arguments inside a selected working directory.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' } }, required: ['args'], additionalProperties: false } },
  { name: 'github_command', description: 'Run GitHub CLI (gh) with arbitrary arguments using the current authenticated account.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { args: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' } }, required: ['args'], additionalProperties: false } },
  { name: 'browser_open', description: 'Open a URL in the managed Microsoft Edge automation session.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'browser_eval', description: 'Evaluate JavaScript in the active managed browser page and return the result.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { javascript: { type: 'string' } }, required: ['javascript'], additionalProperties: false } },
  { name: 'browser_click', description: 'Click the first DOM element matching a CSS selector.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'], additionalProperties: false } },
  { name: 'browser_type', description: 'Set an input value and dispatch input/change events for a CSS selector.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { selector: { type: 'string' }, text: { type: 'string' } }, required: ['selector','text'], additionalProperties: false } },
  { name: 'browser_text', description: 'Read text from the page or from the first element matching a CSS selector.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: { selector: { type: 'string' } }, additionalProperties: false } },
  { name: 'browser_upload', description: 'Set a local file on an input[type=file] using the browser DOM when permitted.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { selector: { type: 'string' }, path: { type: 'string' } }, required: ['selector','path'], additionalProperties: false } },
  { name: 'browser_download', description: 'Download a URL to a local file using the Agent Office runtime.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { url: { type: 'string' }, path: { type: 'string' } }, required: ['url','path'], additionalProperties: false } },
  { name: 'computer_screenshot', description: 'Capture the full Windows virtual desktop to a PNG file.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } },
  { name: 'computer_click', description: 'Move the Windows cursor and click at screen coordinates.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'string' } }, required: ['x','y'], additionalProperties: false } },
  { name: 'computer_type', description: 'Paste text into the currently focused Windows control.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } },
  { name: 'computer_hotkey', description: 'Send a Windows Forms SendKeys hotkey sequence, e.g. ^l or %{F4}.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { keys: { type: 'string' } }, required: ['keys'], additionalProperties: false } },
  { name: 'computer_scroll', description: 'Scroll the Windows mouse wheel by a delta.', risk: 'execute', default_enabled: true, input_schema: { type: 'object', properties: { delta: { type: 'number' } }, required: ['delta'], additionalProperties: false } },
  { name: 'deploy_command', description: 'Run a deployment CLI (Railway, Vercel, Netlify, Fly.io or custom) with arbitrary arguments.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { provider: { type: 'string' }, args: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' } }, required: ['provider','args'], additionalProperties: false } },
  { name: 'http_request', description: 'Call an HTTP API using arbitrary method, headers and optional body.', risk: 'external', default_enabled: true, input_schema: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, headers: { type: 'object' }, body: { type: 'string' } }, required: ['url'], additionalProperties: false } },
  { name: 'browser_screenshot', description: 'Capture the active managed browser viewport to a PNG file.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false } },
  { name: 'runtime_health', description: 'Test availability of the main Agent Office runtime tool families.', risk: 'read', default_enabled: true, input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

export async function executeFullAccessTool(
  name: string,
  input: Record<string, unknown>,
  context: FullAccessToolContext,
): Promise<FullAccessToolResult> {
  try {
    const cwd = input.cwd ? absolutePath(context.projectRoot, String(input.cwd)) : context.projectRoot;
    if (name === 'fs_create_directory') {
      const target = absolutePath(context.projectRoot, String(input.path));
      await fs.mkdir(target, { recursive: true });
      return { ok: true, data: { path: target } };
    }
    if (name === 'fs_copy') {
      const from = absolutePath(context.projectRoot, String(input.from));
      const to = absolutePath(context.projectRoot, String(input.to));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.cp(from, to, { recursive: true, force: true });
      return { ok: true, data: { from, to } };
    }
    if (name === 'fs_move') {
      const from = absolutePath(context.projectRoot, String(input.from));
      const to = absolutePath(context.projectRoot, String(input.to));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { ok: true, data: { from, to } };
    }
    if (name === 'fs_delete') {
      const target = absolutePath(context.projectRoot, String(input.path));
      if (dangerousDeleteTarget(target)) return { ok: false, error: 'CRITICAL_DELETE_TARGET_DENIED' };
      await fs.rm(target, { recursive: input.recursive !== false, force: true });
      return { ok: true, data: { path: target } };
    }
    if (name === 'fs_read_any') {
      const target = absolutePath(context.projectRoot, String(input.path));
      const stat = await fs.stat(target);
      if (!stat.isFile()) return { ok: false, error: 'FILE_REQUIRED' };
      if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'FILE_TOO_LARGE' };
      return { ok: true, data: { path: target, content: await fs.readFile(target, 'utf8') } };
    }
    if (name === 'fs_write_any') {
      const target = absolutePath(context.projectRoot, String(input.path));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(input.content ?? ''), 'utf8');
      return { ok: true, data: { path: target, bytes: Buffer.byteLength(String(input.content ?? '')) } };
    }
    if (name === 'shell_command') {
      const timeoutMs = Number(input.timeout_ms);
      return runShell(String(input.command ?? ''), { ...context, timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : context.timeoutMs }, cwd);
    }
    if (name === 'process_start') return startManagedProcess(String(input.command ?? ''), context, cwd);
    if (name === 'process_status') return processStatus(String(input.process_id ?? ''));
    if (name === 'process_stop') return stopProcess(String(input.process_id ?? ''));
    if (name === 'git_command') return runExecutable('git', Array.isArray(input.args) ? input.args.map(String) : [], context, cwd);
    if (name === 'github_command') return runExecutable(process.platform === 'win32' ? 'gh.exe' : 'gh', Array.isArray(input.args) ? input.args.map(String) : [], context, cwd);
    if (name === 'browser_open') return browserOpen(String(input.url ?? ''), context);
    if (name === 'browser_eval') return cdpCall('Runtime.evaluate', { expression: String(input.javascript ?? ''), returnByValue: true, awaitPromise: true }, context);
    if (name === 'browser_click') {
      const selector = JSON.stringify(String(input.selector ?? ''));
      return cdpCall('Runtime.evaluate', { expression: "(()=>{const e=document.querySelector(" + selector + ");if(!e)throw new Error('ELEMENT_NOT_FOUND');e.click();return true})()", returnByValue: true }, context);
    }
    if (name === 'browser_type') {
      const selector = JSON.stringify(String(input.selector ?? ''));
      const text = JSON.stringify(String(input.text ?? ''));
      const js = "(()=>{const e=document.querySelector(" + selector + ");if(!e)throw new Error('ELEMENT_NOT_FOUND');e.focus();e.value=" + text + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()";
      return cdpCall('Runtime.evaluate', { expression: js, returnByValue: true }, context);
    }
    if (name === 'browser_text') {
      const selector = input.selector ? JSON.stringify(String(input.selector)) : null;
      const js = selector ? "(()=>{const e=document.querySelector(" + selector + ");return e?e.innerText:null})()" : 'document.body.innerText';
      return cdpCall('Runtime.evaluate', { expression: js, returnByValue: true }, context);
    }
    if (name === 'browser_upload') {
      const filePath = absolutePath(context.projectRoot, String(input.path));
      if (!fsSync.existsSync(filePath)) return { ok: false, error: 'UPLOAD_FILE_NOT_FOUND' };
      const selector = JSON.stringify(String(input.selector ?? ''));
      const clicked = await cdpCall('Runtime.evaluate', {
        expression: "(()=>{const e=document.querySelector(" + selector + ");if(!e)throw new Error('ELEMENT_NOT_FOUND');e.click();return true})()",
        returnByValue: true,
      }, context);
      if (!clicked.ok) return clicked;
      await new Promise(resolve => setTimeout(resolve, 350));
      const encoded = Buffer.from(filePath, 'utf8').toString('base64');
      const script = "Add-Type -AssemblyName System.Windows.Forms;$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(" + psQuote(encoded) + "));Set-Clipboard -Value $t;[System.Windows.Forms.SendKeys]::SendWait('^v');Start-Sleep -Milliseconds 100;[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')";
      const selected = await powershell(script, context);
      return selected.ok ? { ok: true, data: { selector: String(input.selector), path: filePath } } : selected;
    }
    if (name === 'browser_download') {
      const target = absolutePath(context.projectRoot, String(input.path));
      const response = await fetch(String(input.url), { signal: context.signal });
      if (!response.ok) return { ok: false, error: 'DOWNLOAD_HTTP_' + response.status };
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      return { ok: true, data: { path: target, bytes: Number(response.headers.get('content-length') || 0) || undefined } };
    }
    if (name === 'computer_screenshot') return computerScreenshot(String(input.path ?? ''), context);
    if (name === 'computer_click') {
      const x = Math.trunc(Number(input.x)); const y = Math.trunc(Number(input.y));
      const right = String(input.button ?? 'left').toLowerCase() === 'right';
      const script = "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class AOInput{[DllImport(\"user32.dll\")]public static extern bool SetCursorPos(int X,int Y);[DllImport(\"user32.dll\")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,uint i);}' ; [AOInput]::SetCursorPos(" + x + "," + y + ") | Out-Null; [AOInput]::mouse_event(" + (right ? '8' : '2') + ",0,0,0,0); [AOInput]::mouse_event(" + (right ? '16' : '4') + ",0,0,0,0)";
      return powershell(script, context);
    }
    if (name === 'computer_type') {
      const value = Buffer.from(String(input.text ?? ''), 'utf8').toString('base64');
      const script = "Add-Type -AssemblyName System.Windows.Forms;$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(" + psQuote(value) + "));Set-Clipboard -Value $t;[System.Windows.Forms.SendKeys]::SendWait('^v')";
      return powershell(script, context);
    }
    if (name === 'computer_hotkey') {
      const keys = psQuote(String(input.keys ?? ''));
      return powershell('Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait(' + keys + ')', context);
    }
    if (name === 'computer_scroll') {
      const delta = Math.trunc(Number(input.delta) || 0);
      const script = "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class AOScroll{[DllImport(\"user32.dll\")]public static extern void mouse_event(uint f,uint dx,uint dy,uint d,uint i);}' ; [AOScroll]::mouse_event(2048,0,0," + delta + ",0)";
      return powershell(script, context);
    }
    if (name === 'deploy_command') {
      const provider = String(input.provider ?? '').toLowerCase();
      const executables: Record<string, string> = { railway: 'railway', vercel: 'vercel', netlify: 'netlify', fly: 'flyctl', 'fly.io': 'flyctl' };
      const executable = executables[provider] || String(input.provider ?? '');
      if (!executable) return { ok: false, error: 'DEPLOY_PROVIDER_REQUIRED' };
      return runExecutable(executable, Array.isArray(input.args) ? input.args.map(String) : [], context, cwd);
    }
    if (name === 'http_request') {
      const headers = input.headers && typeof input.headers === 'object' ? input.headers as Record<string, string> : {};
      const response = await fetch(String(input.url), {
        method: String(input.method || 'GET').toUpperCase(),
        headers,
        body: input.body == null ? undefined : String(input.body),
        signal: context.signal,
      });
      const body = await response.text();
      return {
        ok: response.ok,
        data: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body: bounded(body),
        },
        ...(response.ok ? {} : { error: 'HTTP_' + response.status }),
      };
    }
    if (name === 'browser_screenshot') {
      const target = absolutePath(context.projectRoot, String(input.path || path.join('.agent-office', 'screenshots', 'browser.png')));
      const captured = await cdpCall('Page.captureScreenshot', { format: 'png', fromSurface: true }, context);
      if (!captured.ok) return captured;
      const nested = captured.data?.result as { data?: string } | undefined;
      if (!nested?.data) return { ok: false, error: 'BROWSER_SCREENSHOT_EMPTY' };
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(nested.data, 'base64'));
      return { ok: true, data: { path: target } };
    }
    if (name === 'runtime_health') return { ok: true, data: { tools: await getFullAccessToolHealth(context.projectRoot, true) } };
    return { ok: false, error: 'FULL_ACCESS_TOOL_NOT_FOUND' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'FULL_ACCESS_TOOL_FAILED' };
  }
}
