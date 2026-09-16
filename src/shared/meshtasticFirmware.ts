/**
 * Meshtastic firmware flashing: catalog, manifest and flash-plan types.
 *
 * Offsets here decide where bytes land in a radio's flash. Getting one wrong
 * bricks the unit in the field, so every value is taken from Meshtastic's own
 * web-flasher (`stores/firmwareStore.ts`) rather than inferred, and the
 * resolver that uses them is a pure function with exhaustive tests.
 */

/** Flash layout of a target, from the device catalog. */
export type PartitionScheme = 'default' | '8MB' | '16MB';

/** ESP32 partition names as they appear in a release manifest. */
export const PARTITION_NAMES = {
  APP0: 'app0',
  APP1: 'app1',
  SPIFFS: 'spiffs',
} as const;

/** OTA subtypes, used when a manifest names partitions differently. */
export const PARTITION_SUBTYPES = {
  OTA_0: 'ota_0',
  OTA_1: 'ota_1',
} as const;

export interface FirmwareManifestFile {
  name: string;
  md5?: string;
  bytes?: number;
  part_name?: string;
}

export interface FirmwareManifestPartition {
  name: string;
  type?: string;
  subtype?: string;
  /** Hex string, e.g. "0x10000". */
  offset: string;
  size?: string;
}

export interface FirmwareManifest {
  version: string;
  mcu?: string;
  platformioTarget?: string;
  /** Absent on a malformed or truncated manifest; always guard. */
  files?: FirmwareManifestFile[];
  part?: FirmwareManifestPartition[];
  has_mui?: boolean;
  architecture?: string;
}

/** One binary and the flash address it belongs at. */
export interface FlashFile {
  /** Asset filename within the release. */
  name: string;
  address: number;
}

export interface FlashPlan {
  files: FlashFile[];
  /** Clean install erases the whole chip; an update writes one image. */
  eraseAll: boolean;
  /** Where the offsets came from, so the UI can say which path was taken. */
  source: 'manifest' | 'partition-scheme' | 'update';
}

/** A flashable target from `api.meshtastic.org/resource/deviceHardware`. */
export interface DeviceTarget {
  /** PlatformIO env, e.g. `tbeam`, `heltec-v3`. Matches the mDNS `pio_env` TXT. */
  platformioTarget: string;
  displayName: string;
  hwModel: number;
  hwModelSlug?: string;
  architecture?: string;
  partitionScheme?: PartitionScheme;
  hasMui?: boolean;
  activelySupported?: boolean;
}

/** Legacy offsets, used when a release ships no manifest. */
const LEGACY_OFFSETS: Record<PartitionScheme, { ota: number; spiffs: number }> = {
  // 4MB and anything unspecified.
  default: { ota: 0x260000, spiffs: 0x300000 },
  // Overridden below for TFT/MUI devices on 2.7.9+, which moved ota_1.
  '8MB': { ota: 0x340000, spiffs: 0x670000 },
  '16MB': { ota: 0x650000, spiffs: 0xc90000 },
};

/** 8MB TFT (MUI) devices moved to a new partition table in firmware 2.7.9. */
const NEW_8MB_PARTITION_TABLE_MIN_VERSION = '2.7.9';
const NEW_8MB_OFFSETS = { ota: 0x5d0000, spiffs: 0x670000 };

/** App image address for a legacy OTA update (not a clean install). */
export const LEGACY_UPDATE_ADDRESS = 0x10000;

/**
 * Numeric compare of dotted versions, ignoring any leading `v` and any
 * trailing build suffix (`2.7.9.abc1234` compares as 2.7.9).
 */
export function compareFirmwareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((segment) => Number.parseInt(segment, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when this firmware uses the post-2.7.9 8MB TFT partition table. */
export function supportsNew8MBPartitionTable(firmwareVersion: string): boolean {
  return compareFirmwareVersions(firmwareVersion, NEW_8MB_PARTITION_TABLE_MIN_VERSION) >= 0;
}

/** Read a partition offset out of a manifest, tolerating alternate names. */
export function manifestPartitionOffset(
  manifest: FirmwareManifest | null | undefined,
  partName: string,
): number | undefined {
  const partitions = manifest?.part;
  if (!partitions?.length) return undefined;

  let partition = partitions.find((p) => p.name === partName);
  // Some manifests name these `app`/`flashApp`; fall back to the OTA subtype.
  if (!partition && partName === PARTITION_NAMES.APP0) {
    partition = partitions.find((p) => p.subtype === PARTITION_SUBTYPES.OTA_0);
  }
  if (!partition && partName === PARTITION_NAMES.APP1) {
    partition = partitions.find((p) => p.subtype === PARTITION_SUBTYPES.OTA_1);
  }
  if (!partition) return undefined;

  const offset = Number.parseInt(partition.offset, 16);
  return Number.isFinite(offset) ? offset : undefined;
}

/**
 * Where the OTA and filesystem images go for a clean install.
 *
 * Prefers the release manifest; falls back to the target's partition scheme,
 * with the 2.7.9+ TFT table as its own case.
 */
export function resolveCleanInstallOffsets(options: {
  manifest?: FirmwareManifest | null;
  partitionScheme?: PartitionScheme;
  hasMui?: boolean;
  firmwareVersion: string;
}): { ota: number; spiffs: number; source: 'manifest' | 'partition-scheme' } {
  const fromManifest = {
    ota: manifestPartitionOffset(options.manifest, PARTITION_NAMES.APP1),
    spiffs: manifestPartitionOffset(options.manifest, PARTITION_NAMES.SPIFFS),
  };
  if (fromManifest.ota !== undefined && fromManifest.spiffs !== undefined) {
    return { ota: fromManifest.ota, spiffs: fromManifest.spiffs, source: 'manifest' };
  }

  const scheme: PartitionScheme = options.partitionScheme ?? 'default';
  if (scheme === '8MB' && options.hasMui === true) {
    if (supportsNew8MBPartitionTable(options.firmwareVersion)) {
      return { ...NEW_8MB_OFFSETS, source: 'partition-scheme' };
    }
  }
  return { ...LEGACY_OFFSETS[scheme], source: 'partition-scheme' };
}

/**
 * Full-chip install: app at 0x00, then the BLE OTA image and the filesystem.
 *
 * Erases first, because a clean install onto a differently-partitioned layout
 * leaves stale data the firmware will try to read.
 */
export function buildCleanInstallPlan(options: {
  appFile: string;
  otaFile: string;
  littleFsFile: string;
  manifest?: FirmwareManifest | null;
  partitionScheme?: PartitionScheme;
  hasMui?: boolean;
  firmwareVersion: string;
}): FlashPlan {
  const { ota, spiffs, source } = resolveCleanInstallOffsets(options);
  return {
    files: [
      { name: options.appFile, address: 0x00 },
      { name: options.otaFile, address: ota },
      { name: options.littleFsFile, address: spiffs },
    ],
    eraseAll: true,
    source,
  };
}

/**
 * In-place update: one image at the app offset, nothing erased, so the node
 * database, channels and keys on the device survive.
 */
export function buildUpdatePlan(options: {
  updateFile: string;
  manifest?: FirmwareManifest | null;
}): FlashPlan {
  const fromManifest = manifestPartitionOffset(options.manifest, PARTITION_NAMES.APP0);
  return {
    files: [{ name: options.updateFile, address: fromManifest ?? LEGACY_UPDATE_ADDRESS }],
    eraseAll: false,
    source: fromManifest !== undefined ? 'manifest' : 'update',
  };
}
