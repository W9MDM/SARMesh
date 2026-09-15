import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Scripts that are executed directly (`"$dir/$script"`), not via `bash x.sh`.
 * Without mode 100755 in git these fail on Linux/macOS with "Permission denied"
 * — and the failure is invisible on Windows, where the filesystem carries no
 * executable bit, so a Windows-only contributor cannot notice it locally.
 *
 * This list is the tripwire for that whole class of bug: a fresh `git init` on
 * Windows (as this fork's baseline was created) silently records every file as
 * 100644, which broke the Linux and macOS CI builds.
 */
const MUST_BE_EXECUTABLE = [
  '.githooks/pre-commit',
  'scripts/release.sh',
  'scripts/clone-ratspeak-stack.sh',
  'scripts/ensure-rsReticulum-patches.sh',
];

/** git's recorded mode for a path, e.g. '100755'. */
function gitMode(relPath) {
  const out = execFileSync('git', ['ls-files', '-s', '--', relPath], {
    cwd: repoRoot,
    encoding: 'utf-8',
  }).trim();
  return out ? out.split(/\s+/)[0] : null;
}

describe('executable bits', () => {
  it.each(MUST_BE_EXECUTABLE)('%s is committed as executable', (relPath) => {
    const mode = gitMode(relPath);
    expect(mode, `${relPath} is not tracked by git`).not.toBeNull();
    expect(mode, `${relPath} must be mode 100755, not ${mode}`).toBe('100755');
  });

  it('every ratspeak overlay script the stack executes directly is executable', () => {
    // These are invoked as "${script_dir}/${s}" by
    // scripts/lib/ratspeak-overlay-apply-list.sh, so each needs the bit.
    const listed = execFileSync('git', ['ls-files', 'scripts/apply-rs*.sh'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean);

    expect(listed.length).toBeGreaterThan(0);
    const nonExecutable = listed.filter((f) => gitMode(f) !== '100755');
    expect(nonExecutable, `not executable: ${nonExecutable.join(', ')}`).toEqual([]);
  });
});
