import { ipcMain } from 'electron';

import type { AprsSettings, AprsTrackedClient } from '../../shared/aprs-types';
import {
  DEFAULT_TRACKER_TYPE_ID,
  getTrackerType,
  isTrackerTypeId,
} from '../../shared/tracker-types';
import type { AprsBridgeManager } from '../aprs-bridge-manager';
import { sanitizeLogMessage } from '../log-service';
import { assertIpcSender } from '../validate-ipc-sender';

export interface AprsIpcDeps {
  getAprsBridgeManager: () => AprsBridgeManager;
}

/** Longest roster we will accept, to bound memory and the settings file. */
const MAX_ROSTER = 500;

function asRecord(value: unknown, channel: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${channel}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function requireFiniteNumber(value: unknown, channel: string, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${channel}: ${field} must be a finite number`);
  return n;
}

function requireBoundedString(value: unknown, channel: string, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${channel}: ${field} must be a string`);
  if (value.length > max) throw new Error(`${channel}: ${field} exceeds ${max} characters`);
  return value;
}

/** Validate settings arriving from the renderer before they reach the bridge. */
export function validateAprsSettings(
  settings: unknown,
  channel = 'aprs:start',
): asserts settings is AprsSettings {
  const s = asRecord(settings, channel);
  const server = asRecord(s.localServer, channel);
  const upstream = asRecord(s.upstream, channel);
  const kiss = asRecord(s.kiss, channel);

  for (const [label, block] of [
    ['localServer', server],
    ['upstream', upstream],
    ['kiss', kiss],
  ] as const) {
    const port = requireFiniteNumber(block.port, channel, `${label}.port`);
    if (port < 1 || port > 65535) throw new Error(`${channel}: ${label}.port out of range`);
    requireBoundedString(block.host, channel, `${label}.host`, 255);
  }

  requireBoundedString(upstream.callsign, channel, 'upstream.callsign', 16);
  requireBoundedString(upstream.passcode, channel, 'upstream.passcode', 16);
  requireBoundedString(s.commentSuffix, channel, 'commentSuffix', 120);
  requireFiniteNumber(s.minIntervalSeconds, channel, 'minIntervalSeconds');
  requireFiniteNumber(s.maxAgeSeconds, channel, 'maxAgeSeconds');

  // Injecting into the public network under someone else's callsign is not
  // acceptable use, so refuse to start upstream without credentials.
  if (upstream.enabled === true && !String(upstream.callsign).trim()) {
    throw new Error(`${channel}: public APRS-IS requires a licensed callsign`);
  }
}

function validateRoster(roster: unknown, channel: string): AprsTrackedClient[] {
  if (!Array.isArray(roster)) throw new Error(`${channel}: roster must be an array`);
  if (roster.length > MAX_ROSTER) throw new Error(`${channel}: roster exceeds ${MAX_ROSTER}`);

  return roster.map((entry) => {
    const e = asRecord(entry, channel);
    const nodeId = requireFiniteNumber(e.nodeId, channel, 'nodeId');
    // An unknown tracker type degrades to a ground team rather than being
    // rejected, so an older roster file still loads.
    const trackerType = isTrackerTypeId(e.trackerType) ? e.trackerType : DEFAULT_TRACKER_TYPE_ID;
    const fallback = getTrackerType(trackerType);

    return {
      nodeId,
      callsign: requireBoundedString(e.callsign, channel, 'callsign', 16),
      team: e.team === undefined ? undefined : requireBoundedString(e.team, channel, 'team', 64),
      trackerType,
      symbolTable:
        typeof e.symbolTable === 'string' && e.symbolTable.length === 1
          ? e.symbolTable
          : fallback.symbolTable,
      symbolCode:
        typeof e.symbolCode === 'string' && e.symbolCode.length === 1
          ? e.symbolCode
          : fallback.symbolCode,
      enabled: e.enabled !== false,
      comment:
        e.comment === undefined
          ? undefined
          : requireBoundedString(e.comment, channel, 'comment', 120),
    } satisfies AprsTrackedClient;
  });
}

/** Register APRS bridge IPC handlers (`aprs:*`). */
export function registerAprsIpcHandlers(deps: AprsIpcDeps): void {
  const { getAprsBridgeManager } = deps;

  ipcMain.handle('aprs:start', async (event, settings: unknown) => {
    assertIpcSender(event, 'aprs:start');
    try {
      console.debug('[IPC] aprs:start');
      validateAprsSettings(settings);
      await getAprsBridgeManager().start(settings);
    } catch (err) {
      console.error(
        '[IPC] aprs:start failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      throw err;
    }
  });

  ipcMain.handle('aprs:stop', async (event) => {
    assertIpcSender(event, 'aprs:stop');
    console.debug('[IPC] aprs:stop');
    await getAprsBridgeManager().stop();
  });

  ipcMain.handle('aprs:getStatus', (event) => {
    assertIpcSender(event, 'aprs:getStatus');
    return getAprsBridgeManager().getStatus();
  });

  ipcMain.handle('aprs:getSettings', (event) => {
    assertIpcSender(event, 'aprs:getSettings');
    return getAprsBridgeManager().getSettings();
  });

  ipcMain.handle('aprs:saveSettings', (event, settings: unknown) => {
    assertIpcSender(event, 'aprs:saveSettings');
    validateAprsSettings(settings, 'aprs:saveSettings');
    getAprsBridgeManager().saveSettings(settings);
  });

  ipcMain.handle('aprs:getRoster', (event) => {
    assertIpcSender(event, 'aprs:getRoster');
    return getAprsBridgeManager().getRoster();
  });

  ipcMain.handle('aprs:setRoster', (event, roster: unknown) => {
    assertIpcSender(event, 'aprs:setRoster');
    return getAprsBridgeManager().setRoster(validateRoster(roster, 'aprs:setRoster'));
  });

  ipcMain.handle('aprs:upsertTrackedClient', (event, client: unknown) => {
    assertIpcSender(event, 'aprs:upsertTrackedClient');
    const [validated] = validateRoster([client], 'aprs:upsertTrackedClient');
    if (!validated) throw new Error('aprs:upsertTrackedClient: invalid client');
    return getAprsBridgeManager().upsertTrackedClient(validated);
  });

  ipcMain.handle('aprs:removeTrackedClient', (event, nodeId: unknown) => {
    assertIpcSender(event, 'aprs:removeTrackedClient');
    return getAprsBridgeManager().removeTrackedClient(
      requireFiniteNumber(nodeId, 'aprs:removeTrackedClient', 'nodeId'),
    );
  });

  ipcMain.handle('aprs:getRecent', (event, limit: unknown) => {
    assertIpcSender(event, 'aprs:getRecent');
    const n = Number(limit);
    return getAprsBridgeManager().getRecent(
      Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100,
    );
  });

  ipcMain.handle(
    'aprs:sendTestBeacon',
    (event, callsign: unknown, latitude: unknown, longitude: unknown) => {
      assertIpcSender(event, 'aprs:sendTestBeacon');
      const lat = requireFiniteNumber(latitude, 'aprs:sendTestBeacon', 'latitude');
      const lon = requireFiniteNumber(longitude, 'aprs:sendTestBeacon', 'longitude');
      if (lat < -90 || lat > 90) throw new Error('aprs:sendTestBeacon: latitude out of range');
      if (lon < -180 || lon > 180) throw new Error('aprs:sendTestBeacon: longitude out of range');
      return getAprsBridgeManager().sendTestBeacon(
        requireBoundedString(callsign, 'aprs:sendTestBeacon', 'callsign', 16),
        lat,
        lon,
      );
    },
  );
}
