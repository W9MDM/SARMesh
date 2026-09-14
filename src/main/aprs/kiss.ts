/**
 * KISS-over-TCP sink, for consumers that expect a hardware TNC rather than an
 * APRS-IS feed (Xastir's "Network TNC" port, Direwolf-style tooling, YAAC).
 *
 * TNC2 frames are encoded into AX.25 UI frames and wrapped in KISS framing.
 * Reference: AX.25 2.2 section 3.12 (address field) and the KISS spec.
 */
import { EventEmitter } from 'node:events';
import net from 'node:net';

const FEND = 0xc0;
const FESC = 0xdb;
const TFEND = 0xdc;
const TFESC = 0xdd;

/** AX.25 UI frame control byte and the APRS protocol id (no layer 3). */
const AX25_CONTROL_UI = 0x03;
const AX25_PID_NO_L3 = 0xf0;

/** Path elements that only exist on the internet side of APRS. */
const INTERNET_ONLY_PATH_RE = /^(TCPIP\*?|TCPXX\*?|q[A-Z]{2}|NOGATE|RFONLY)$/i;

/**
 * Encode one AX.25 address (callsign + SSID) as 7 bytes: the callsign is
 * shifted left one bit and space-padded to 6 characters, then the SSID byte
 * carries the SSID in bits 1-4 with bit 0 set on the final address.
 */
function encodeAx25Address(callsign: string, isLast: boolean, hasBeenRepeated = false): Buffer {
  const [base = '', ssidRaw = '0'] = callsign.toUpperCase().split('-', 2);
  const padded = base.slice(0, 6).padEnd(6, ' ');
  const ssid = Math.max(0, Math.min(Number.parseInt(ssidRaw, 10) || 0, 15));

  const bytes = Buffer.alloc(7);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = padded.charCodeAt(i) << 1;
  }
  // bit7 has-been-repeated (digipeaters), bits 5-6 reserved (set), bits 1-4
  // SSID, bit0 end-of-address.
  bytes[6] = (hasBeenRepeated ? 0x80 : 0x00) | 0x60 | (ssid << 1) | (isLast ? 0x01 : 0x00);
  return bytes;
}

/** Convert a TNC2 monitor line (`SRC>DEST,PATH:info`) into an AX.25 UI frame. */
export function tnc2ToAx25(tnc2Frame: string): Buffer {
  const colon = tnc2Frame.indexOf(':');
  if (colon === -1) throw new Error(`Malformed TNC2 frame (no information field): ${tnc2Frame}`);

  const header = tnc2Frame.slice(0, colon);
  const info = tnc2Frame.slice(colon + 1);

  const gt = header.indexOf('>');
  if (gt === -1) throw new Error(`Malformed TNC2 frame (no destination): ${tnc2Frame}`);

  const source = header.slice(0, gt);
  const [destination = 'APRS', ...path] = header.slice(gt + 1).split(',');

  // Internet-only markers have no meaning on an AX.25 link.
  const digipeaters = path.filter((element) => !INTERNET_ONLY_PATH_RE.test(element)).slice(0, 8);

  const addresses: Buffer[] = [
    encodeAx25Address(destination, false),
    encodeAx25Address(source, digipeaters.length === 0),
  ];
  digipeaters.forEach((digi, index) => {
    addresses.push(
      encodeAx25Address(
        digi.replace(/\*$/, ''),
        index === digipeaters.length - 1,
        digi.endsWith('*'),
      ),
    );
  });

  return Buffer.concat([
    ...addresses,
    Buffer.from([AX25_CONTROL_UI, AX25_PID_NO_L3]),
    Buffer.from(info, 'latin1'),
  ]);
}

/** Wrap a payload in KISS framing on the given port with the data command. */
export function kissWrap(payload: Buffer, port = 0): Buffer {
  const escaped: number[] = [];
  for (const byte of payload) {
    if (byte === FEND) escaped.push(FESC, TFEND);
    else if (byte === FESC) escaped.push(FESC, TFESC);
    else escaped.push(byte);
  }
  return Buffer.from([FEND, (port << 4) | 0x00, ...escaped, FEND]);
}

/** TCP server streaming KISS-framed AX.25 UI frames to connected clients. */
export class KissServer extends EventEmitter {
  private server: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private emitted = 0;

  get running(): boolean {
    return this.server?.listening ?? false;
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  get emittedCount(): number {
    return this.emitted;
  }

  async start(host: string, port: number): Promise<void> {
    if (this.server) await this.stop();

    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        socket.setNoDelay(true);
        this.sockets.add(socket);
        this.emit('clientCount', this.sockets.size);
        // catch-no-log-ok: peer resets are routine and handled by 'close'
        socket.on('error', () => {});
        // One-way feed; inbound KISS frames are discarded.
        socket.on('data', () => {});
        socket.on('close', () => {
          this.sockets.delete(socket);
          this.emit('clientCount', this.sockets.size);
        });
      });
      server.once('error', reject);
      server.listen(port, host, () => {
        server.removeListener('error', reject);
        server.on('error', (err) => this.emit('error', err));
        this.server = server;
        this.emit('log', `KISS TCP server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
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

  broadcast(tnc2Frame: string): number {
    if (this.sockets.size === 0) return 0;
    let frame: Buffer;
    try {
      frame = kissWrap(tnc2ToAx25(tnc2Frame));
    } catch (err) {
      // catch-no-log-ok: re-emitted as 'error'; AprsBridgeManager logs it once
      this.emit('error', err);
      return 0;
    }

    let delivered = 0;
    for (const socket of this.sockets) {
      if (socket.destroyed) continue;
      socket.write(frame);
      delivered += 1;
    }
    if (delivered > 0) this.emitted += 1;
    return delivered;
  }
}
