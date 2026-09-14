/**
 * APRS-IS *client* — pushes mesh positions into the public APRS-IS network so
 * they reach cloud CalTopo/SARTopo, aprs.fi and friends.
 *
 * Injecting into public APRS-IS requires a valid amateur radio callsign and its
 * APRS-IS passcode, and everything injected becomes public. For most SAR work
 * the local server is the right tool; this path is opt-in and off by default.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';

import type { AprsUpstreamSettings } from '../../shared/aprs-types';

const APP_NAME = 'SARMesh';
const APP_VERSION = '1.0';
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

export class AprsIsUpstream extends EventEmitter {
  private socket: net.Socket | null = null;
  private settings: AprsUpstreamSettings | null = null;
  private loggedIn = false;
  private stopping = false;
  private retries = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private emitted = 0;

  get running(): boolean {
    return this.loggedIn;
  }

  get emittedCount(): number {
    return this.emitted;
  }

  start(settings: AprsUpstreamSettings): void {
    if (!settings.callsign.trim() || !settings.passcode.trim()) {
      throw new Error(
        'APRS-IS upstream needs a licensed callsign and its passcode. Leave it ' +
          'disabled and use the local APRS-IS server instead.',
      );
    }
    this.stopping = false;
    this.settings = settings;
    this.connect();
  }

  stop(): void {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.loggedIn = false;
    this.socket?.destroy();
    this.socket = null;
  }

  /** Send one TNC2 frame upstream. Returns false when not logged in yet. */
  send(tnc2Frame: string): boolean {
    if (!this.loggedIn || !this.socket || this.socket.destroyed) return false;
    const ok = this.socket.write(`${tnc2Frame}\r\n`);
    if (ok) this.emitted += 1;
    return ok;
  }

  private connect(): void {
    const settings = this.settings;
    if (!settings || this.stopping) return;

    const socket = net.createConnection({ host: settings.host, port: settings.port });
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    socket.on('connect', () => {
      this.retries = 0;
      this.emit('log', `APRS-IS upstream connected to ${settings.host}:${settings.port}`);
      // `filter m/0` keeps the server from streaming the world back at us; the
      // socket is only needed for injection.
      socket.write(
        `user ${settings.callsign} pass ${settings.passcode} ` +
          `vers ${APP_NAME} ${APP_VERSION} filter m/0\r\n`,
      );
    });

    socket.on('data', (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.startsWith('#') || !/logresp/i.test(line)) continue;
        this.loggedIn = true;
        this.emit('connected');
        this.emit('log', `APRS-IS upstream: ${line}`);
        if (/unverified/i.test(line)) {
          this.emit(
            'log',
            'APRS-IS upstream reports UNVERIFIED — the passcode does not match the ' +
              'callsign, so the network will discard these packets.',
          );
        }
      }
    });

    socket.on('error', (err) => this.emit('error', err));
    socket.on('close', () => {
      const wasLoggedIn = this.loggedIn;
      this.loggedIn = false;
      if (wasLoggedIn) this.emit('disconnected');
      if (!this.stopping) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.retries += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.retries - 1), RECONNECT_MAX_MS);
    this.emit('log', `APRS-IS upstream reconnecting in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
