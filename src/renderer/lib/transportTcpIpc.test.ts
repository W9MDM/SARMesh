// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransportTcpIpc } from './transportTcpIpc';

describe('TransportTcpIpc', () => {
  let onDataCallback: ((bytes: Uint8Array) => void) | null = null;
  let onDisconnectedCallback: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    onDataCallback = null;
    onDisconnectedCallback = null;
    vi.mocked(window.electronAPI.meshtastic.tcp.onData).mockImplementation((cb) => {
      onDataCallback = cb;
      return () => {
        onDataCallback = null;
      };
    });
    vi.mocked(window.electronAPI.meshtastic.tcp.onDisconnected).mockImplementation((cb) => {
      onDisconnectedCallback = cb;
      return () => {
        onDisconnectedCallback = null;
      };
    });
  });

  it('connect() calls electronAPI.meshtastic.tcp.connect with host and port', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    await transport.connect();
    expect(window.electronAPI.meshtastic.tcp.connect).toHaveBeenCalledWith('192.168.200.4', 4403);
  });

  it('frames outbound writes with 0x94 0xc3 magic + big-endian length', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const writer = transport.toDevice.getWriter();
    await writer.write(new Uint8Array([1, 2, 3]));
    writer.releaseLock();

    expect(window.electronAPI.meshtastic.tcp.write).toHaveBeenCalledTimes(1);
    const sentBytes = vi.mocked(window.electronAPI.meshtastic.tcp.write).mock.calls[0][0];
    expect(sentBytes).toEqual([0x94, 0xc3, 0, 3, 1, 2, 3]);
  });

  it('parses a complete framed message delivered via onData into a packet', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    expect(onDataCallback).not.toBeNull();

    const reader = transport.fromDevice.getReader();
    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 2, 0xaa, 0xbb]));

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([0xaa, 0xbb]) });
    reader.releaseLock();
  });

  it('delivers a packet whose payload contains the 0x94 0xc3 frame magic', async () => {
    // Upstream scanned the payload for the frame magic and threw away a frame
    // the length prefix had already delimited, rewinding into the middle of it
    // and desyncing the stream (patched in @jsr/meshtastic__core@2.6.6).
    //
    // These two bytes occur naturally in binary fields. A real NodeInfo on the
    // reporting mesh — !db2b2424 "KF4PMY-Home" — carried them inside its 32-byte
    // public key, so that node was undecodable on every reconnect and took the
    // whole session down with it: configure, malformed, disconnect, repeat.
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();

    const payload = new Uint8Array([0x01, 0x02, 0x94, 0xc3, 0x03, 0x04]);
    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, payload.length, ...payload]));

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: payload });
    reader.releaseLock();
  });

  it('stays in sync on the frame after a payload containing the frame magic', async () => {
    // The damage was not just the lost frame: the rewind left the parser
    // misaligned, so everything after it decoded as garbage too.
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();

    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 3, 0x94, 0xc3, 0x07]));
    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 2, 0xde, 0xad]));

    expect((await reader.read()).value).toEqual({
      type: 'packet',
      data: new Uint8Array([0x94, 0xc3, 0x07]),
    });
    expect((await reader.read()).value).toEqual({
      type: 'packet',
      data: new Uint8Array([0xde, 0xad]),
    });
    reader.releaseLock();
  });

  it('reassembles a message split across two onData calls', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();

    onDataCallback?.(new Uint8Array([0x94, 0xc3, 0, 3, 0x01]));
    onDataCallback?.(new Uint8Array([0x02, 0x03]));

    const { value } = await reader.read();
    expect(value).toEqual({ type: 'packet', data: new Uint8Array([0x01, 0x02, 0x03]) });
    reader.releaseLock();
  });

  it('onDisconnected closes the fromDevice stream', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const reader = transport.fromDevice.getReader();
    expect(onDisconnectedCallback).not.toBeNull();

    onDisconnectedCallback?.();

    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it('toDevice.write rejects when meshtastic tcp-write has no active socket', async () => {
    vi.mocked(window.electronAPI.meshtastic.tcp.write).mockRejectedValueOnce(
      new Error('meshtastic:tcp-write: no active socket'),
    );
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    const writer = transport.toDevice.getWriter();
    await expect(writer.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      'meshtastic:tcp-write: no active socket',
    );
    expect(window.electronAPI.meshtastic.tcp.write).toHaveBeenCalledTimes(1);
    writer.releaseLock();
  });

  it('disconnect() calls the IPC disconnect and is safe to call twice', async () => {
    const transport = new TransportTcpIpc('192.168.200.4', 4403);
    await transport.disconnect();
    await transport.disconnect();
    expect(window.electronAPI.meshtastic.tcp.disconnect).toHaveBeenCalledTimes(2);
  });
});
