#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeModules = path.join(root, 'node_modules');
const packageLock = path.join(root, 'package-lock.json');
const installedLock = path.join(nodeModules, '.package-lock.json');

function run(args) {
  console.log(`\n> npm ${args.join(' ')}`);
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: 'inherit',
    // npm is a .cmd shim on Windows, which Node can only launch through a shell.
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 17)) {
  console.error(`RetroShelf needs Node.js 22.17 or newer (found ${process.versions.node}).`);
  process.exit(1);
}

const needsInstall =
  !existsSync(nodeModules) ||
  !existsSync(installedLock) ||
  (existsSync(packageLock) && statSync(packageLock).mtimeMs > statSync(installedLock).mtimeMs);

if (needsInstall) run(['ci']);
run(['test']);
run(['run', 'package']);

const outDir = path.join(root, 'out');
const built = existsSync(outDir)
  ? readdirSync(outDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(outDir, entry.name))
      .flatMap((dir) => readdirSync(dir).map((name) => path.join(dir, name)))
      .find((file) => /^RetroShelf(\.app|\.exe)?$/.test(path.basename(file)))
  : null;

if (built) console.log(`\nBuilt: ${path.relative(root, built)}`);
else console.log('\nBuild finished. The packaged app is in out/.');
