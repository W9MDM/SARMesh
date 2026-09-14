import type { TrackerTypeId } from './tracker-types';

/**
 * APRS bridge types.
 *
 * The bridge re-broadcasts mesh node positions as APRS so mapping tools —
 * CalTopo / SARTopo above all — can plot field teams. See docs/aprs-caltopo.md.
 */

export type AprsSinkKind = 'aprs-is-server' | 'aprs-is-upstream' | 'kiss-tcp';

export interface AprsLocalServerSettings {
  enabled: boolean;
  /** Bind address. Keep 127.0.0.1 unless another machine must reach the feed. */
  host: string;
  /** APRS-IS convention is 14580. */
  port: number;
}

export interface AprsUpstreamSettings {
  enabled: boolean;
  host: string;
  port: number;
  /** Must be a real amateur callsign; see the warning in docs/aprs-caltopo.md. */
  callsign: string;
  passcode: string;
}

export interface AprsKissSettings {
  enabled: boolean;
  host: string;
  port: number;
}

export interface AprsSettings {
  enabled: boolean;
  autoStart: boolean;
  localServer: AprsLocalServerSettings;
  upstream: AprsUpstreamSettings;
  kiss: AprsKissSettings;
  /** Minimum seconds between beacons for a single node. */
  minIntervalSeconds: number;
  /** Drop fixes older than this many seconds. 0 disables the check. */
  maxAgeSeconds: number;
  /** Appended to every generated APRS comment field. */
  commentSuffix: string;
}

/** A mesh node the operator has opted in to beaconing, with its APRS identity. */
export interface AprsTrackedClient {
  nodeId: number;
  /** APRS callsign or tactical call, e.g. `TEAM1` or `KD0ABC-9`. */
  callsign: string;
  /** Team / assignment label, shown in the UI and appended to the comment. */
  team?: string;
  /**
   * What this tracker is in the field (ground team, K9, UTV, ...). Drives both
   * the APRS symbol and the map icon. See shared/tracker-types.ts.
   */
  trackerType: TrackerTypeId;
  /** APRS symbol table override; normally derived from `trackerType`. */
  symbolTable: string;
  /** APRS symbol code override; normally derived from `trackerType`. */
  symbolCode: string;
  enabled: boolean;
  comment?: string;
}

export interface AprsSinkStatus {
  kind: AprsSinkKind;
  running: boolean;
  /** Connected downstream clients, for the server sinks. */
  clients: number;
  emitted: number;
  error?: string;
}

export interface AprsBridgeStatus {
  running: boolean;
  sinks: AprsSinkStatus[];
  /** Nodes on the roster with beaconing enabled. */
  trackedCount: number;
  error?: string;
}

export interface AprsEmitRecord {
  time: number;
  nodeId: number;
  callsign: string;
  /** The TNC2-format frame that was emitted. */
  frame: string;
  sinks: AprsSinkKind[];
}

/**
 * Why a candidate position was not beaconed. Surfaced so an operator can tell
 * "nothing is configured" from "that radio has no GPS fix".
 */
export type AprsSuppressionReason =
  'bridge-stopped' | 'not-tracked' | 'client-disabled' | 'stale' | 'rate-limited' | 'no-fix';

/** A node update offered to the bridge; mirrors the columns on the nodes table. */
export interface AprsNodeUpdate {
  node_id: number;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  /** Unix seconds, as stored on the nodes table. */
  last_heard?: number | null;
  long_name?: string | null;
  short_name?: string | null;
}

export const DEFAULT_APRS_SETTINGS: AprsSettings = {
  enabled: false,
  autoStart: false,
  localServer: { enabled: true, host: '127.0.0.1', port: 14580 },
  upstream: {
    enabled: false,
    host: 'rotate.aprs2.net',
    port: 14580,
    callsign: '',
    passcode: '',
  },
  kiss: { enabled: false, host: '127.0.0.1', port: 8001 },
  minIntervalSeconds: 30,
  maxAgeSeconds: 900,
  commentSuffix: 'via SARMesh',
};

export const IDLE_APRS_STATUS: AprsBridgeStatus = {
  running: false,
  sinks: [
    { kind: 'aprs-is-server', running: false, clients: 0, emitted: 0 },
    { kind: 'aprs-is-upstream', running: false, clients: 0, emitted: 0 },
    { kind: 'kiss-tcp', running: false, clients: 0, emitted: 0 },
  ],
  trackedCount: 0,
};
