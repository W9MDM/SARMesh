import { describe, expect, it, vi } from 'vitest';

import type { FlashPlan } from '@/shared/meshtasticFirmware';

import type { BinaryFetchLike, ResolvedFlashFile } from './meshtasticFlasher';
import {
  assertNoOverlap,
  downloadFlashPlan,
  esp32WriteOptionsFor,
  flashModeForTarget,
} from './meshtasticFlasher';

const PLAN: FlashPlan = {
  files: [
    { name: 'firmware-tbeam-2.8.0.bin', address: 0x00 },
    { name: 'bleota.bin', address: 0x260000 },
    { name: 'littlefs-2.8.0.bin', address: 0x300000 },
  ],
  eraseAll: true,
  source: 'partition-scheme',
};

function bytesFetch(size = 1024, ok = true, status = 200): BinaryFetchLike {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(size)),
  });
}

function file(name: string, address: number, bytes: number): ResolvedFlashFile {
  return { name, address, data: new Uint8Array(bytes) };
}

describe('flashModeForTarget', () => {
  it('forces dio on the T3-S3 family', () => {
    expect(flashModeForTarget('tlora-t3s3-v1')).toBe('dio');
    expect(flashModeForTarget('tlora-t3s3-epaper')).toBe('dio');
  });

  it('keeps the bootloader setting elsewhere', () => {
    expect(flashModeForTarget('tbeam')).toBe('keep');
    expect(flashModeForTarget('heltec-v3')).toBe('keep');
  });
});

describe('esp32WriteOptionsFor', () => {
  it('erases for a clean install', () => {
    expect(esp32WriteOptionsFor('tbeam', PLAN)).toEqual({
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: true,
    });
  });

  it('never erases for an update — the node database has to survive', () => {
    const update: FlashPlan = {
      files: [{ name: 'u.bin', address: 0x10000 }],
      eraseAll: false,
      source: 'update',
    };
    expect(esp32WriteOptionsFor('tbeam', update).eraseAll).toBe(false);
  });
});

describe('downloadFlashPlan', () => {
  it('fetches every file from the version directory, in plan order', async () => {
    const fetchFn = bytesFetch();
    const files = await downloadFlashPlan(PLAN, 'v2.8.0', fetchFn);
    expect(files.map((f) => f.name)).toEqual(PLAN.files.map((f) => f.name));
    expect(vi.mocked(fetchFn).mock.calls.map((c) => c[0])).toEqual([
      'https://release.meshtastic.org/2.8.0/firmware-tbeam-2.8.0.bin',
      'https://release.meshtastic.org/2.8.0/bleota.bin',
      'https://release.meshtastic.org/2.8.0/littlefs-2.8.0.bin',
    ]);
  });

  it('keeps each file at the address the plan assigned', async () => {
    const files = await downloadFlashPlan(PLAN, 'v2.8.0', bytesFetch());
    expect(files.map((f) => f.address)).toEqual([0x00, 0x260000, 0x300000]);
  });

  it('reports progress as files land', async () => {
    const seen: number[] = [];
    await downloadFlashPlan(PLAN, 'v2.8.0', bytesFetch(), (f) => seen.push(f));
    expect(seen).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('names the file it could not download', async () => {
    await expect(downloadFlashPlan(PLAN, 'v2.8.0', bytesFetch(0, false, 404))).rejects.toThrow(
      /firmware-tbeam-2\.8\.0\.bin.*404/,
    );
  });

  it('refuses an empty download rather than writing zero bytes to flash', async () => {
    await expect(downloadFlashPlan(PLAN, 'v2.8.0', bytesFetch(0))).rejects.toThrow(
      /downloaded empty/,
    );
  });
});

describe('assertNoOverlap', () => {
  it('accepts images that fit their partitions', () => {
    expect(() => {
      assertNoOverlap([
        file('app.bin', 0x00, 0x1000),
        file('ota.bin', 0x260000, 0x1000),
        file('fs.bin', 0x300000, 0x1000),
      ]);
    }).not.toThrow();
  });

  it('rejects an app image that would run into the OTA partition', () => {
    // A 3MB app against a 2.5MB partition: silently truncating this is how a
    // radio comes back bricked.
    expect(() => {
      assertNoOverlap([file('app.bin', 0x00, 0x300000), file('ota.bin', 0x260000, 0x1000)]);
    }).toThrow(/app\.bin.*would overwrite.*ota\.bin/);
  });

  it('checks by address order, not array order', () => {
    expect(() => {
      assertNoOverlap([file('ota.bin', 0x260000, 0x1000), file('app.bin', 0x00, 0x300000)]);
    }).toThrow(/would overwrite/);
  });

  it('allows an image that ends exactly where the next begins', () => {
    expect(() => {
      assertNoOverlap([file('a.bin', 0x00, 0x1000), file('b.bin', 0x1000, 0x1000)]);
    }).not.toThrow();
  });

  it('is a no-op for a single-image update', () => {
    expect(() => {
      assertNoOverlap([file('u.bin', 0x10000, 0x200000)]);
    }).not.toThrow();
  });
});
