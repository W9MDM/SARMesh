/**
 * A minimal APRS-IS *server*.
 *
 * The primary integration path for CalTopo / SARTopo Desktop and for any
 * conventional APRS client: they are configured to connect to an APRS-IS
 * server, and we pretend to be one on localhost. Positions heard on the mesh
 * are pushed to every connected client as TNC2 monitor lines.
 *
 * Nothing here touches RF or the public APRS-IS network, so no amateur licence
 * is involved — see docs/aprs-caltopo.md.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';

import { serverComment } from './encode';

const SERVER_ID = 'SARMesh';
/** APRS-IS clients drop a socket that goes quiet; 20s is the usual keepalive. */
const KEEPALIVE_MS = 20_000;
/** Guard against a peer that never sends a newline. */
const MAX_LINE_BUFFER = 8192;

interface AprsClient {
  socket: net.Socket;
  remote: string;
  loggedIn: boolean;
  callsign?: string;
  buffer: string;
}

export class AprsIsServer extends EventEmitter {
  private server: net.Server | null = null;
  private readonly clients = new Set<AprsClient>();
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private emitted = 0;

  get running(): boolean {
    return this.server?.listening ?? false;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  get emittedCount(): number {
    return this.emitted;
  }

  async start(host: string, port: number): Promise<void> {
    if (this.server) await this.stop();

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleConnection(socket);
      });
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        server.on('error', (err) => this.emit('error', err));
        this.server = server;
        this.emit('log', `APRS-IS server listening on ${host}:${port}`);
        resolve();
      });
    });

    this.keepaliveTimer = setInterval(() => {
      this.broadcastRaw(serverComment(`${SERVER_ID} keepalive`));
    }, KEEPALIVE_MS);
  }

  async stop(): Promise<void> {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    this.emit('clientCount', 0);

    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }

  /**
   * Push one TNC2 frame to every logged-in client. Frames are only delivered
   * after login so a client still mid-handshake is not confused.
   */
  broadcast(tnc2Frame: string): number {
    let delivered = 0;
    for (const client of this.clients) {
      if (!client.loggedIn) continue;
      if (this.write(client, tnc2Frame)) delivered += 1;
    }
    if (delivered > 0) this.emitted += 1;
    return delivered;
  }

  private broadcastRaw(line: string): void {
    for (const client of this.clients) this.write(client, line);
  }

  private write(client: AprsClient, line: string): boolean {
    if (client.socket.destroyed) return false;
    return client.socket.write(`${line}\r\n`);
  }

  private handleConnection(socket: net.Socket): void {
    socket.setNoDelay(true);
    socket.setEncoding('utf8');

    const client: AprsClient = {
      socket,
      remote: `${socket.remoteAddress}:${socket.remotePort}`,
      loggedIn: false,
      buffer: '',
    };
    this.clients.add(client);
    this.emit('clientCount', this.clients.size);
    this.emit('log', `APRS-IS client connected: ${client.remote}`);

    // Every APRS-IS server opens with a banner; clients wait for it.
    this.write(client, serverComment(`aprsc ${SERVER_ID}`));

    socket.on('data', (chunk: string) => {
      this.handleData(client, chunk);
    });
    // catch-no-log-ok: a peer resetting the socket is routine and handled by 'close'
    socket.on('error', () => {});
    socket.on('close', () => {
      this.clients.delete(client);
      this.emit('clientCount', this.clients.size);
      this.emit('log', `APRS-IS client disconnected: ${client.remote}`);
    });
  }

  private handleData(client: AprsClient, chunk: string): void {
    client.buffer += chunk;
    if (client.buffer.length > MAX_LINE_BUFFER) client.buffer = '';

    let index = client.buffer.indexOf('\n');
    while (index !== -1) {
      const line = client.buffer.slice(0, index).replace(/\r$/, '');
      client.buffer = client.buffer.slice(index + 1);
      if (line.length > 0) this.handleLine(client, line);
      index = client.buffer.indexOf('\n');
    }
  }

  private handleLine(client: AprsClient, line: string): void {
    if (line.startsWith('#')) return; // client comment / keepalive

    if (!client.loggedIn && /^user\s+/i.test(line)) {
      // `user CALL pass PASS vers APP VER [filter ...]`
      const callsign = line.split(/\s+/)[1] ?? 'UNKNOWN';
      client.callsign = callsign;
      client.loggedIn = true;
      // Every login is accepted and marked unverified: this feed is
      // receive-only for the client, so there is nothing to authorise.
      this.write(client, serverComment(`logresp ${callsign} unverified, server ${SERVER_ID}`));
      this.emit('log', `APRS-IS login from ${client.remote} as ${callsign}`);
      return;
    }

    // Clients may try to inject their own position; this is a one-way feed.
  }
}
