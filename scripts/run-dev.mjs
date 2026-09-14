#!/usr/bin/env node
/**
 * Dev orchestrator: runs main/preload esbuild watch, Vite, and Electron via concurrently.
 * Uses direct esbuild/vite binaries (not nested `pnpm run`) so signal shutdown does not
 * produce pnpm ELIFECYCLE noise when Electron exits or the terminal sends SIGINT.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mainEsbuildExternalArgs } from './esbuild-main-externals.mjs';
import { assertPnpmMeetsRepoRequirement } from './check-package-manager.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** @param {number | null} code @param {NodeJS.Signals | null} signal */
export function resolveDevExitCode(code, signal) {
  if (signal === 'SIGINT' || signal === 'SIGTERM') return 0;
  if (code === 0 || code === null) return 0;
  return code;
}

export function buildDevConcurrentlyArgs() {
  const mainBuild = `esbuild src/main/index.ts --bundle --platform=node --outfile=dist-electron/main/index.js ${mainEsbuildExternalArgs().join(' ')} --format=cjs --watch`;
  const preloadBuild =
    'esbuild src/preload/index.ts --bundle --platform=node --outfile=dist-electron/preload/index.js --external:electron --format=cjs --watch';
  // `VAR=value cmd` is POSIX-only syntax that cmd.exe cannot parse, so these
  // are exported into the child environment in runDev() instead of being
  // prefixed here.
  const electronLaunch = 'node scripts/wait-for-dev.mjs && electron .';

  return [
    '-k',
    '-s',
    'command-electron',
    '--names',
    'main,preload,vite,electron',
    mainBuild,
    preloadBuild,
    'vite',
    electronLaunch,
  ];
}

export function runDev(argv = process.argv.slice(2), options = {}) {
  const assertPm = options.assertPnpmMeetsRepoRequirement ?? assertPnpmMeetsRepoRequirement;
  const spawnFn = options.spawn ?? spawn;
  const exitFn = options.exit ?? ((code) => process.exit(code));

  if (argv.length > 0) {
    console.error('[run-dev] Unexpected arguments:', argv.join(' '));
    exitFn(1);
    return;
  }

  const pmExit = assertPm({ repoRoot: projectRoot });
  if (pmExit !== 0) {
    exitFn(pmExit);
    return;
  }

  // Run concurrently's JS entry with this Node binary rather than the `.bin`
  // shim. On Windows the extensionless shim is a shell script the OS cannot
  // execute, and the `.cmd` alternative needs `shell: true`, which would
  // re-split the quoted esbuild/vite command strings below. Going straight to
  // the JS avoids both problems and behaves identically on POSIX.
  const concurrentlyBin = path.join(
    projectRoot,
    'node_modules',
    'concurrently',
    'dist',
    'bin',
    'concurrently.js',
  );
  const child = spawnFn(process.execPath, [concurrentlyBin, ...buildDevConcurrentlyArgs()], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: 'http://localhost:5173',
      ELECTRON_ENABLE_SECURITY_WARNINGS: '1',
      // VS Code exports this, which makes Electron boot as plain Node and the
      // window never appears. Dev always wants the real Electron runtime.
      ELECTRON_RUN_AS_NODE: undefined,
    },
  });

  child.on('error', (err) => {
    console.error('[run-dev] Failed to start concurrently:', err);
    exitFn(1);
  });

  child.on('exit', (code, signal) => {
    exitFn(resolveDevExitCode(code, signal));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDev();
}
