import { ipcMain } from 'electron';

import type {
  PacketMonitorQuery,
  PacketMonitorRecord,
  PacketMonitorSettings,
} from '@/shared/packet-monitor-types';
import {
  clampRetentionHours,
  DEFAULT_PACKET_MONITOR_SETTINGS,
} from '@/shared/packet-monitor-types';

import { getDatabase } from '../database';
import { sanitizeLogMessage } from '../log-service';
import {
  clearPackets,
  getPacketMonitorStats,
  prunePackets,
  queryPackets,
  recordPacket,
  setPacketMonitorRetentionHours,
} from '../packet-monitor-db';
import { assertIpcSender } from '../validate-ipc-sender';

/**
 * Settings live in the main database's `app_settings` key/value table, which
 * needs no migration — only the packet rows themselves are in a side file.
 */
const SETTINGS_KEY = 'packetMonitor.settings';

export function readPacketMonitorSettings(): PacketMonitorSettings {
  try {
    const row = getDatabase()
      .prepareOnce('SELECT value FROM app_settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value?: string } | undefined;
    if (!row?.value) return { ...DEFAULT_PACKET_MONITOR_SETTINGS };
    const parsed = JSON.parse(row.value) as Partial<PacketMonitorSettings>;
    return {
      enabled: parsed.enabled === true,
      retentionHours: clampRetentionHours(
        parsed.retentionHours ?? DEFAULT_PACKET_MONITOR_SETTINGS.retentionHours,
      ),
    };
  } catch (err) {
    console.warn('[packet-monitor] settings read failed:', sanitizeLogMessage(String(err)));
    return { ...DEFAULT_PACKET_MONITOR_SETTINGS };
  }
}

function writePacketMonitorSettings(next: PacketMonitorSettings): PacketMonitorSettings {
  const clean: PacketMonitorSettings = {
    enabled: next.enabled,
    retentionHours: clampRetentionHours(next.retentionHours),
  };
  getDatabase()
    .prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)')
    .run(SETTINGS_KEY, JSON.stringify(clean));
  setPacketMonitorRetentionHours(clean.retentionHours);
  return clean;
}

/** Whether capture is currently on — read by the packet tap on the hot path. */
let captureEnabled = false;
export function isPacketCaptureEnabled(): boolean {
  return captureEnabled;
}

/** Apply persisted settings at startup so capture survives a restart. */
export function applyStoredPacketMonitorSettings(): PacketMonitorSettings {
  const settings = readPacketMonitorSettings();
  captureEnabled = settings.enabled;
  setPacketMonitorRetentionHours(settings.retentionHours);
  return settings;
}

export function registerPacketMonitorIpcHandlers(): void {
  ipcMain.handle('packetMonitor:getSettings', (event) => {
    assertIpcSender(event, 'packetMonitor:getSettings');
    return readPacketMonitorSettings();
  });

  ipcMain.handle('packetMonitor:setSettings', (event, next: PacketMonitorSettings) => {
    assertIpcSender(event, 'packetMonitor:setSettings');
    const saved = writePacketMonitorSettings(next);
    captureEnabled = saved.enabled;
    // A shortened window should take effect now, not at the next prune tick.
    prunePackets();
    return saved;
  });

  ipcMain.handle('packetMonitor:query', (event, query: PacketMonitorQuery) => {
    assertIpcSender(event, 'packetMonitor:query');
    return queryPackets(query ?? {});
  });

  ipcMain.handle('packetMonitor:stats', (event) => {
    assertIpcSender(event, 'packetMonitor:stats');
    return getPacketMonitorStats();
  });

  ipcMain.handle('packetMonitor:clear', (event) => {
    assertIpcSender(event, 'packetMonitor:clear');
    const removed = clearPackets();
    console.debug(`[packet-monitor] cleared ${removed} packet(s) on request`);
    return removed;
  });

  /**
   * Packets are decoded in the renderer (that is where the Meshtastic and
   * MeshCore sessions live), so capture is pushed in rather than tapped here.
   * Dropped silently when capture is off: the renderer may still be sending a
   * few frames queued before it observed the setting change.
   */
  ipcMain.on('packetMonitor:record', (event, records: PacketMonitorRecord[]) => {
    assertIpcSender(event, 'packetMonitor:record');
    if (!captureEnabled) return;
    if (!Array.isArray(records)) return;
    for (const record of records) {
      if (typeof record?.ts !== 'number' || typeof record.size !== 'number') continue;
      recordPacket(record);
    }
  });
}
