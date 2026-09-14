/**
 * Durable storage for the radio asset register.
 *
 * Shaped like AprsBridgeManager: constructed once in main, loaded from disk,
 * and driven over IPC. It holds no device handles — applying configuration is
 * the renderer's job, because that is where the MeshDevice lives. This class
 * owns what must survive a restart: the register, the queue, and the trail.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type {
  AssetStatus,
  ConfigDrift,
  InventoryConfig,
  InventoryEvent,
  InventoryNode,
  InventoryProfile,
  InventorySettings,
  NodeConfigSnapshot,
  PendingChangeState,
  PendingConfigChange,
  ReconcileResult,
} from '../shared/inventory-types';
import {
  DEFAULT_INVENTORY_SETTINGS,
  MAX_HISTORY_PER_NODE,
  MAX_INVENTORY_NODES,
} from '../shared/inventory-types';
import { sanitizeLogMessage } from './log-service';

interface InventoryFile {
  nodes: InventoryNode[];
  profiles: InventoryProfile[];
  settings: InventorySettings;
}

export class InventoryManager extends EventEmitter {
  private nodes = new Map<number, InventoryNode>();
  private profiles = new Map<string, InventoryProfile>();
  private settings: InventorySettings = { ...DEFAULT_INVENTORY_SETTINGS };
  private loaded = false;

  private get filePath(): string {
    return path.join(app.getPath('userData'), 'inventory.json');
  }

  // ------------------------------------------------------------ persistence

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<InventoryFile>;
      if (Array.isArray(parsed.nodes)) {
        this.nodes = new Map(
          parsed.nodes
            .filter((node) => Number.isFinite(node?.nodeId))
            .slice(0, MAX_INVENTORY_NODES)
            .map((node) => [node.nodeId, this.normalize(node)]),
        );
      }
      if (Array.isArray(parsed.profiles)) {
        this.profiles = new Map(parsed.profiles.map((p) => [p.id, p]));
      }
      this.settings = { ...DEFAULT_INVENTORY_SETTINGS, ...parsed.settings };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // A corrupt register must not stop the app from starting, but it is
        // also not something to lose silently: keep it for recovery.
        console.error('[inventory] could not read register:', sanitizeLogMessage(String(err)));
        this.quarantine();
      }
    }
  }

  private quarantine(): void {
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      // catch-no-log-ok: nothing recoverable to preserve; the error above stands
    }
  }

  /** Fill in anything an older file predates, so callers see a complete record. */
  private normalize(node: InventoryNode): InventoryNode {
    return {
      ...node,
      status: node.status ?? 'needs-config',
      pendingChanges: Array.isArray(node.pendingChanges) ? node.pendingChanges : [],
      history: Array.isArray(node.history) ? node.history : [],
    };
  }

  private persist(): void {
    const payload: InventoryFile = {
      nodes: this.list(),
      profiles: [...this.profiles.values()],
      settings: this.settings,
    };
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      // Atomic replace, so a crash mid-write cannot truncate the register.
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error('[inventory] could not write register:', sanitizeLogMessage(String(err)));
    }
    this.emit('changed', payload.nodes);
  }

  // ------------------------------------------------------------------ reads

  list(): InventoryNode[] {
    return [...this.nodes.values()].sort((a, b) => {
      const left = a.assetTag ?? a.label ?? String(a.nodeId);
      const right = b.assetTag ?? b.label ?? String(b.nodeId);
      return left.localeCompare(right);
    });
  }

  get(nodeId: number): InventoryNode | undefined {
    return this.nodes.get(nodeId);
  }

  getSettings(): InventorySettings {
    return this.settings;
  }

  setSettings(settings: InventorySettings): InventorySettings {
    this.settings = settings;
    this.persist();
    return this.settings;
  }

  listProfiles(): InventoryProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  saveProfile(profile: InventoryProfile): InventoryProfile[] {
    this.profiles.set(profile.id, { ...profile, updatedAt: Date.now() });
    this.persist();
    return this.listProfiles();
  }

  deleteProfile(id: string): InventoryProfile[] {
    this.profiles.delete(id);
    this.persist();
    return this.listProfiles();
  }

  /** Changes still waiting to be pushed to a radio. */
  outstandingChanges(nodeId: number): PendingConfigChange[] {
    return this.nodes.get(nodeId)?.pendingChanges.filter((c) => c.state === 'queued') ?? [];
  }

  nodesAwaitingConfig(): InventoryNode[] {
    return this.list().filter((node) => node.pendingChanges.some((c) => c.state === 'queued'));
  }

  // ----------------------------------------------------------------- writes

  /**
   * Register a radio, or return the existing record. Called from the UI and
   * automatically when an unknown radio connects, so nothing a leader touches
   * goes unrecorded.
   */
  register(nodeId: number, seed: Partial<InventoryNode> = {}): InventoryNode {
    const existing = this.nodes.get(nodeId);
    if (existing) return existing;
    if (this.nodes.size >= MAX_INVENTORY_NODES) {
      throw new Error(`Inventory is full (${MAX_INVENTORY_NODES} radios)`);
    }

    const node: InventoryNode = {
      nodeId,
      status: 'needs-config',
      pendingChanges: [],
      history: [],
      ...seed,
    };
    this.appendHistory(
      node,
      'registered',
      seed.assetTag ? `Registered as ${seed.assetTag}` : 'Registered from a live connection',
    );
    this.nodes.set(nodeId, node);
    this.persist();
    return node;
  }

  update(nodeId: number, patch: Partial<InventoryNode>): InventoryNode {
    const node = this.nodes.get(nodeId) ?? this.register(nodeId);
    const previousStatus = node.status;

    Object.assign(node, patch, { nodeId });

    if (patch.status && patch.status !== previousStatus) {
      this.appendHistory(node, 'status-changed', `${previousStatus} -> ${patch.status}`);
    }
    if (patch.assignedTo !== undefined) {
      this.appendHistory(node, 'assigned', `Assigned to ${patch.assignedTo || '(unassigned)'}`);
    }
    this.persist();
    return node;
  }

  remove(nodeId: number): InventoryNode[] {
    this.nodes.delete(nodeId);
    this.persist();
    return this.list();
  }

  setStatus(nodeId: number, status: AssetStatus): InventoryNode {
    return this.update(nodeId, { status });
  }

  addNote(nodeId: number, note: string): InventoryNode {
    const node = this.nodes.get(nodeId) ?? this.register(nodeId);
    this.appendHistory(node, 'note', note);
    this.persist();
    return node;
  }

  /**
   * Record what was just read off a radio. This is the "settings are retained"
   * half: the snapshot outlives the connection so it can be reviewed later.
   */
  recordSnapshot(nodeId: number, snapshot: NodeConfigSnapshot): InventoryNode {
    const node = this.nodes.get(nodeId) ?? this.register(nodeId);
    node.lastKnownConfig = snapshot;
    node.firmwareVersion = snapshot.firmwareVersion ?? node.firmwareVersion;
    node.lastSeen = Date.now();
    this.appendHistory(node, 'config-read', describeSnapshot(snapshot));
    this.persist();
    return node;
  }

  /** Note that a radio was heard from, without a full config read. */
  markSeen(nodeId: number, hwModel?: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.lastSeen = Date.now();
    if (hwModel && !node.hwModel) node.hwModel = hwModel;
    // Deliberately no persist(): this fires on every packet, and lastSeen is
    // not worth a disk write. It is flushed by the next real change.
  }

  // ------------------------------------------------------------ the queue

  /** Queue a change for a radio that may not be connected. */
  queueChange(
    nodeId: number,
    label: string,
    config: InventoryConfig,
    queuedBy?: string,
  ): PendingConfigChange {
    const node = this.nodes.get(nodeId) ?? this.register(nodeId);
    const pending: PendingConfigChange = {
      id: randomUUID(),
      label,
      config,
      queuedBy,
      queuedAt: Date.now(),
      state: 'queued',
    };
    node.pendingChanges.push(pending);
    if (node.status === 'in-service') node.status = 'needs-config';
    this.persist();
    return pending;
  }

  /** Queue the same change across many radios — the batch-apply entry point. */
  queueChangeForMany(
    nodeIds: number[],
    label: string,
    config: InventoryConfig,
    queuedBy?: string,
  ): InventoryNode[] {
    for (const nodeId of nodeIds) this.queueChange(nodeId, label, config, queuedBy);
    return this.list();
  }

  cancelChange(nodeId: number, changeId: string): InventoryNode[] {
    const pending = this.nodes.get(nodeId)?.pendingChanges.find((c) => c.id === changeId);
    if (pending?.state === 'queued') {
      pending.state = 'cancelled';
      this.persist();
    }
    return this.list();
  }

  markChangeState(
    nodeId: number,
    changeId: string,
    state: PendingChangeState,
    error?: string,
  ): void {
    const node = this.nodes.get(nodeId);
    const pending = node?.pendingChanges.find((c) => c.id === changeId);
    if (!node || !pending) return;

    pending.state = state;
    if (state === 'applied') {
      pending.appliedAt = Date.now();
      node.lastConfiguredAt = pending.appliedAt;
      this.appendHistory(node, 'config-applied', pending.label);
    } else if (state === 'failed') {
      pending.error = error;
      this.appendHistory(node, 'config-failed', `${pending.label}: ${error ?? 'unknown error'}`);
    }

    // A radio returns to service only once its queue drained *successfully*. A
    // failed change leaves it needing attention, otherwise a radio that refused
    // its config would silently look ready to hand out.
    const unresolved = node.pendingChanges.some(
      (c) => c.state === 'queued' || c.state === 'applying' || c.state === 'failed',
    );
    if (!unresolved && node.status === 'needs-config') {
      node.status = 'in-service';
    }
    this.persist();
  }

  /** Record the outcome of a whole reconcile pass, for the UI and the trail. */
  recordReconcile(result: ReconcileResult): InventoryNode | undefined {
    const node = this.nodes.get(result.nodeId);
    if (!node) return undefined;
    this.emit('reconciled', result);
    return node;
  }

  /** Drop resolved entries so the queue view stays readable. */
  pruneResolvedChanges(nodeId: number): InventoryNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return this.list();
    node.pendingChanges = node.pendingChanges.filter(
      (c) => c.state === 'queued' || c.state === 'applying',
    );
    this.persist();
    return this.list();
  }

  private appendHistory(node: InventoryNode, kind: InventoryEvent['kind'], detail: string): void {
    node.history.push({ time: Date.now(), kind, detail });
    if (node.history.length > MAX_HISTORY_PER_NODE) node.history.shift();
  }
}

/** One-line summary of a snapshot, for the audit trail. */
function describeSnapshot(snapshot: NodeConfigSnapshot): string {
  const parts = [
    snapshot.owner?.longName && `name=${snapshot.owner.longName}`,
    snapshot.lora?.region && `region=${snapshot.lora.region}`,
    snapshot.lora?.modemPreset && `preset=${snapshot.lora.modemPreset}`,
    snapshot.device?.role && `role=${snapshot.device.role}`,
    snapshot.channels && `channels=${snapshot.channels.length}`,
  ].filter(Boolean);
  return parts.length > 0 ? `Read config (${parts.join(', ')})` : 'Read config';
}

/**
 * Compare a radio's retained snapshot against a profile it should match.
 *
 * This is what answers "which radios are still on last season's channel?"
 * without any of them being present.
 */
export function computeDrift(
  snapshot: NodeConfigSnapshot | undefined,
  profile: InventoryProfile | undefined,
): ConfigDrift[] {
  if (!snapshot || !profile) return [];
  const drift: ConfigDrift[] = [];
  const want = profile.config;

  type Primitive = string | number | boolean | undefined;
  const compare = (field: string, desired: Primitive, actual: Primitive): void => {
    if (desired === undefined) return;
    if (desired !== actual) {
      drift.push({
        field,
        desired: String(desired),
        actual: actual === undefined ? '(unset)' : String(actual),
      });
    }
  };

  compare('owner.longName', want.owner?.longName, snapshot.owner?.longName);
  compare('owner.shortName', want.owner?.shortName, snapshot.owner?.shortName);
  compare('lora.region', want.lora?.region, snapshot.lora?.region);
  compare('lora.modemPreset', want.lora?.modemPreset, snapshot.lora?.modemPreset);
  compare('lora.hopLimit', want.lora?.hopLimit, snapshot.lora?.hopLimit);
  compare('lora.txEnabled', want.lora?.txEnabled, snapshot.lora?.txEnabled);
  compare('device.role', want.device?.role, snapshot.device?.role);
  compare(
    'position.positionBroadcastSecs',
    want.position?.positionBroadcastSecs,
    snapshot.position?.positionBroadcastSecs,
  );

  for (const desired of want.channels ?? []) {
    const actual = snapshot.channels?.find((c) => c.index === desired.index);
    compare(`channel[${desired.index}].name`, desired.name, actual?.name);
    compare(`channel[${desired.index}].role`, desired.role, actual?.role);
    // PSKs are compared but never surfaced verbatim.
    if (desired.psk !== actual?.psk) {
      drift.push({
        field: `channel[${desired.index}].psk`,
        desired: '(set)',
        actual: actual?.psk ? '(different)' : '(unset)',
      });
    }
  }

  return drift;
}
