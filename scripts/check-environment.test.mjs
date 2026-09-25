// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatCheckResult,
  formatLocalActDockerNote,
  evaluateContainerEngineCheck,
  evaluatePlaywrightCheck,
  evaluateWindowsBuildDepsCheck,
  parseCheckEnvironmentArgs,
  parseVersion,
  resolveExitCode,
  resolvePnpmBinCandidates,
  resolveWindowsCommand,
  versionGte,
} from './check-environment.mjs';

describe('check-environment resolveWindowsCommand', () => {
  // Node does not apply PATHEXT without `shell: true`, so a tool that exists
  // only as a .cmd shim (pnpm installed via npm) was reported ENOENT on a
  // machine where it ran fine — which blocked `pnpm run release`.
  const env = { PATH: 'C:\\tools;C:\\npm', PATHEXT: '.EXE;.CMD' };
  const exists = (p) => p === 'C:\\npm\\pnpm.CMD' || p === 'C:\\tools\\git.EXE';

  it('resolves a bare name to the shim found on PATH', () => {
    expect(resolveWindowsCommand('pnpm', env, 'win32', exists)).toBe('C:\\npm\\pnpm.CMD');
  });

  it('honours PATH order over PATHEXT order', () => {
    expect(resolveWindowsCommand('git', env, 'win32', exists)).toBe('C:\\tools\\git.EXE');
  });

  it('leaves the command alone when nothing matches', () => {
    expect(resolveWindowsCommand('nope', env, 'win32', exists)).toBe('nope');
  });

  it('does not touch an explicit path or an extension already given', () => {
    expect(resolveWindowsCommand('C:\\x\\y.exe', env, 'win32', exists)).toBe('C:\\x\\y.exe');
    expect(resolveWindowsCommand('pnpm.cmd', env, 'win32', exists)).toBe('pnpm.cmd');
  });

  it('is a no-op off Windows, where spawn resolves PATH itself', () => {
    expect(resolveWindowsCommand('pnpm', env, 'linux', exists)).toBe('pnpm');
  });
});

describe('check-environment resolvePnpmBinCandidates', () => {
  it('returns Windows PNPM_HOME shim paths including bin/', () => {
    expect(resolvePnpmBinCandidates('C:\\pnpm-home', 'win32')).toEqual([
      'C:\\pnpm-home\\pnpm.CMD',
      'C:\\pnpm-home\\pnpm.cmd',
      'C:\\pnpm-home\\pnpm.exe',
      'C:\\pnpm-home\\bin\\pnpm.CMD',
      'C:\\pnpm-home\\bin\\pnpm.cmd',
      'C:\\pnpm-home\\bin\\pnpm.exe',
    ]);
  });

  it('returns empty for non-Windows or missing PNPM_HOME', () => {
    expect(resolvePnpmBinCandidates('C:\\pnpm-home', 'linux')).toEqual([]);
    expect(resolvePnpmBinCandidates(undefined, 'win32')).toEqual([]);
  });
});

describe('check-environment evaluateWindowsBuildDepsCheck', () => {
  it('passes when cl is on PATH', () => {
    expect(
      evaluateWindowsBuildDepsCheck({ clOnPath: true, vswhereInstallPath: null }),
    ).toMatchObject({
      status: 'pass',
      detail: 'MSVC compiler (cl) found',
    });
  });

  it('passes when vswhere reports a VC Tools install', () => {
    expect(
      evaluateWindowsBuildDepsCheck({
        clOnPath: false,
        vswhereInstallPath: 'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
      }),
    ).toMatchObject({
      status: 'pass',
      detail: expect.stringContaining('vswhere'),
    });
  });

  it('warns, but does not block, when neither cl nor vswhere VC Tools are available', () => {
    // The project builds no native code on Windows (electron-builder runs with
    // npmRebuild: false and installers come from CI), so a missing MSVC must
    // not fail the gate that `pnpm run release` depends on.
    expect(
      evaluateWindowsBuildDepsCheck({ clOnPath: false, vswhereInstallPath: null }),
    ).toMatchObject({
      status: 'warn',
      severity: 'optional',
    });
  });
});

describe('check-environment parseCheckEnvironmentArgs', () => {
  it('defaults skipNodeModules to false', () => {
    expect(parseCheckEnvironmentArgs([])).toEqual({ skipNodeModules: false });
  });

  it('enables skipNodeModules for --skip-node-modules', () => {
    expect(parseCheckEnvironmentArgs(['--skip-node-modules'])).toEqual({
      skipNodeModules: true,
    });
  });
});

describe('check-environment parseVersion', () => {
  it('parses v-prefixed semver strings', () => {
    expect(parseVersion('v22.13.0')).toEqual({ major: 22, minor: 13, patch: 0 });
  });

  it('parses plain semver strings', () => {
    expect(parseVersion('18.19.0')).toEqual({ major: 18, minor: 19, patch: 0 });
  });

  it('parses version embedded in command output', () => {
    expect(parseVersion('git version 2.43.0')).toEqual({ major: 2, minor: 43, patch: 0 });
  });

  it('returns null for unparseable strings', () => {
    expect(parseVersion('not-a-version')).toBeNull();
  });
});

describe('check-environment versionGte', () => {
  it('accepts versions at or above the minimum', () => {
    expect(versionGte('v22.13.0', '>=22.13.0')).toBe(true);
    expect(versionGte('22.14.0', '>=22.13.0')).toBe(true);
    expect(versionGte('23.0.0', '>=22.13.0')).toBe(true);
  });

  it('rejects versions below the minimum', () => {
    expect(versionGte('v18.19.0', '>=22.13.0')).toBe(false);
    expect(versionGte('22.12.9', '>=22.13.0')).toBe(false);
  });

  it('compares pnpm-style versions', () => {
    expect(versionGte('10.0.0', '>=10.0.0')).toBe(true);
    expect(versionGte('9.15.0', '>=10.0.0')).toBe(false);
  });
});

describe('check-environment formatCheckResult', () => {
  it('formats pass results without hints', () => {
    expect(
      formatCheckResult({
        status: 'pass',
        severity: 'required',
        label: 'Git',
        detail: '2.43.0',
      }),
    ).toEqual(['✅ Git — 2.43.0']);
  });

  it('formats fail results with hints', () => {
    expect(
      formatCheckResult({
        status: 'fail',
        severity: 'required',
        label: 'pnpm 11+ required',
        detail: 'not found',
        hint: 'corepack enable && corepack prepare pnpm@11 --activate',
      }),
    ).toEqual([
      '❌ pnpm 11+ required — not found',
      '   → corepack enable && corepack prepare pnpm@11 --activate',
    ]);
  });

  it('formats warn results with hints', () => {
    expect(
      formatCheckResult({
        status: 'warn',
        severity: 'optional',
        label: 'Container engine not found (optional)',
        hint: 'Install Docker or Podman',
      }),
    ).toEqual(['⚠️ Container engine not found (optional)', '   → Install Docker or Podman']);
  });
});

describe('check-environment resolveExitCode', () => {
  it('returns 1 when a required check fails', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'fail', severity: 'required', label: 'Node.js' },
      ]),
    ).toBe(1);
  });

  it('returns 0 when only optional checks warn', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'warn', severity: 'optional', label: 'Docker' },
      ]),
    ).toBe(0);
  });

  it('returns 0 when all required checks pass', () => {
    expect(
      resolveExitCode([
        { status: 'pass', severity: 'required', label: 'Git' },
        { status: 'pass', severity: 'required', label: 'Node.js' },
      ]),
    ).toBe(0);
  });
});

describe('check-environment formatLocalActDockerNote', () => {
  it('returns null when neither container engine nor act checks are present', () => {
    expect(
      formatLocalActDockerNote([{ status: 'pass', severity: 'required', label: 'Git' }]),
    ).toBeNull();
  });

  it('returns paired missing note when container engine or act warns', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'warn', severity: 'optional', label: 'Container engine not found (optional)' },
        { status: 'pass', severity: 'optional', label: 'act', detail: '0.2.0' },
      ]),
    ).toContain('act:ci:native');
  });

  it('returns ready note when both container engine and act pass', () => {
    expect(
      formatLocalActDockerNote([
        { status: 'pass', severity: 'optional', label: 'Container engine', detail: 'Podman 5.8.5' },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });

  it('suggests native mode when act is ready but container engine is not', () => {
    expect(
      formatLocalActDockerNote([
        {
          status: 'warn',
          severity: 'optional',
          label: 'Container engine not running (optional)',
        },
        { status: 'pass', severity: 'optional', label: 'act', detail: 'act version 0.2.76' },
      ]),
    ).toContain('act:ci:native');
  });
});

describe('check-environment evaluateContainerEngineCheck', () => {
  it('prefers Podman when both engines are ready', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: '/opt/podman/bin/podman',
      dockerOk: true,
      podmanOk: true,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: 'podman version 5.8.5',
      socket: '/var/run/docker.sock',
    });
    expect(result).toMatchObject({
      status: 'pass',
      label: 'Container engine',
    });
    expect(result.detail).toContain('podman version 5.8.5');
    expect(result.detail).toContain('/var/run/docker.sock');
    expect(result.detail).not.toContain('Docker version');
  });

  it('falls back to Docker when only Docker is ready', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: null,
      dockerOk: true,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: null,
      socket: '/Users/test/.docker/run/docker.sock',
    });
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('Docker version 28.0.0');
  });

  it('reports not running when a CLI is present but info fails', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: null,
      dockerOk: false,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: null,
    });
    expect(result).toMatchObject({
      status: 'warn',
      label: 'Container engine not running (optional)',
      detail: 'Docker version 28.0.0',
    });
    expect(result.hint).toContain('Podman Desktop');
  });

  it('prefers Podman detail when both CLIs are present but neither info succeeds', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: '/usr/local/bin/docker',
      podmanPath: '/opt/podman/bin/podman',
      dockerOk: false,
      podmanOk: false,
      dockerVersion: 'Docker version 28.0.0',
      podmanVersion: 'podman version 5.8.5',
    });
    expect(result.label).toBe('Container engine not running (optional)');
    expect(result.detail).toBe('podman version 5.8.5');
  });

  it('reports not found when no CLI is on PATH', () => {
    const result = evaluateContainerEngineCheck({
      dockerPath: null,
      podmanPath: null,
      dockerOk: false,
      podmanOk: false,
      dockerVersion: null,
      podmanVersion: null,
      hasPodmanApp: true,
    });
    expect(result).toMatchObject({
      status: 'warn',
      label: 'Container engine not found (optional)',
    });
    expect(result.hint).toContain('/opt/podman/bin');
  });
});

describe('check-environment evaluatePlaywrightCheck', () => {
  it('passes when package resolves and version is available', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: true,
      versionOutput: 'Version 1.62.1',
      platform: 'darwin',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'pass',
      severity: 'optional',
      label: 'Playwright',
      detail: 'Version 1.62.1',
    });
  });

  it('warns when Playwright is missing', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: false,
      versionOutput: null,
      platform: 'darwin',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'warn',
      severity: 'optional',
      label: 'Playwright not found (optional)',
    });
    expect(results[0].hint).toContain('pnpm install');
  });

  it('warns when package resolves but CLI version check fails', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: true,
      versionOutput: null,
      platform: 'darwin',
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: 'warn',
      severity: 'optional',
      label: 'Playwright CLI failed (optional)',
    });
    expect(results[0].hint).toContain('playwright --version');
    expect(results[0].hint).not.toContain('pnpm install');
  });

  it('warns on Linux when DISPLAY is unset even if xvfb-run is installed', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: true,
      versionOutput: 'Version 1.62.1',
      platform: 'linux',
      hasDisplay: false,
      hasXvfbRun: true,
    });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('pass');
    expect(results[1]).toMatchObject({
      status: 'warn',
      label: 'Linux display for E2E (optional)',
    });
    expect(results[1].hint).toContain('xvfb-run -a');
  });

  it('warns on Linux when DISPLAY is unset and xvfb-run is missing', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: true,
      versionOutput: 'Version 1.62.1',
      platform: 'linux',
      hasDisplay: false,
      hasXvfbRun: false,
    });
    expect(results).toHaveLength(2);
    expect(results[1].hint).toContain('install xvfb');
  });

  it('skips Linux display warn when DISPLAY is set', () => {
    const results = evaluatePlaywrightCheck({
      packageResolves: true,
      versionOutput: 'Version 1.62.1',
      platform: 'linux',
      hasDisplay: true,
      hasXvfbRun: false,
    });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
  });
});
