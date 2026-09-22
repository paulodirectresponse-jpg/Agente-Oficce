import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = resolve(root, 'src-tauri/resources/runtime');
const builtServer = resolve(root, 'dist/server');
const packageJson = resolve(root, 'package.json');
const packageLock = resolve(root, 'package-lock.json');

if (!existsSync(builtServer)) {
  throw new Error('dist/server does not exist. Run npm run build first.');
}
if (!existsSync(packageLock)) {
  throw new Error('package-lock.json is required for a reproducible desktop runtime.');
}

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });

cpSync(builtServer, resolve(runtimeDir, 'server'), { recursive: true });
cpSync(packageLock, resolve(runtimeDir, 'package-lock.json'));

const rootPackage = JSON.parse(readFileSync(packageJson, 'utf8'));
writeFileSync(
  resolve(runtimeDir, 'package.json'),
  JSON.stringify({
    name: 'agent-office-desktop-runtime',
    version: rootPackage.version ?? '0.1.0',
    private: true,
    type: 'module',
    dependencies: rootPackage.dependencies ?? {},
  }, null, 2),
);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(
  npm,
  ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts=false'],
  {
    cwd: runtimeDir,
    stdio: 'inherit',
    env: process.env,
  },
);

console.log(`Desktop runtime prepared at ${runtimeDir}`);
