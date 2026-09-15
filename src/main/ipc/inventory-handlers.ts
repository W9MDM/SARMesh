import fs from 'node:fs/promises';
import path from 'node:path';

import { app, dialog, ipcMain } from 'electron';

import type {
  AssetStatus,
  ImportStrategy,
  InventoryConfig,
  InventoryExport,
  InventoryNode,
  InventoryProfile,
  InventorySettings,
  NodeConfigSnapshot,
  ReconcileResult,
} from '../../shared/inventory-types';
import { ASSET_STATUSES, INVENTORY_EXPORT_VERSION } from '../../shared/inventory-types';
import { computeDrift, type InventoryManager } from '../inventory-manager';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

export interface InventoryIpcDeps {
  getInventoryManager: () => InventoryManager;
}

/** Batch operations are bounded so one call cannot stall the main process. */
const MAX_BATCH = 500;
const MAX_LABEL = 120;
const MAX_TEXT = 200;
const MAX_CHANNELS = 8;

function asRecord(value: unknown, channel: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${channel}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function requireNodeId(value: unknown, channel: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${channel}: nodeId must be a positive number`);
  return n;
}

function optionalString(
  value: unknown,
  channel: string,
  field: string,
  max = MAX_TEXT,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${channel}: ${field} must be a string`);
  if (value.length > max) throw new Error(`${channel}: ${field} exceeds ${max} characters`);
  return value;
}

function optionalNumber(value: unknown, channel: string, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${channel}: ${field} must be a number`);
  return n;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Validate a config payload from the renderer. Unknown fields are dropped
 * rather than rejected, so a newer UI talking to an older main process
 * degrades to writing the fields both understand.
 */
export function sanitizeInventoryConfig(value: unknown, channel: string): InventoryConfig {
  const c = asRecord(value, channel);
  const out: InventoryConfig = {};

  if (c.owner) {
    const owner = asRecord(c.owner, channel);
    out.owner = {
      longName: optionalString(owner.longName, channel, 'owner.longName', 40),
      shortName: optionalString(owner.shortName, channel, 'owner.shortName', 8),
    };
  }
  if (c.lora) {
    const lora = asRecord(c.lora, channel);
    out.lora = {
      region: optionalString(lora.region, channel, 'lora.region', 32),
      modemPreset: optionalString(lora.modemPreset, channel, 'lora.modemPreset', 32),
      hopLimit: optionalNumber(lora.hopLimit, channel, 'lora.hopLimit'),
      txEnabled: optionalBoolean(lora.txEnabled),
    };
  }
  if (c.device) {
    const device = asRecord(c.device, channel);
    out.device = { role: optionalString(device.role, channel, 'device.role', 32) };
  }
  if (c.position) {
    const position = asRecord(c.position, channel);
    out.position = {
      positionBroadcastSecs: optionalNumber(
        position.positionBroadcastSecs,
        channel,
        'position.positionBroadcastSecs',
      ),
      smartPositionEnabled: optionalBoolean(position.smartPositionEnabled),
    };
  }
  if (Array.isArray(c.channels)) {
    if (c.channels.length > MAX_CHANNELS) {
      throw new Error(`${channel}: at most ${MAX_CHANNELS} channels`);
    }
    out.channels = c.channels.map((raw) => {
      const ch = asRecord(raw, channel);
      const role = String(ch.role);
      if (role !== 'DISABLED' && role !== 'PRIMARY' && role !== 'SECONDARY') {
        throw new Error(`${channel}: invalid channel role`);
      }
      return {
        index: optionalNumber(ch.index, channel, 'channel.index') ?? 0,
        name: optionalString(ch.name, channel, 'channel.name', 12) ?? '',
        psk: optionalString(ch.psk, channel, 'channel.psk', 64) ?? '',
        role,
        uplinkEnabled: ch.uplinkEnabled === true,
        downlinkEnabled: ch.downlinkEnabled === true,
      };
    });
  }
  return out;
}

function sanitizeNodePatch(value: unknown, channel: string): Partial<InventoryNode> {
  const p = asRecord(value, channel);
  const patch: Partial<InventoryNode> = {};

  const assetTag = optionalString(p.assetTag, channel, 'assetTag', 64);
  if (assetTag !== undefined) patch.assetTag = assetTag;
  const label = optionalString(p.label, channel, 'label', 64);
  if (label !== undefined) patch.label = label;
  const assignedTo = optionalString(p.assignedTo, channel, 'assignedTo', 64);
  if (assignedTo !== undefined) patch.assignedTo = assignedTo;
  const team = optionalString(p.team, channel, 'team', 64);
  if (team !== undefined) patch.team = team;
  const notes = optionalString(p.notes, channel, 'notes', 2000);
  if (notes !== undefined) patch.notes = notes;

  if (p.status !== undefined) {
    if (!ASSET_STATUSES.includes(p.status as AssetStatus)) {
      throw new Error(`${channel}: unknown status`);
    }
    patch.status = p.status as AssetStatus;
  }
  return patch;
}

/** Register radio inventory IPC handlers (`inventory:*`). */
export function registerInventoryIpcHandlers(deps: InventoryIpcDeps): void {
  const { getInventoryManager } = deps;

  const guard = <T>(channel: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      console.error(
        `[IPC] ${channel} failed:`,
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  };

  ipcMain.handle('inventory:list', (event) => {
    assertIpcSender(event, 'inventory:list');
    return getInventoryManager().list();
  });

  ipcMain.handle('inventory:get', (event, nodeId: unknown) => {
    assertIpcSender(event, 'inventory:get');
    return getInventoryManager().get(requireNodeId(nodeId, 'inventory:get'));
  });

  ipcMain.handle('inventory:register', (event, nodeId: unknown, seed: unknown) => {
    assertIpcSender(event, 'inventory:register');
    return guard('inventory:register', () =>
      getInventoryManager().register(
        requireNodeId(nodeId, 'inventory:register'),
        seed === undefined ? {} : sanitizeNodePatch(seed, 'inventory:register'),
      ),
    );
  });

  ipcMain.handle('inventory:update', (event, nodeId: unknown, patch: unknown) => {
    assertIpcSender(event, 'inventory:update');
    return guard('inventory:update', () =>
      getInventoryManager().update(
        requireNodeId(nodeId, 'inventory:update'),
        sanitizeNodePatch(patch, 'inventory:update'),
      ),
    );
  });

  ipcMain.handle('inventory:remove', (event, nodeId: unknown) => {
    assertIpcSender(event, 'inventory:remove');
    return getInventoryManager().remove(requireNodeId(nodeId, 'inventory:remove'));
  });

  ipcMain.handle('inventory:addNote', (event, nodeId: unknown, note: unknown) => {
    assertIpcSender(event, 'inventory:addNote');
    return guard('inventory:addNote', () =>
      getInventoryManager().addNote(
        requireNodeId(nodeId, 'inventory:addNote'),
        optionalString(note, 'inventory:addNote', 'note', 2000) ?? '',
      ),
    );
  });

  ipcMain.handle('inventory:recordSnapshot', (event, nodeId: unknown, snapshot: unknown) => {
    assertIpcSender(event, 'inventory:recordSnapshot');
    return guard('inventory:recordSnapshot', () => {
      const s = asRecord(snapshot, 'inventory:recordSnapshot');
      const captured: NodeConfigSnapshot = {
        ...sanitizeInventoryConfig(s, 'inventory:recordSnapshot'),
        capturedAt: Date.now(),
        firmwareVersion: optionalString(
          s.firmwareVersion,
          'inventory:recordSnapshot',
          'firmwareVersion',
          64,
        ),
      };
      return getInventoryManager().recordSnapshot(
        requireNodeId(nodeId, 'inventory:recordSnapshot'),
        captured,
      );
    });
  });

  // -- the queue

  ipcMain.handle(
    'inventory:queueChange',
    (event, nodeIds: unknown, label: unknown, config: unknown) => {
      assertIpcSender(event, 'inventory:queueChange');
      return guard('inventory:queueChange', () => {
        if (!Array.isArray(nodeIds))
          throw new Error('inventory:queueChange: nodeIds must be an array');
        if (nodeIds.length > MAX_BATCH) {
          throw new Error(`inventory:queueChange: at most ${MAX_BATCH} radios`);
        }
        const manager = getInventoryManager();
        const ids = nodeIds.map((id) => requireNodeId(id, 'inventory:queueChange'));
        const result = manager.queueChangeForMany(
          ids,
          optionalString(label, 'inventory:queueChange', 'label', MAX_LABEL) ?? 'Configuration',
          sanitizeInventoryConfig(config, 'inventory:queueChange'),
          manager.getSettings().operatorName,
        );
        console.debug(
          `[inventory] queued "${String(label)}" for ${ids.length} radio(s); each is ` +
            'updated the next time it connects',
        );
        return result;
      });
    },
  );

  ipcMain.handle('inventory:cancelChange', (event, nodeId: unknown, changeId: unknown) => {
    assertIpcSender(event, 'inventory:cancelChange');
    return getInventoryManager().cancelChange(
      requireNodeId(nodeId, 'inventory:cancelChange'),
      String(changeId),
    );
  });

  ipcMain.handle('inventory:pendingFor', (event, nodeId: unknown) => {
    assertIpcSender(event, 'inventory:pendingFor');
    return getInventoryManager().outstandingChanges(requireNodeId(nodeId, 'inventory:pendingFor'));
  });

  ipcMain.handle('inventory:awaitingConfig', (event) => {
    assertIpcSender(event, 'inventory:awaitingConfig');
    return getInventoryManager().nodesAwaitingConfig();
  });

  ipcMain.handle(
    'inventory:markChangeState',
    (event, nodeId: unknown, changeId: unknown, state: unknown, error: unknown) => {
      assertIpcSender(event, 'inventory:markChangeState');
      const allowed = ['queued', 'applying', 'applied', 'failed', 'cancelled'];
      const next = String(state);
      if (!allowed.includes(next)) throw new Error('inventory:markChangeState: invalid state');
      getInventoryManager().markChangeState(
        requireNodeId(nodeId, 'inventory:markChangeState'),
        String(changeId),
        next as 'queued' | 'applying' | 'applied' | 'failed' | 'cancelled',
        optionalString(error, 'inventory:markChangeState', 'error', 500),
      );
    },
  );

  ipcMain.handle('inventory:recordReconcile', (event, result: unknown) => {
    assertIpcSender(event, 'inventory:recordReconcile');
    const r = asRecord(result, 'inventory:recordReconcile');
    return getInventoryManager().recordReconcile({
      nodeId: requireNodeId(r.nodeId, 'inventory:recordReconcile'),
      applied: Array.isArray(r.applied) ? r.applied.map(String).slice(0, 50) : [],
      failed: Array.isArray(r.failed)
        ? r.failed.slice(0, 50).map((f) => {
            const entry = asRecord(f, 'inventory:recordReconcile');
            return { label: String(entry.label), error: String(entry.error) };
          })
        : [],
      rebooted: r.rebooted === true,
    } satisfies ReconcileResult);
  });

  // -- profiles

  ipcMain.handle('inventory:listProfiles', (event) => {
    assertIpcSender(event, 'inventory:listProfiles');
    return getInventoryManager().listProfiles();
  });

  ipcMain.handle('inventory:saveProfile', (event, profile: unknown) => {
    assertIpcSender(event, 'inventory:saveProfile');
    return guard('inventory:saveProfile', () => {
      const p = asRecord(profile, 'inventory:saveProfile');
      const saved: InventoryProfile = {
        id: optionalString(p.id, 'inventory:saveProfile', 'id', 64) || String(Date.now()),
        name: optionalString(p.name, 'inventory:saveProfile', 'name', 64) ?? 'Profile',
        description: optionalString(p.description, 'inventory:saveProfile', 'description', 200),
        config: sanitizeInventoryConfig(p.config, 'inventory:saveProfile'),
        updatedAt: Date.now(),
      };
      return getInventoryManager().saveProfile(saved);
    });
  });

  ipcMain.handle('inventory:deleteProfile', (event, id: unknown) => {
    assertIpcSender(event, 'inventory:deleteProfile');
    return getInventoryManager().deleteProfile(String(id));
  });

  ipcMain.handle('inventory:drift', (event, nodeId: unknown, profileId: unknown) => {
    assertIpcSender(event, 'inventory:drift');
    const manager = getInventoryManager();
    const node = manager.get(requireNodeId(nodeId, 'inventory:drift'));
    const profile = manager.listProfiles().find((p) => p.id === String(profileId));
    return computeDrift(node?.lastKnownConfig, profile);
  });

  // -- export / import

  ipcMain.handle('inventory:exportFile', async (event) => {
    assertIpcSender(event, 'inventory:exportFile');
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: 'Export radio inventory',
      defaultPath: path.join(app.getPath('documents'), `sarmesh-inventory-${stamp}.json`),
      filters: [{ name: 'SARMesh inventory', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true as const };

    const payload = getInventoryManager().buildExport();
    await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { cancelled: false as const, path: result.filePath, nodes: payload.nodes.length };
  });

  ipcMain.handle('inventory:exportCsv', async (event) => {
    assertIpcSender(event, 'inventory:exportCsv');
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog({
      title: 'Export radio inventory as CSV',
      defaultPath: path.join(app.getPath('documents'), `sarmesh-inventory-${stamp}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true as const };

    await fs.writeFile(result.filePath, buildInventoryCsv(getInventoryManager().list()), 'utf8');
    return { cancelled: false as const, path: result.filePath };
  });

  ipcMain.handle('inventory:importFile', async (event, strategy: unknown) => {
    assertIpcSender(event, 'inventory:importFile');
    const mode: ImportStrategy = strategy === 'replace' ? 'replace' : 'merge';

    const result = await dialog.showOpenDialog({
      title: 'Import radio inventory',
      properties: ['openFile'],
      filters: [{ name: 'SARMesh inventory', extensions: ['json'] }],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { cancelled: true as const };

    return guard('inventory:importFile', async () => {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<InventoryExport>;

      // Refuse a file we do not understand rather than mangling the register.
      if (parsed.format !== 'sarmesh-inventory') {
        throw new Error('That file is not a SARMesh inventory export.');
      }
      if (typeof parsed.version !== 'number' || parsed.version > INVENTORY_EXPORT_VERSION) {
        throw new Error(
          `That export was written by a newer SARMesh (format ${String(parsed.version)}). Update first.`,
        );
      }
      if (!Array.isArray(parsed.nodes)) {
        throw new Error('That export has no radio records.');
      }

      const summary = getInventoryManager().applyImport(
        {
          format: 'sarmesh-inventory',
          version: parsed.version,
          exportedAt: parsed.exportedAt ?? Date.now(),
          nodes: parsed.nodes,
          profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
        },
        mode,
      );
      return { cancelled: false as const, summary };
    });
  });

  // -- settings

  ipcMain.handle('inventory:getSettings', (event) => {
    assertIpcSender(event, 'inventory:getSettings');
    return getInventoryManager().getSettings();
  });

  ipcMain.handle('inventory:setSettings', (event, settings: unknown) => {
    assertIpcSender(event, 'inventory:setSettings');
    return guard('inventory:setSettings', () => {
      const s = asRecord(settings, 'inventory:setSettings');
      return getInventoryManager().setSettings({
        autoApplyOnConnect: s.autoApplyOnConnect !== false,
        operatorName: optionalString(s.operatorName, 'inventory:setSettings', 'operatorName', 64),
      } satisfies InventorySettings);
    });
  });
}

/** Agency-readable property list. Deliberately excludes PSKs. */
export function buildInventoryCsv(nodes: InventoryNode[]): string {
  const header = [
    'asset_tag',
    'node_id',
    'label',
    'assigned_to',
    'team',
    'status',
    'hw_model',
    'firmware',
    'region',
    'modem_preset',
    'role',
    'primary_channel',
    'queued_changes',
    'last_seen',
    'last_configured',
  ];

  // Quote any cell containing a comma, quote or newline, doubling inner quotes.
  const cell = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const rows = nodes.map((node) => {
    const config = node.lastKnownConfig;
    const primary = config?.channels?.find((channel) => channel.role === 'PRIMARY');
    return [
      node.assetTag ?? '',
      `!${(node.nodeId >>> 0).toString(16).padStart(8, '0')}`,
      node.label ?? '',
      node.assignedTo ?? '',
      node.team ?? '',
      node.status,
      node.hwModel ?? '',
      node.firmwareVersion ?? '',
      config?.lora?.region ?? '',
      config?.lora?.modemPreset ?? '',
      config?.device?.role ?? '',
      primary?.name ?? '',
      String(node.pendingChanges.filter((c) => c.state === 'queued').length),
      node.lastSeen ? new Date(node.lastSeen).toISOString() : '',
      node.lastConfiguredAt ? new Date(node.lastConfiguredAt).toISOString() : '',
    ].map(cell);
  });

  return [header.join(','), ...rows.map((row) => row.join(','))].join('\n');
}
