import { describe, expect, it } from 'vitest';

import type { FirmwareManifest } from './meshtasticFirmware';
import {
  buildCleanInstallPlan,
  buildUpdatePlan,
  compareFirmwareVersions,
  LEGACY_UPDATE_ADDRESS,
  manifestPartitionOffset,
  resolveCleanInstallOffsets,
  supportsNew8MBPartitionTable,
} from './meshtasticFirmware';

const FILES = {
  appFile: 'firmware-tbeam-2.7.9.bin',
  otaFile: 'bleota.bin',
  littleFsFile: 'littlefs-2.7.9.bin',
};

describe('compareFirmwareVersions', () => {
  it('orders by numeric segment, not lexically', () => {
    expect(compareFirmwareVersions('2.7.9', '2.7.10')).toBeLessThan(0);
    expect(compareFirmwareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareFirmwareVersions('2.7.9', '2.7.9')).toBe(0);
  });

  it('ignores a leading v and a trailing build suffix', () => {
    expect(compareFirmwareVersions('v2.7.9', '2.7.9')).toBe(0);
    expect(compareFirmwareVersions('2.7.9.abc1234', '2.7.9')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareFirmwareVersions('2.8', '2.8.0')).toBe(0);
    expect(compareFirmwareVersions('2.8', '2.8.1')).toBeLessThan(0);
  });
});

describe('supportsNew8MBPartitionTable', () => {
  it('starts at 2.7.9', () => {
    expect(supportsNew8MBPartitionTable('2.7.8')).toBe(false);
    expect(supportsNew8MBPartitionTable('2.7.9')).toBe(true);
    expect(supportsNew8MBPartitionTable('2.8.0')).toBe(true);
  });
});

describe('manifestPartitionOffset', () => {
  const manifest: FirmwareManifest = {
    version: '2.8.0',
    files: [],
    part: [
      { name: 'app0', subtype: 'ota_0', offset: '0x10000' },
      { name: 'app1', subtype: 'ota_1', offset: '0x340000' },
      { name: 'spiffs', subtype: 'spiffs', offset: '0x670000' },
    ],
  };

  it('parses hex offsets by name', () => {
    expect(manifestPartitionOffset(manifest, 'app0')).toBe(0x10000);
    expect(manifestPartitionOffset(manifest, 'spiffs')).toBe(0x670000);
  });

  it('falls back to the OTA subtype when the name differs', () => {
    const renamed: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [
        { name: 'app', subtype: 'ota_0', offset: '0x10000' },
        { name: 'flashApp', subtype: 'ota_1', offset: '0x5D0000' },
      ],
    };
    expect(manifestPartitionOffset(renamed, 'app0')).toBe(0x10000);
    expect(manifestPartitionOffset(renamed, 'app1')).toBe(0x5d0000);
  });

  it('returns undefined rather than guessing', () => {
    expect(manifestPartitionOffset(null, 'app0')).toBeUndefined();
    expect(manifestPartitionOffset(undefined, 'app0')).toBeUndefined();
    expect(manifestPartitionOffset({ version: '1', files: [] }, 'app0')).toBeUndefined();
    expect(manifestPartitionOffset(manifest, 'nope')).toBeUndefined();
  });

  it('rejects an unparseable offset instead of writing to NaN', () => {
    const bad: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [{ name: 'app0', offset: 'not-hex' }],
    };
    expect(manifestPartitionOffset(bad, 'app0')).toBeUndefined();
  });
});

describe('resolveCleanInstallOffsets', () => {
  // Values pinned against meshtastic/web-flasher stores/firmwareStore.ts.
  it('uses 4MB defaults when nothing else applies', () => {
    expect(resolveCleanInstallOffsets({ firmwareVersion: '2.8.0' })).toEqual({
      ota: 0x260000,
      spiffs: 0x300000,
      source: 'partition-scheme',
    });
  });

  it('uses the legacy 8MB table for a non-TFT device', () => {
    expect(
      resolveCleanInstallOffsets({
        partitionScheme: '8MB',
        hasMui: false,
        firmwareVersion: '2.8.0',
      }),
    ).toEqual({ ota: 0x340000, spiffs: 0x670000, source: 'partition-scheme' });
  });

  it('uses the legacy 8MB table for a TFT device below 2.7.9', () => {
    expect(
      resolveCleanInstallOffsets({
        partitionScheme: '8MB',
        hasMui: true,
        firmwareVersion: '2.7.8',
      }),
    ).toEqual({ ota: 0x340000, spiffs: 0x670000, source: 'partition-scheme' });
  });

  it('moves ota_1 for a TFT device on 2.7.9 or newer', () => {
    expect(
      resolveCleanInstallOffsets({
        partitionScheme: '8MB',
        hasMui: true,
        firmwareVersion: '2.7.9',
      }),
    ).toEqual({ ota: 0x5d0000, spiffs: 0x670000, source: 'partition-scheme' });
  });

  it('uses the 16MB table', () => {
    expect(
      resolveCleanInstallOffsets({ partitionScheme: '16MB', firmwareVersion: '2.8.0' }),
    ).toEqual({
      ota: 0x650000,
      spiffs: 0xc90000,
      source: 'partition-scheme',
    });
  });

  it('prefers the manifest over every hardcoded table', () => {
    const manifest: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [
        { name: 'app1', offset: '0x111000' },
        { name: 'spiffs', offset: '0x222000' },
      ],
    };
    expect(
      resolveCleanInstallOffsets({
        manifest,
        partitionScheme: '16MB',
        hasMui: true,
        firmwareVersion: '2.8.0',
      }),
    ).toEqual({ ota: 0x111000, spiffs: 0x222000, source: 'manifest' });
  });

  it('falls back when the manifest is only partly usable', () => {
    // A half-read manifest must not mix one real offset with one guess.
    const partial: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [{ name: 'app1', offset: '0x111000' }],
    };
    expect(resolveCleanInstallOffsets({ manifest: partial, firmwareVersion: '2.8.0' })).toEqual({
      ota: 0x260000,
      spiffs: 0x300000,
      source: 'partition-scheme',
    });
  });
});

describe('buildCleanInstallPlan', () => {
  it('writes the app at 0x00 and erases the chip', () => {
    const plan = buildCleanInstallPlan({ ...FILES, firmwareVersion: '2.8.0' });
    expect(plan.eraseAll).toBe(true);
    expect(plan.files[0]).toEqual({ name: FILES.appFile, address: 0x00 });
  });

  it('orders app, OTA, filesystem', () => {
    const plan = buildCleanInstallPlan({ ...FILES, firmwareVersion: '2.8.0' });
    expect(plan.files.map((f) => f.name)).toEqual([
      FILES.appFile,
      FILES.otaFile,
      FILES.littleFsFile,
    ]);
    expect(plan.files.map((f) => f.address)).toEqual([0x00, 0x260000, 0x300000]);
  });

  it('carries the 16MB offsets through', () => {
    const plan = buildCleanInstallPlan({
      ...FILES,
      partitionScheme: '16MB',
      firmwareVersion: '2.8.0',
    });
    expect(plan.files.map((f) => f.address)).toEqual([0x00, 0x650000, 0xc90000]);
  });

  it('never produces overlapping or out-of-order addresses', () => {
    const schemes = [
      { partitionScheme: 'default' as const, hasMui: false },
      { partitionScheme: '8MB' as const, hasMui: false },
      { partitionScheme: '8MB' as const, hasMui: true },
      { partitionScheme: '16MB' as const, hasMui: false },
    ];
    for (const scheme of schemes) {
      for (const firmwareVersion of ['2.7.8', '2.7.9', '2.8.0']) {
        const plan = buildCleanInstallPlan({ ...FILES, ...scheme, firmwareVersion });
        const addresses = plan.files.map((f) => f.address);
        expect(addresses, `${scheme.partitionScheme}/${firmwareVersion}`).toEqual(
          [...addresses].sort((a, b) => a - b),
        );
        expect(new Set(addresses).size, `${scheme.partitionScheme}/${firmwareVersion}`).toBe(
          addresses.length,
        );
      }
    }
  });
});

describe('buildUpdatePlan', () => {
  it('writes one image at the legacy app offset and does not erase', () => {
    const plan = buildUpdatePlan({ updateFile: 'firmware-tbeam-2.8.0-update.bin' });
    expect(plan.eraseAll).toBe(false);
    expect(plan.files).toEqual([
      { name: 'firmware-tbeam-2.8.0-update.bin', address: LEGACY_UPDATE_ADDRESS },
    ]);
    expect(LEGACY_UPDATE_ADDRESS).toBe(0x10000);
  });

  it('prefers the manifest app0 offset', () => {
    const manifest: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [{ name: 'app0', offset: '0x20000' }],
    };
    const plan = buildUpdatePlan({ updateFile: 'u.bin', manifest });
    expect(plan.files[0]?.address).toBe(0x20000);
    expect(plan.source).toBe('manifest');
  });

  it('keeps the device database: an update never erases', () => {
    const manifest: FirmwareManifest = {
      version: '2.8.0',
      files: [],
      part: [{ name: 'app0', offset: '0x20000' }],
    };
    expect(buildUpdatePlan({ updateFile: 'u.bin', manifest }).eraseAll).toBe(false);
  });
});
