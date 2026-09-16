/**
 * Downloads a Meshtastic release and writes it to a connected radio.
 *
 * The offsets come from `buildCleanInstallPlan` / `buildUpdatePlan`; this module
 * only fetches the bytes those plans name and hands them to the shared ESP32
 * write core, so there is exactly one place where addresses are decided.
 */
import type { FlashPlan } from '@/shared/meshtasticFirmware';

import type { Esp32WriteOptions } from './esp32Flasher';
import { writeEsp32Images } from './esp32Flasher';
import { firmwareAssetUrl } from './meshtasticFirmwareCatalog';
import type { FlashProgressCallback } from './types';

/** Minimal fetch shape: enough to download a binary, easy to fake in tests. */
export type BinaryFetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}>;

/** A downloaded image, ready to write. */
export interface ResolvedFlashFile {
  name: string;
  address: number;
  data: Uint8Array;
}

/**
 * `dio` is forced for the T3-S3 family, which does not come back from `keep`.
 * Everything else keeps whatever the bootloader reports.
 */
export function flashModeForTarget(platformioTarget: string): 'dio' | 'keep' {
  return platformioTarget.startsWith('tlora-t3s3') ? 'dio' : 'keep';
}

/** Write options for a Meshtastic image set. */
export function esp32WriteOptionsFor(platformioTarget: string, plan: FlashPlan): Esp32WriteOptions {
  return {
    flashSize: 'keep',
    flashMode: flashModeForTarget(platformioTarget),
    flashFreq: 'keep',
    eraseAll: plan.eraseAll,
  };
}

/**
 * Fetch every file a plan names.
 *
 * Downloads run in plan order and report combined progress, because an operator
 * on a hotspot at a trailhead needs to see that something is happening during
 * what can be several megabytes.
 */
export async function downloadFlashPlan(
  plan: FlashPlan,
  version: string,
  fetchFn: BinaryFetchLike,
  onProgress?: (fraction: number) => void,
): Promise<ResolvedFlashFile[]> {
  const files: ResolvedFlashFile[] = [];
  for (const [index, file] of plan.files.entries()) {
    const url = firmwareAssetUrl(version, file.name);
    const response = await fetchFn(url);
    if (!response.ok) {
      // Name the file: "404" alone leaves an operator with nothing to act on.
      throw new Error(`Could not download ${file.name} (HTTP ${response.status})`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength === 0) {
      throw new Error(`${file.name} downloaded empty — refusing to flash`);
    }
    files.push({ name: file.name, address: file.address, data });
    onProgress?.((index + 1) / plan.files.length);
  }
  return files;
}

/** Guard against a plan whose images would run into each other. */
export function assertNoOverlap(files: readonly ResolvedFlashFile[]): void {
  const ordered = [...files].sort((a, b) => a.address - b.address);
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1];
    const end = previous.address + previous.data.byteLength;
    if (end > ordered[i].address) {
      throw new Error(
        `${previous.name} (${previous.data.byteLength} bytes at 0x${previous.address.toString(16)}) ` +
          `would overwrite ${ordered[i].name} at 0x${ordered[i].address.toString(16)}`,
      );
    }
  }
}

export interface FlashMeshtasticOptions {
  serialPort: SerialPort;
  platformioTarget: string;
  version: string;
  plan: FlashPlan;
  fetchFn: BinaryFetchLike;
  /** 0-100 across download then write. */
  onProgress?: FlashProgressCallback;
}

/**
 * Download and flash a Meshtastic release.
 *
 * Download is weighted as the first 30% of progress and the write the rest, so
 * the bar does not sit at zero through a large download and then jump.
 */
export async function flashMeshtasticFirmware(options: FlashMeshtasticOptions): Promise<void> {
  const { serialPort, platformioTarget, version, plan, fetchFn, onProgress } = options;

  const DOWNLOAD_SHARE = 0.3;
  const files = await downloadFlashPlan(plan, version, fetchFn, (fraction) => {
    onProgress?.(Math.floor(fraction * DOWNLOAD_SHARE * 100));
  });

  // Every image is in hand before the chip is touched: a download that fails
  // halfway must not leave a radio erased with nothing written.
  assertNoOverlap(files);

  await writeEsp32Images(
    serialPort,
    files.map((f) => ({ address: f.address, data: f.data })),
    esp32WriteOptionsFor(platformioTarget, plan),
    (percent) => {
      onProgress?.(Math.floor(DOWNLOAD_SHARE * 100 + (percent / 100) * (1 - DOWNLOAD_SHARE) * 100));
    },
  );
}
