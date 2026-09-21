/**
 * Durable packet store for the Packet Monitor.
 *
 * Deliberately a separate SQLite file from sarmesh.db:
 *  - no CURRENT_SCHEMA_VERSION bump, so operators are not made to sit through a
 *    blocking Quit/Upgrade dialog for a feature they may never enable;
 *  - the main database stays small, which matters because support bundles copy
 *    it and it holds secrets;
 *  - this file can be deleted wholesale without risking chat, nodes or the
 *    radio inventory.
 *
 * Writes are batched. A saturated channel produces packets far faster than it
 * is sane to run one transaction per frame.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type {
  PacketMonitorQuery,
  PacketMonitorRecord,
  PacketMonitorStats,
} from '@/shared/packet-monitor-types';
import { PACKET_MONITOR_MAX_ROWS, retentionCutoffMs } from '@/shared/packet-monitor-types';

import { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

const PACKET_DB_FILENAME = 'packet-monitor.db';
/** Rows buffered before a flush; also flushed on a timer. */
const FLUSH_BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 2_000;
/** Prune runs on this cadence, not per insert. */
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

let db: NodeSqliteDB | null = null;
let pending: PacketMonitorRecord[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let pruneTimer: NodeJS.Timeout | null = null;
let retentionHours = 12;

export function getPacketMonitorDbPath(): string {
  return path.join(app.getPath('userData'), PACKET_DB_FILENAME);
}

function createSchema(target: NodeSqliteDB): void {
  target.execScript(`
    CREATE TABLE IF NOT EXISTS packets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      protocol TEXT NOT NULL,
      direction TEXT NOT NULL,
      from_node INTEGER,
      to_node INTEGER,
      portnum INTEGER,
      channel INTEGER,
      rssi REAL,
      snr REAL,
      hop_limit INTEGER,
      hop_start INTEGER,
      via_mqtt INTEGER,
      size INTEGER NOT NULL,
      raw_hex TEXT
    );
    -- Every query is "recent packets, newest first", usually narrowed further.
    CREATE INDEX IF NOT EXISTS idx_packets_ts ON packets (ts DESC);
    CREATE INDEX IF NOT EXISTS idx_packets_from ON packets (from_node, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_packets_proto ON packets (protocol, ts DESC);
  `);
}

/** Open (and create) the packet database. Safe to call repeatedly. */
export function initPacketMonitorDb(): NodeSqliteDB {
  if (db) return db;
  const dbPath = getPacketMonitorDbPath();
  const opened = new NodeSqliteDB(dbPath);
  createSchema(opened);
  // WAL keeps the capture writer from blocking the UI's reads.
  try {
    opened.pragma('journal_mode = WAL');
  } catch (err) {
    console.warn('[packet-monitor] WAL unavailable:', sanitizeLogMessage(String(err)));
  }
  db = opened;
  return db;
}

export function setPacketMonitorRetentionHours(hours: number): void {
  retentionHours = hours;
}

/** Queue a packet. Flushed in batches; never writes on the hot path. */
export function recordPacket(record: PacketMonitorRecord): void {
  pending.push(record);
  if (pending.length >= FLUSH_BATCH_SIZE) {
    flushPendingPackets();
    return;
  }
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushPendingPackets();
  }, FLUSH_INTERVAL_MS);
}

/** Write buffered packets in one transaction. */
export function flushPendingPackets(): number {
  if (pending.length === 0) return 0;
  const batch = pending;
  pending = [];

  let target: NodeSqliteDB;
  try {
    target = initPacketMonitorDb();
  } catch (err) {
    console.error('[packet-monitor] cannot open database:', sanitizeLogMessage(String(err)));
    return 0;
  }

  const insert = target.prepareOnce(`
    INSERT INTO packets
      (ts, protocol, direction, from_node, to_node, portnum, channel,
       rssi, snr, hop_limit, hop_start, via_mqtt, size, raw_hex)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    target.execScript('BEGIN');
    for (const p of batch) {
      insert.run(
        p.ts,
        p.protocol,
        p.direction,
        p.fromNode ?? null,
        p.toNode ?? null,
        p.portnum ?? null,
        p.channel ?? null,
        p.rssi ?? null,
        p.snr ?? null,
        p.hopLimit ?? null,
        p.hopStart ?? null,
        p.viaMqtt === undefined ? null : p.viaMqtt ? 1 : 0,
        p.size,
        p.rawHex ?? null,
      );
    }
    target.execScript('COMMIT');
    return batch.length;
  } catch (err) {
    try {
      target.execScript('ROLLBACK');
    } catch {
      // catch-no-log-ok: rollback of an already-failed transaction
    }
    console.error('[packet-monitor] batch insert failed:', sanitizeLogMessage(String(err)));
    return 0;
  }
}

/**
 * Drop packets outside the retention window, then enforce the row ceiling.
 *
 * Age first so an operator's chosen window is what actually governs; the row
 * cap only bites when that window still holds more than we will keep.
 */
export function prunePackets(nowMs = Date.now()): { byAge: number; byCount: number } {
  let target: NodeSqliteDB;
  try {
    target = initPacketMonitorDb();
  } catch (err) {
    console.error('[packet-monitor] prune: cannot open database:', sanitizeLogMessage(String(err)));
    return { byAge: 0, byCount: 0 };
  }

  const cutoff = retentionCutoffMs(retentionHours, nowMs);
  const byAge = Number(target.prepareOnce('DELETE FROM packets WHERE ts < ?').run(cutoff).changes);

  const byCount = Number(
    target
      .prepareOnce(
        `DELETE FROM packets WHERE id NOT IN (
         SELECT id FROM packets ORDER BY ts DESC LIMIT ?
       )`,
      )
      .run(PACKET_MONITOR_MAX_ROWS).changes,
  );

  if (byAge || byCount) {
    console.debug(`[packet-monitor] pruned ${byAge} by age, ${byCount} by row cap`);
  }
  return { byAge, byCount };
}

interface PacketRow {
  id: number;
  ts: number;
  protocol: string;
  direction: string;
  from_node: number | null;
  to_node: number | null;
  portnum: number | null;
  channel: number | null;
  rssi: number | null;
  snr: number | null;
  hop_limit: number | null;
  hop_start: number | null;
  via_mqtt: number | null;
  size: number;
  raw_hex: string | null;
}

function rowToRecord(row: PacketRow): PacketMonitorRecord {
  return {
    id: row.id,
    ts: row.ts,
    protocol: row.protocol as PacketMonitorRecord['protocol'],
    direction: row.direction as PacketMonitorRecord['direction'],
    fromNode: row.from_node ?? undefined,
    toNode: row.to_node ?? undefined,
    portnum: row.portnum ?? undefined,
    channel: row.channel ?? undefined,
    rssi: row.rssi ?? undefined,
    snr: row.snr ?? undefined,
    hopLimit: row.hop_limit ?? undefined,
    hopStart: row.hop_start ?? undefined,
    viaMqtt: row.via_mqtt === null ? undefined : row.via_mqtt === 1,
    size: row.size,
    rawHex: row.raw_hex ?? undefined,
  };
}

/** Newest first. Buffered packets are flushed so a query never misses them. */
export function queryPackets(query: PacketMonitorQuery = {}): PacketMonitorRecord[] {
  flushPendingPackets();
  const target = initPacketMonitorDb();

  const where: string[] = [];
  const args: unknown[] = [];
  if (query.sinceMs !== undefined) {
    where.push('ts >= ?');
    args.push(query.sinceMs);
  }
  if (query.untilMs !== undefined) {
    where.push('ts <= ?');
    args.push(query.untilMs);
  }
  if (query.protocol) {
    where.push('protocol = ?');
    args.push(query.protocol);
  }
  if (query.direction) {
    where.push('direction = ?');
    args.push(query.direction);
  }
  if (query.fromNode !== undefined) {
    where.push('from_node = ?');
    args.push(query.fromNode);
  }
  if (query.portnum !== undefined) {
    where.push('portnum = ?');
    args.push(query.portnum);
  }

  const limit = Math.min(Math.max(query.limit ?? 1000, 1), 10_000);
  const sql =
    `SELECT * FROM packets${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ` +
    `ORDER BY ts DESC LIMIT ?`;
  const rows = target.prepare(sql).all(...args, limit) as PacketRow[];
  return rows.map(rowToRecord);
}

export function getPacketMonitorStats(): PacketMonitorStats {
  flushPendingPackets();
  const target = initPacketMonitorDb();
  const agg = target
    .prepareOnce('SELECT COUNT(*) AS n, MIN(ts) AS oldest, MAX(ts) AS newest FROM packets')
    .get() as { n: number; oldest: number | null; newest: number | null };

  let fileBytes = 0;
  try {
    fileBytes = fs.statSync(getPacketMonitorDbPath()).size;
  } catch {
    // catch-no-log-ok: the file may not exist before the first capture
  }

  return {
    rowCount: agg.n,
    oldestMs: agg.oldest ?? null,
    newestMs: agg.newest ?? null,
    fileBytes,
  };
}

/** Empty the log without touching the main database. */
export function clearPackets(): number {
  pending = [];
  const target = initPacketMonitorDb();
  const changes = target.prepareOnce('DELETE FROM packets').run().changes;
  try {
    target.execScript('VACUUM');
  } catch (err) {
    console.warn('[packet-monitor] VACUUM failed:', sanitizeLogMessage(String(err)));
  }
  return Number(changes);
}

/** Start the periodic prune. Idempotent. */
export function startPacketMonitorMaintenance(): void {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    prunePackets();
  }, PRUNE_INTERVAL_MS);
}

/** Flush and close; called on shutdown so buffered packets are not lost. */
export function shutdownPacketMonitor(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  flushPendingPackets();
  try {
    db?.close();
  } catch {
    // catch-no-log-ok: already closed during shutdown
  }
  db = null;
}

/** Test seam. */
export function resetPacketMonitorForTests(): void {
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  flushTimer = null;
  pruneTimer = null;
  db = null;
}
