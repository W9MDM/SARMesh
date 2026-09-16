/**
 * Meshtastic firmware catalog: which releases exist, which targets they build
 * for, and which files a given target needs.
 *
 * URL shapes and file-name conventions follow meshtastic/web-flasher
 * (`utils/firmwareUrl.ts`, `stores/firmwareStore.ts`). Everything here is pure
 * apart from the injected `fetch`, so the naming rules are testable offline.
 */
import type { DeviceTarget, FirmwareManifest } from '@/shared/meshtasticFirmware';

/** Cloudflare Worker in front of the Meshtastic API. */
export const MESHTASTIC_API_ORIGIN = 'https://api.meshtastic.org';
/** R2 bucket holding one directory per released version. */
export const MESHTASTIC_RELEASE_BASE = 'https://release.meshtastic.org';

export interface FirmwareRelease {
  /** Version id as published, e.g. `v2.8.0.abc1234`. */
  id: string;
  title: string;
  /** Stable releases are the default for field radios. */
  channel: 'stable' | 'alpha';
  zipUrl?: string;
}

/** Strip the `v` prefix the release directories do not use. */
export function cleanVersion(version: string): string {
  return version.replace(/^v/i, '');
}

export function firmwareListUrl(): string {
  return `${MESHTASTIC_API_ORIGIN}/github/firmware/list`;
}

export function deviceHardwareUrl(): string {
  return `${MESHTASTIC_API_ORIGIN}/resource/deviceHardware`;
}

export function firmwareBaseUrl(version: string): string {
  return `${MESHTASTIC_RELEASE_BASE}/${cleanVersion(version)}`;
}

/** Per-target manifest: authoritative file names and partition offsets. */
export function targetManifestUrl(version: string, target: string): string {
  return `${firmwareBaseUrl(version)}/firmware-${target}-${cleanVersion(version)}.mt.json`;
}

export function firmwareAssetUrl(version: string, fileName: string): string {
  return `${firmwareBaseUrl(version)}/${fileName}`;
}

/** Minimal shape of the fetch we need, so tests need no network. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface FirmwareListResponse {
  releases?: {
    stable?: { id: string; title: string; zip_url?: string }[];
    alpha?: { id: string; title: string; zip_url?: string }[];
  };
}

/**
 * Recent stable and alpha releases, newest first.
 *
 * Preview builds are dropped: a search-and-rescue team should not be offered a
 * build the upstream project itself flags as not for general use.
 */
export async function fetchFirmwareReleases(
  fetchFn: FetchLike,
  limit = 4,
): Promise<FirmwareRelease[]> {
  const response = await fetchFn(firmwareListUrl());
  if (!response.ok) {
    throw new Error(`Firmware list unavailable (HTTP ${response.status})`);
  }
  const body = (await response.json()) as FirmwareListResponse;
  const stable = (body.releases?.stable ?? []).slice(0, limit).map((r): FirmwareRelease => ({
    id: r.id,
    title: r.title,
    channel: 'stable',
    zipUrl: r.zip_url,
  }));
  const alpha = (body.releases?.alpha ?? [])
    .filter((r) => !r.title.includes('Preview'))
    .slice(0, limit)
    .map((r): FirmwareRelease => ({
      id: r.id,
      title: r.title,
      channel: 'alpha',
      zipUrl: r.zip_url,
    }));
  return [...stable, ...alpha];
}

/** Flashable hardware targets, keyed by PlatformIO env. */
export async function fetchDeviceTargets(fetchFn: FetchLike): Promise<DeviceTarget[]> {
  const response = await fetchFn(deviceHardwareUrl());
  if (!response.ok) {
    throw new Error(`Device catalog unavailable (HTTP ${response.status})`);
  }
  const body = (await response.json()) as DeviceTarget[];
  return Array.isArray(body) ? body.filter((t) => Boolean(t.platformioTarget)) : [];
}

/** The manifest is optional: releases before 2.8 shipped none. */
export async function fetchTargetManifest(
  fetchFn: FetchLike,
  version: string,
  target: string,
): Promise<FirmwareManifest | null> {
  const response = await fetchFn(targetManifestUrl(version, target));
  if (!response.ok) return null;
  return (await response.json()) as FirmwareManifest;
}

/**
 * Match a radio's reported PlatformIO env to a catalog target.
 *
 * The mDNS browse already hands us `pio_env`, so a node found on the network
 * pre-selects its own firmware variant instead of making an operator identify
 * the board by sight.
 */
export function findTargetByPioEnv(
  targets: readonly DeviceTarget[],
  pioEnv: string | undefined,
): DeviceTarget | undefined {
  if (!pioEnv) return undefined;
  const needle = pioEnv.trim().toLowerCase();
  if (!needle) return undefined;
  return targets.find((t) => t.platformioTarget.toLowerCase() === needle);
}

/** Legacy `bleota.bin` / `bleota-s3.bin`, or the 2.8+ `mt-*-ota.bin`. */
export function findOtaFile(manifest: FirmwareManifest | null | undefined): string | undefined {
  return manifest?.files?.find(
    (f) => /^bleota(-s3)?\.bin$/.test(f.name) || /^mt-.*-ota\.bin$/.test(f.name),
  )?.name;
}

/**
 * `littlefs-*.bin` or the web-UI variant `littlefswebui-*.bin`.
 *
 * Upstream writes this as /^littlefswebui?-/, which parses as "littlefswebu"
 * plus an optional "i" and so never matches the plain `littlefs-` name its own
 * comment claims. Grouped here so both real names match.
 */
export function findFileSystemFile(
  manifest: FirmwareManifest | null | undefined,
): string | undefined {
  return manifest?.files?.find((f) => /^littlefs(webui)?-.*\.bin$/.test(f.name))?.name;
}

/** The application image for a clean install (never the `-update` one). */
export function findAppFile(
  manifest: FirmwareManifest | null | undefined,
  target: string,
): string | undefined {
  const byPart = manifest?.files?.find((f) => f.part_name === 'app0')?.name;
  if (byPart) return byPart;
  return manifest?.files?.find(
    (f) => f.name.startsWith(`firmware-${target}-`) && !f.name.includes('-update.'),
  )?.name;
}

/** The OTA image applied in place, keeping the node database. */
export function findUpdateFile(
  manifest: FirmwareManifest | null | undefined,
  target: string,
): string | undefined {
  return manifest?.files?.find(
    (f) => f.name.startsWith(`firmware-${target}-`) && f.name.includes('-update.'),
  )?.name;
}

/** Conventional names for a release that shipped no manifest. */
export function conventionalFileNames(
  version: string,
  target: string,
): { appFile: string; updateFile: string; littleFsFile: string; otaFile: string } {
  const v = cleanVersion(version);
  return {
    appFile: `firmware-${target}-${v}.bin`,
    updateFile: `firmware-${target}-${v}-update.bin`,
    littleFsFile: `littlefs-${v}.bin`,
    otaFile: 'bleota.bin',
  };
}

/** nRF52 and RP2040 boards take a UF2 drag-and-drop, not a serial flash. */
export function isUf2Architecture(architecture: string | undefined): boolean {
  if (!architecture) return false;
  const arch = architecture.toLowerCase();
  return arch.startsWith('nrf52') || arch.startsWith('rp2') || arch.includes('uf2');
}
