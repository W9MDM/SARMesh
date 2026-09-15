/**
 * electron-builder beforePack hook — copy the staged per-arch Reticulum sidecar into
 * resources/reticulum-sidecar/ so extraResources bundles the correct binary.
 * Also attaches SCHEMA-UPGRADE.txt when CI wrote a schema-bump notice.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MIN_SIDECAR_BYTES,
  packSidecarResourcePath,
  resolveStagedSidecarPathForPackContext,
} from './reticulum-sidecar-staging.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const SCHEMA_UPGRADE_TXT = path.join(projectRoot, 'resources', 'SCHEMA-UPGRADE.txt');

/**
 * @param {import('app-builder-lib').BeforePackContext} context
 */
export default async function beforePack(context) {
  const platform = context.electronPlatformName;
  if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin') {
    throw new Error(`[beforePack] Unsupported electronPlatformName: ${platform}`);
  }

  const stagedPath = resolveStagedSidecarPathForPackContext(projectRoot, platform, context.arch);
  if (!existsSync(stagedPath)) {
    // The sidecar is a Rust binary, so a machine without a Rust toolchain cannot
    // produce one and therefore cannot make a local test build at all. This
    // opt-out unblocks that, and only that: it is never set in CI or by any
    // dist:* script, so a real release still fails hard rather than shipping an
    // app whose Reticulum features are silently absent. The app already handles
    // the missing binary at runtime (RETICULUM_SIDECAR_BUNDLED_MISSING).
    if (process.env.SARMESH_ALLOW_MISSING_SIDECAR === '1') {
      console.warn(
        `[beforePack] WARNING: no Reticulum sidecar for ${platform}/${context.arch}. ` +
          'SARMESH_ALLOW_MISSING_SIDECAR=1 is set, so packaging continues. This build is ' +
          'for TESTING ONLY — Reticulum/LXMF features will be unavailable in it. ' +
          'Do not distribute it as a release.',
      );
      return;
    }
    throw new Error(
      `[beforePack] Staged Reticulum sidecar missing for ${platform} arch ${context.arch}: ${stagedPath}. Run node scripts/build-reticulum-sidecar-release.mjs --platform ${platform} before dist.`,
    );
  }

  const size = statSync(stagedPath).size;
  if (size < MIN_SIDECAR_BYTES) {
    throw new Error(
      `[beforePack] Staged Reticulum sidecar too small (${size} bytes): ${stagedPath}`,
    );
  }

  const destPath = packSidecarResourcePath(projectRoot, platform);
  mkdirSync(path.dirname(destPath), { recursive: true });
  copyFileSync(stagedPath, destPath);
  console.debug(`[beforePack] Reticulum sidecar: ${stagedPath} → ${destPath}`);

  if (existsSync(SCHEMA_UPGRADE_TXT)) {
    const config = context.packager.config;
    const existing = config.extraResources;
    /** @type {Array<string | { from: string, to?: string, filter?: string[] }>} */
    const list = Array.isArray(existing) ? [...existing] : existing ? [existing] : [];
    const already = list.some(
      (entry) =>
        typeof entry === 'object' &&
        entry != null &&
        'from' in entry &&
        String(entry.from).includes('SCHEMA-UPGRADE.txt'),
    );
    if (!already) {
      list.push({
        from: SCHEMA_UPGRADE_TXT,
        to: 'SCHEMA-UPGRADE.txt',
      });
      config.extraResources = list;
      console.debug('[beforePack] Bundling SCHEMA-UPGRADE.txt notice');
    }
  }
}
