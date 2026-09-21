/**
 * Renderer side of the Packet Monitor capture path.
 *
 * Packets are decoded here, so capture is pushed to main rather than tapped
 * there. Two things matter on this path:
 *
 *  - It must not slow packet handling. Records are buffered and sent in
 *    batches; nothing awaits a round trip.
 *  - It must cost nothing when capture is off, which is the default. The gate
 *    is checked before a record is even built.
 */
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { PacketDirection, PacketMonitorRecord } from '@/shared/packet-monitor-types';
import { rawFrameToStoredHex } from '@/shared/packet-monitor-types';

/** Records buffered before a send; also flushed on a timer. */
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 1_000;

let enabled = false;
let buffer: PacketMonitorRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Mirror of the persisted setting; checked before any work is done. */
export function setPacketCaptureEnabled(next: boolean): void {
  enabled = next;
  if (!next) {
    // Send what we already hold rather than discarding it.
    flushPacketCapture();
  }
}

export function isPacketCaptureEnabled(): boolean {
  return enabled;
}

export function flushPacketCapture(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  try {
    window.electronAPI.packetMonitor.record(batch);
  } catch (e) {
    // catch-no-log-ok: capture is best-effort and must never disrupt packet handling
    console.debug('[packetMonitorCapture] record failed', e);
  }
}

export interface CapturePacketInput {
  ts: number;
  protocol: MeshProtocol;
  direction?: PacketDirection;
  fromNode?: number;
  toNode?: number;
  portnum?: number;
  channel?: number;
  rssi?: number;
  snr?: number;
  hopLimit?: number;
  hopStart?: number;
  viaMqtt?: boolean;
  raw?: Uint8Array;
  /** Frame length when the raw bytes are not retained. */
  size?: number;
}

/** Queue one packet. A no-op when capture is off. */
export function capturePacket(input: CapturePacketInput): void {
  if (!enabled) return;

  const size = input.size ?? input.raw?.length ?? 0;
  buffer.push({
    ts: input.ts,
    protocol: input.protocol,
    direction: input.direction ?? 'rx',
    fromNode: input.fromNode,
    toNode: input.toNode,
    portnum: input.portnum,
    channel: input.channel,
    rssi: input.rssi,
    snr: input.snr,
    hopLimit: input.hopLimit,
    hopStart: input.hopStart,
    viaMqtt: input.viaMqtt,
    size,
    rawHex: rawFrameToStoredHex(input.raw),
  });

  if (buffer.length >= BATCH_SIZE) {
    flushPacketCapture();
    return;
  }
  timer ??= setTimeout(() => {
    timer = null;
    flushPacketCapture();
  }, FLUSH_INTERVAL_MS);
}

/** Test seam. */
export function resetPacketCaptureForTests(): void {
  enabled = false;
  buffer = [];
  if (timer) clearTimeout(timer);
  timer = null;
}
