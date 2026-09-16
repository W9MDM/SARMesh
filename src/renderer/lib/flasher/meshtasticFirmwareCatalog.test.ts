import { describe, expect, it, vi } from 'vitest';

import type { DeviceTarget, FirmwareManifest } from '@/shared/meshtasticFirmware';

import type { FetchLike } from './meshtasticFirmwareCatalog';
import {
  cleanVersion,
  conventionalFileNames,
  fetchDeviceTargets,
  fetchFirmwareReleases,
  fetchTargetManifest,
  findAppFile,
  findFileSystemFile,
  findOtaFile,
  findTargetByPioEnv,
  findUpdateFile,
  firmwareAssetUrl,
  isUf2Architecture,
  targetManifestUrl,
} from './meshtasticFirmwareCatalog';

function jsonFetch(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn().mockResolvedValue({ ok, status, json: () => Promise.resolve(body) });
}

describe('URL building', () => {
  it('drops the v prefix the release directories do not use', () => {
    expect(cleanVersion('v2.8.0.abc1234')).toBe('2.8.0.abc1234');
    expect(cleanVersion('2.8.0')).toBe('2.8.0');
  });

  it('builds the per-target manifest url', () => {
    expect(targetManifestUrl('v2.8.0', 'heltec-v3')).toBe(
      'https://release.meshtastic.org/2.8.0/firmware-heltec-v3-2.8.0.mt.json',
    );
  });

  it('builds an asset url under the version directory', () => {
    expect(firmwareAssetUrl('v2.8.0', 'littlefs-2.8.0.bin')).toBe(
      'https://release.meshtastic.org/2.8.0/littlefs-2.8.0.bin',
    );
  });
});

describe('fetchFirmwareReleases', () => {
  const body = {
    releases: {
      stable: [
        { id: 'v2.8.0', title: '2.8.0' },
        { id: 'v2.7.9', title: '2.7.9' },
      ],
      alpha: [
        { id: 'v2.9.0', title: '2.9.0 alpha' },
        { id: 'v2.9.1', title: '2.9.1 Preview' },
      ],
    },
  };

  it('returns stable and alpha with the channel tagged', () => {
    return fetchFirmwareReleases(jsonFetch(body)).then((releases) => {
      expect(releases.filter((r) => r.channel === 'stable').map((r) => r.id)).toEqual([
        'v2.8.0',
        'v2.7.9',
      ]);
      expect(releases.find((r) => r.id === 'v2.9.0')?.channel).toBe('alpha');
    });
  });

  it('drops Preview builds — not something to put on a field radio', async () => {
    const releases = await fetchFirmwareReleases(jsonFetch(body));
    expect(releases.map((r) => r.id)).not.toContain('v2.9.1');
  });

  it('honours the limit', async () => {
    const releases = await fetchFirmwareReleases(jsonFetch(body), 1);
    expect(releases).toHaveLength(2); // one stable + one alpha
  });

  it('throws with the status rather than returning an empty list', async () => {
    await expect(fetchFirmwareReleases(jsonFetch({}, false, 503))).rejects.toThrow(/503/);
  });

  it('tolerates a response with no releases key', async () => {
    await expect(fetchFirmwareReleases(jsonFetch({}))).resolves.toEqual([]);
  });
});

describe('fetchDeviceTargets', () => {
  it('keeps only entries that name a PlatformIO target', async () => {
    const targets = await fetchDeviceTargets(
      jsonFetch([
        { platformioTarget: 'tbeam', displayName: 'T-Beam', hwModel: 4 },
        { displayName: 'No target', hwModel: 99 },
      ]),
    );
    expect(targets.map((t) => t.platformioTarget)).toEqual(['tbeam']);
  });

  it('throws on a failed fetch', async () => {
    await expect(fetchDeviceTargets(jsonFetch([], false, 500))).rejects.toThrow(/500/);
  });
});

describe('fetchTargetManifest', () => {
  it('returns null for a release that shipped no manifest', async () => {
    await expect(
      fetchTargetManifest(jsonFetch({}, false, 404), 'v2.5.0', 'tbeam'),
    ).resolves.toBeNull();
  });

  it('returns the manifest when present', async () => {
    const manifest: FirmwareManifest = { version: '2.8.0', files: [] };
    await expect(fetchTargetManifest(jsonFetch(manifest), 'v2.8.0', 'tbeam')).resolves.toEqual(
      manifest,
    );
  });
});

describe('findTargetByPioEnv', () => {
  const targets: DeviceTarget[] = [
    { platformioTarget: 'tbeam', displayName: 'T-Beam', hwModel: 4 },
    { platformioTarget: 'heltec-v3', displayName: 'Heltec V3', hwModel: 43 },
  ];

  it('matches the pio_env an mDNS browse reports', () => {
    expect(findTargetByPioEnv(targets, 'heltec-v3')?.displayName).toBe('Heltec V3');
  });

  it('ignores case and whitespace from the TXT record', () => {
    expect(findTargetByPioEnv(targets, '  TBEAM ')?.platformioTarget).toBe('tbeam');
  });

  it('returns undefined rather than a wrong board', () => {
    expect(findTargetByPioEnv(targets, 'unknown-board')).toBeUndefined();
    expect(findTargetByPioEnv(targets, undefined)).toBeUndefined();
    expect(findTargetByPioEnv(targets, '')).toBeUndefined();
  });
});

describe('manifest file lookup', () => {
  const manifest: FirmwareManifest = {
    version: '2.8.0',
    files: [
      { name: 'firmware-tbeam-2.8.0.bin', part_name: 'app0' },
      { name: 'firmware-tbeam-2.8.0-update.bin' },
      { name: 'littlefs-2.8.0.bin' },
      { name: 'bleota.bin' },
    ],
  };

  it('finds the app image by partition name', () => {
    expect(findAppFile(manifest, 'tbeam')).toBe('firmware-tbeam-2.8.0.bin');
  });

  it('never returns the update image as the app image', () => {
    const noPart: FirmwareManifest = {
      version: '2.8.0',
      files: [{ name: 'firmware-tbeam-2.8.0-update.bin' }, { name: 'firmware-tbeam-2.8.0.bin' }],
    };
    expect(findAppFile(noPart, 'tbeam')).toBe('firmware-tbeam-2.8.0.bin');
  });

  it('finds the update image', () => {
    expect(findUpdateFile(manifest, 'tbeam')).toBe('firmware-tbeam-2.8.0-update.bin');
  });

  it('finds the filesystem image, including the web-UI variant', () => {
    expect(findFileSystemFile(manifest)).toBe('littlefs-2.8.0.bin');
    expect(
      findFileSystemFile({ version: '2.8.0', files: [{ name: 'littlefswebui-2.8.0.bin' }] }),
    ).toBe('littlefswebui-2.8.0.bin');
  });

  it('finds the OTA image in both the legacy and 2.8+ naming', () => {
    expect(findOtaFile(manifest)).toBe('bleota.bin');
    expect(findOtaFile({ version: '2.8.0', files: [{ name: 'bleota-s3.bin' }] })).toBe(
      'bleota-s3.bin',
    );
    expect(findOtaFile({ version: '2.8.0', files: [{ name: 'mt-esp32s3-ota.bin' }] })).toBe(
      'mt-esp32s3-ota.bin',
    );
  });

  it('returns undefined when the manifest is missing or empty', () => {
    expect(findOtaFile(null)).toBeUndefined();
    expect(findAppFile(undefined, 'tbeam')).toBeUndefined();
    expect(findFileSystemFile({ version: '1', files: [] })).toBeUndefined();
  });
});

describe('conventionalFileNames', () => {
  it('matches the pre-manifest naming', () => {
    expect(conventionalFileNames('v2.7.0', 'tbeam')).toEqual({
      appFile: 'firmware-tbeam-2.7.0.bin',
      updateFile: 'firmware-tbeam-2.7.0-update.bin',
      littleFsFile: 'littlefs-2.7.0.bin',
      otaFile: 'bleota.bin',
    });
  });
});

describe('isUf2Architecture', () => {
  it('flags the boards that take a drag-and-drop instead of a serial flash', () => {
    expect(isUf2Architecture('nrf52840')).toBe(true);
    expect(isUf2Architecture('rp2040')).toBe(true);
    expect(isUf2Architecture('esp32')).toBe(false);
    expect(isUf2Architecture('esp32s3')).toBe(false);
    expect(isUf2Architecture(undefined)).toBe(false);
  });
});
