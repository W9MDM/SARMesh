/**
 * The radio asset register.
 *
 * A SAR team leader configures a pile of radios over weeks, hands them out on a
 * callout, and afterwards has to answer questions like "how is SAR-014
 * programmed?" and "who had it?" — without plugging each one in.
 *
 * Two halves:
 *
 *  - a durable record per radio: identity, holder, status, the configuration we
 *    last read off it, and an append-only audit trail
 *  - a queue of configuration changes that are applied the next time that radio
 *    connects, so preparing thirty radios is "queue once, then plug each one in
 *    briefly" rather than thirty manual sessions
 *
 * The register lives in the main process because it must survive restarts; the
 * renderer applies the queued changes, because that is where the device handle
 * is (see useMeshtasticRuntime).
 */

/** Operational state of a radio as accountable team equipment. */
export type AssetStatus =
  'in-service' | 'deployed' | 'maintenance' | 'needs-config' | 'lost' | 'retired';

export const ASSET_STATUSES: readonly AssetStatus[] = [
  'in-service',
  'deployed',
  'maintenance',
  'needs-config',
  'lost',
  'retired',
];

/** One channel slot, as stored in a snapshot or a queued change. */
export interface InventoryChannel {
  index: number;
  name: string;
  /** Base64 PSK. Never rendered verbatim in the UI. */
  psk: string;
  role: 'DISABLED' | 'PRIMARY' | 'SECONDARY';
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
}

/**
 * The settings SARMesh can read back and re-apply. Deliberately a subset of
 * everything a radio exposes: these are the fields a team actually standardises
 * across a fleet, and every one of them can be written back.
 */
export interface InventoryConfig {
  owner?: {
    longName?: string;
    shortName?: string;
  };
  lora?: {
    region?: string;
    modemPreset?: string;
    hopLimit?: number;
    txEnabled?: boolean;
  };
  device?: {
    role?: string;
  };
  position?: {
    positionBroadcastSecs?: number;
    smartPositionEnabled?: boolean;
  };
  channels?: InventoryChannel[];
}

/**
 * A point-in-time capture of what we read off a radio, retained so it can be
 * reviewed and diffed without the radio present.
 */
export interface NodeConfigSnapshot extends InventoryConfig {
  capturedAt: number;
  firmwareVersion?: string;
}

export type PendingChangeState = 'queued' | 'applying' | 'applied' | 'failed' | 'cancelled';

/** A configuration change waiting for its radio to appear. */
export interface PendingConfigChange {
  id: string;
  /** Human label shown in the queue, e.g. "Apply profile: County SAR 2026". */
  label: string;
  /** The settings to write. Absent fields are left alone on the radio. */
  config: InventoryConfig;
  queuedAt: number;
  queuedBy?: string;
  state: PendingChangeState;
  appliedAt?: number;
  error?: string;
}

/** Append-only audit trail; SAR equipment needs a defensible record. */
export interface InventoryEvent {
  time: number;
  kind:
    | 'registered'
    | 'config-read'
    | 'config-applied'
    | 'config-failed'
    | 'status-changed'
    | 'assigned'
    | 'note';
  detail: string;
}

export interface InventoryNode {
  /** Node number — the stable identity of the radio. */
  nodeId: number;
  /** Agency property tag, e.g. `SAR-014`. */
  assetTag?: string;
  /** Label the team uses on the radio itself. */
  label?: string;
  hwModel?: string;
  status: AssetStatus;
  /** Person or team currently holding it. */
  assignedTo?: string;
  team?: string;
  firmwareVersion?: string;
  /** Last configuration actually read off the unit. */
  lastKnownConfig?: NodeConfigSnapshot;
  pendingChanges: PendingConfigChange[];
  lastSeen?: number;
  lastConfiguredAt?: number;
  notes?: string;
  history: InventoryEvent[];
}

/** A saved configuration a leader applies across the fleet. */
export interface InventoryProfile {
  id: string;
  name: string;
  description?: string;
  config: InventoryConfig;
  updatedAt: number;
}

/** One field differing between a radio's retained config and a profile. */
export interface ConfigDrift {
  field: string;
  desired: string;
  actual: string;
}

/** Outcome of draining a radio's queue. */
export interface ReconcileResult {
  nodeId: number;
  applied: string[];
  failed: { label: string; error: string }[];
  /** True when settings were committed, which reboots the radio. */
  rebooted: boolean;
}

export interface InventorySettings {
  /** Apply queued config automatically when a known radio connects. */
  autoApplyOnConnect: boolean;
  /** Recorded in the audit trail as who queued a change. */
  operatorName?: string;
}

export const DEFAULT_INVENTORY_SETTINGS: InventorySettings = {
  autoApplyOnConnect: true,
};

/** Bound the register so a corrupt file cannot exhaust memory. */
export const MAX_INVENTORY_NODES = 2000;
export const MAX_HISTORY_PER_NODE = 200;
