/**
 * Packet monitor: a durable, time-windowed record of traffic.
 *
 * Distinct from the Sniffer, which is a live tail — an in-memory ring of the
 * last {@link MAX_RAW_PACKET_LOG_ENTRIES} packets that is gone on restart. On a
 * saturated channel that ring can be minutes. After a callout a team needs to
 * ask "what did we hear between 14:00 and 18:00", which needs packets that
 * survive a restart and are pruned by age rather than by count.
 *
 * It lives in its own SQLite file (see main/packet-monitor-db.ts) so a
 * high-volume disposable log never touches the main database: no schema
 * migration, no growth in support bundles, and deleting it cannot risk chat,
 * nodes or the radio inventory.
 */
import type { MeshProtocol } from './meshProtocol';

/** How long captured packets are kept. */
export const PACKET_MONITOR_MIN_HOURS = 1;
export const PACKET_MONITOR_MAX_HOURS = 168; // one week
export const PACKET_MONITOR_DEFAULT_HOURS = 12;

/**
 * Hard ceiling regardless of the retention window.
 *
 * A busy LongFast channel can carry thousands of packets an hour, and an
 * operator who sets a week of retention should not silently fill the disk. The
 * age window prunes first; this is the backstop.
 */
export const PACKET_MONITOR_MAX_ROWS = 500_000;

/** Direction relative to this station. */
export type PacketDirection = 'rx' | 'tx';

export interface PacketMonitorRecord {
  /** Row id, assigned on insert. */
  id?: number;
  /** Capture time, epoch ms. */
  ts: number;
  protocol: MeshProtocol;
  direction: PacketDirection;
  /** Source node number, when the frame carries one. */
  fromNode?: number;
  /** Destination node number; broadcast is 0xFFFFFFFF on Meshtastic. */
  toNode?: number;
  /** Meshtastic portnum / MeshCore payload type, when decoded. */
  portnum?: number;
  /** Channel index the packet arrived on. */
  channel?: number;
  /** Signal quality as reported by the radio. */
  rssi?: number;
  snr?: number;
  hopLimit?: number;
  hopStart?: number;
  /** True when the packet reached us via MQTT rather than RF. */
  viaMqtt?: boolean;
  /** Raw frame length in bytes. */
  size: number;
  /** Hex of the raw frame. Capped — see PACKET_MONITOR_MAX_HEX_BYTES. */
  rawHex?: string;
}

/**
 * Bytes of each frame retained as hex.
 *
 * Enough to identify and decode a header without storing full message bodies
 * for every packet indefinitely: this log is for traffic analysis, not an
 * archive of everyone's chat.
 */
export const PACKET_MONITOR_MAX_HEX_BYTES = 64;

export interface PacketMonitorSettings {
  /** Capture is off by default: it writes to disk continuously. */
  enabled: boolean;
  retentionHours: number;
}

export const DEFAULT_PACKET_MONITOR_SETTINGS: PacketMonitorSettings = {
  enabled: false,
  retentionHours: PACKET_MONITOR_DEFAULT_HOURS,
};

export interface PacketMonitorQuery {
  /** Only packets at or after this time, epoch ms. */
  sinceMs?: number;
  untilMs?: number;
  protocol?: MeshProtocol;
  direction?: PacketDirection;
  fromNode?: number;
  portnum?: number;
  /** Max rows returned, newest first. */
  limit?: number;
}

export interface PacketMonitorStats {
  rowCount: number;
  /** Oldest and newest capture times held, epoch ms; null when empty. */
  oldestMs: number | null;
  newestMs: number | null;
  /** On-disk size of the packet database in bytes. */
  fileBytes: number;
}

/** Clamp a retention window to the supported range. */
export function clampRetentionHours(hours: number): number {
  if (!Number.isFinite(hours)) return PACKET_MONITOR_DEFAULT_HOURS;
  const rounded = Math.round(hours);
  if (rounded < PACKET_MONITOR_MIN_HOURS) return PACKET_MONITOR_MIN_HOURS;
  if (rounded > PACKET_MONITOR_MAX_HOURS) return PACKET_MONITOR_MAX_HOURS;
  return rounded;
}

/** Cutoff timestamp for a retention window. */
export function retentionCutoffMs(retentionHours: number, nowMs: number): number {
  return nowMs - clampRetentionHours(retentionHours) * 60 * 60 * 1000;
}

/** Truncate a frame to the stored hex prefix. */
export function rawFrameToStoredHex(
  raw: Uint8Array | undefined,
  maxBytes = PACKET_MONITOR_MAX_HEX_BYTES,
): string | undefined {
  if (!raw?.length) return undefined;
  const slice = raw.subarray(0, Math.max(0, maxBytes));
  let hex = '';
  for (const byte of slice) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
