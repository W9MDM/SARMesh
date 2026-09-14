/**
 * The mesh -> APRS bridge.
 *
 * Takes node positions observed anywhere in the app, decides whether they
 * should be beaconed (on the roster? enabled? fresh? not rate-limited?),
 * encodes them as APRS, and fans them out to every enabled sink.
 *
 * Shaped after TakServerManager so the two behave the same way from main's
 * point of view: construct, `start(settings)`, feed `onNodeUpdate`, `stop()`.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type {
  AprsBridgeStatus,
  AprsEmitRecord,
  AprsNodeUpdate,
  AprsSettings,
  AprsSinkKind,
  AprsSinkStatus,
  AprsSuppressionReason,
  AprsTrackedClient,
} from '../shared/aprs-types';
import { DEFAULT_APRS_SETTINGS } from '../shared/aprs-types';
import { AprsIsServer } from './aprs/aprs-is-server';
import { AprsIsUpstream } from './aprs/aprs-is-upstream';
import { buildTnc2Frame, frameForTrackedClient, sanitizeCallsign } from './aprs/encode';
import { KissServer } from './aprs/kiss';
import { sanitizeLogMessage } from './log-service';

const RECENT_LIMIT = 500;
const MS_PER_SECOND = 1000;

export class AprsBridgeManager extends EventEmitter {
  private readonly localServer = new AprsIsServer();
  private readonly upstream = new AprsIsUpstream();
  private readonly kiss = new KissServer();

  private settings: AprsSettings = DEFAULT_APRS_SETTINGS;
  private clients = new Map<number, AprsTrackedClient>();
  /** node id -> epoch ms of the last emitted beacon, for rate limiting. */
  private readonly lastEmit = new Map<number, number>();
  private readonly recent: AprsEmitRecord[] = [];
  private started = false;
  private lastError: string | undefined;

  constructor() {
    super();
    this.wireSinkEvents();
  }

  private get settingsPath(): string {
    return path.join(app.getPath('userData'), 'aprs-settings.json');
  }

  private get rosterPath(): string {
    return path.join(app.getPath('userData'), 'aprs-roster.json');
  }

  // ------------------------------------------------------------ persistence

  loadSettings(): AprsSettings {
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AprsSettings>;
      // Merge onto defaults so a file written by an older build cannot leave
      // newly added fields undefined.
      this.settings = {
        ...DEFAULT_APRS_SETTINGS,
        ...parsed,
        localServer: { ...DEFAULT_APRS_SETTINGS.localServer, ...parsed.localServer },
        upstream: { ...DEFAULT_APRS_SETTINGS.upstream, ...parsed.upstream },
        kiss: { ...DEFAULT_APRS_SETTINGS.kiss, ...parsed.kiss },
      };
    } catch {
      // catch-no-log-ok: absent or unreadable settings fall back to defaults
      this.settings = { ...DEFAULT_APRS_SETTINGS };
    }
    return this.settings;
  }

  saveSettings(settings: AprsSettings): void {
    this.settings = settings;
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  getSettings(): AprsSettings {
    return this.settings;
  }

  loadRoster(): AprsTrackedClient[] {
    try {
      const raw = fs.readFileSync(this.rosterPath, 'utf8');
      const parsed = JSON.parse(raw) as AprsTrackedClient[];
      if (Array.isArray(parsed)) {
        this.clients = new Map(parsed.map((client) => [client.nodeId, client]));
      }
    } catch {
      // catch-no-log-ok: no roster yet is the normal first-run state
      this.clients = new Map();
    }
    return this.getRoster();
  }

  getRoster(): AprsTrackedClient[] {
    return [...this.clients.values()].sort((a, b) => a.callsign.localeCompare(b.callsign));
  }

  setRoster(clients: AprsTrackedClient[]): AprsTrackedClient[] {
    this.clients = new Map(clients.map((client) => [client.nodeId, client]));
    fs.writeFileSync(this.rosterPath, JSON.stringify(this.getRoster(), null, 2));
    this.emit('status', this.getStatus());
    return this.getRoster();
  }

  upsertTrackedClient(client: AprsTrackedClient): AprsTrackedClient[] {
    const next = this.getRoster().filter((entry) => entry.nodeId !== client.nodeId);
    next.push(client);
    return this.setRoster(next);
  }

  removeTrackedClient(nodeId: number): AprsTrackedClient[] {
    return this.setRoster(this.getRoster().filter((entry) => entry.nodeId !== nodeId));
  }

  // -------------------------------------------------------------- lifecycle

  async start(settings: AprsSettings): Promise<void> {
    if (this.started) await this.stop();

    this.saveSettings(settings);
    this.lastError = undefined;

    if (settings.localServer.enabled) {
      try {
        await this.localServer.start(settings.localServer.host, settings.localServer.port);
      } catch (err) {
        // catch-no-log-ok: recordError() console.errors and surfaces it in status
        this.recordError('APRS-IS server', err);
      }
    }
    if (settings.kiss.enabled) {
      try {
        await this.kiss.start(settings.kiss.host, settings.kiss.port);
      } catch (err) {
        // catch-no-log-ok: recordError() console.errors and surfaces it in status
        this.recordError('KISS server', err);
      }
    }
    if (settings.upstream.enabled) {
      try {
        this.upstream.start(settings.upstream);
      } catch (err) {
        // catch-no-log-ok: recordError() console.errors and surfaces it in status
        this.recordError('APRS-IS upstream', err);
      }
    }

    this.started = true;
    this.emit('status', this.getStatus());
  }

  async stop(): Promise<void> {
    this.upstream.stop();
    await Promise.all([this.localServer.stop(), this.kiss.stop()]);
    this.started = false;
    this.emit('status', this.getStatus());
  }

  getStatus(): AprsBridgeStatus {
    const sinks: AprsSinkStatus[] = [
      {
        kind: 'aprs-is-server',
        running: this.localServer.running,
        clients: this.localServer.clientCount,
        emitted: this.localServer.emittedCount,
      },
      {
        kind: 'aprs-is-upstream',
        running: this.upstream.running,
        clients: this.upstream.running ? 1 : 0,
        emitted: this.upstream.emittedCount,
      },
      {
        kind: 'kiss-tcp',
        running: this.kiss.running,
        clients: this.kiss.clientCount,
        emitted: this.kiss.emittedCount,
      },
    ];

    return {
      running: this.started && sinks.some((sink) => sink.running),
      sinks,
      trackedCount: this.getRoster().filter((client) => client.enabled).length,
      error: this.lastError,
    };
  }

  getRecent(limit = 100): AprsEmitRecord[] {
    return this.recent.slice(-limit).reverse();
  }

  // ------------------------------------------------------------------ ingest

  /**
   * Offer a node update to the bridge. Returns the emitted record, or the
   * reason it was suppressed so the UI can explain the silence.
   */
  onNodeUpdate(node: AprsNodeUpdate): AprsEmitRecord | AprsSuppressionReason {
    if (!this.started) return 'bridge-stopped';

    const client = this.clients.get(node.node_id);
    if (!client) return 'not-tracked';
    if (!client.enabled) return 'client-disabled';

    const latitude = node.latitude ?? 0;
    const longitude = node.longitude ?? 0;
    // Meshtastic reports 0/0 when a node has no fix rather than omitting it.
    if (!latitude && !longitude) return 'no-fix';

    const now = Date.now();
    // `last_heard` is unix seconds on the nodes table.
    const fixTime = node.last_heard ? node.last_heard * MS_PER_SECOND : now;

    if (this.settings.maxAgeSeconds > 0) {
      if ((now - fixTime) / MS_PER_SECOND > this.settings.maxAgeSeconds) return 'stale';
    }

    const last = this.lastEmit.get(node.node_id);
    if (last !== undefined && (now - last) / MS_PER_SECOND < this.settings.minIntervalSeconds) {
      return 'rate-limited';
    }

    const frame = frameForTrackedClient(
      client,
      {
        latitude,
        longitude,
        altitude: node.altitude ?? undefined,
        time: fixTime,
      },
      this.settings.commentSuffix,
    );
    this.lastEmit.set(node.node_id, now);
    return this.dispatch(frame, node.node_id, sanitizeCallsign(client.callsign));
  }

  /**
   * Emit a synthetic beacon so an operator can confirm CalTopo is receiving
   * before the team deploys.
   */
  sendTestBeacon(callsign: string, latitude: number, longitude: number): AprsEmitRecord {
    const frame = buildTnc2Frame({
      callsign,
      latitude,
      longitude,
      symbolTable: '/',
      symbolCode: '[',
      comment: `SARMesh test beacon ${this.settings.commentSuffix}`.trim(),
    });
    return this.dispatch(frame, 0, sanitizeCallsign(callsign));
  }

  private dispatch(frame: string, nodeId: number, callsign: string): AprsEmitRecord {
    const sinks: AprsSinkKind[] = [];
    if (this.localServer.broadcast(frame) > 0) sinks.push('aprs-is-server');
    if (this.kiss.broadcast(frame) > 0) sinks.push('kiss-tcp');
    if (this.upstream.send(frame)) sinks.push('aprs-is-upstream');

    const record: AprsEmitRecord = { time: Date.now(), nodeId, callsign, frame, sinks };
    this.recent.push(record);
    if (this.recent.length > RECENT_LIMIT) this.recent.shift();
    this.emit('emitted', record);
    return record;
  }

  private recordError(what: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.lastError = `${what}: ${message}`;
    console.error(`[aprs] ${what} failed to start:`, sanitizeLogMessage(message));
    this.emit('status', this.getStatus());
  }

  private wireSinkEvents(): void {
    const pushStatus = (): void => {
      this.emit('status', this.getStatus());
    };

    this.localServer.on('clientCount', pushStatus);
    this.kiss.on('clientCount', pushStatus);
    this.upstream.on('connected', pushStatus);
    this.upstream.on('disconnected', pushStatus);

    for (const sink of [this.localServer, this.kiss, this.upstream]) {
      sink.on('log', (message: string) => {
        console.debug('[aprs]', sanitizeLogMessage(message));
      });
      sink.on('error', (err: Error) => {
        console.error('[aprs] sink error:', sanitizeLogMessage(err.message));
      });
    }
  }
}
