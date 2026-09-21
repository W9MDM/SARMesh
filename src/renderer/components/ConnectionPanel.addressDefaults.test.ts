import { describe, expect, it } from 'vitest';

import { defaultIpAddressForTransport } from './ConnectionPanel';

describe('defaultIpAddressForTransport', () => {
  it('carries an HTTP host over to the TCP field with the API port', () => {
    // The field failure: connected over HTTP at 192.168.50.105, clicked
    // WiFi/TCP, and the field fell back to meshtastic.local:4403.
    expect(
      defaultIpAddressForTransport({ type: 'http', httpAddress: '192.168.50.105' }, 'tcp'),
    ).toBe('192.168.50.105:4403');
  });

  it('carries a TCP host back to the HTTP field without the API port', () => {
    expect(
      defaultIpAddressForTransport({ type: 'tcp', httpAddress: '192.168.50.105:4403' }, 'http'),
    ).toBe('192.168.50.105');
  });

  it('keeps the same host when the transport does not change', () => {
    expect(
      defaultIpAddressForTransport({ type: 'tcp', httpAddress: '192.168.50.105:4403' }, 'tcp'),
    ).toBe('192.168.50.105:4403');
    expect(
      defaultIpAddressForTransport({ type: 'http', httpAddress: '192.168.50.105' }, 'http'),
    ).toBe('192.168.50.105');
  });

  it('replaces a non-default saved port with the TCP API port', () => {
    expect(
      defaultIpAddressForTransport({ type: 'http', httpAddress: '192.168.50.105:8080' }, 'tcp'),
    ).toBe('192.168.50.105:4403');
  });

  it('falls back to meshtastic.local only when nothing has been connected', () => {
    expect(defaultIpAddressForTransport(null, 'http')).toBe('meshtastic.local');
    expect(defaultIpAddressForTransport(null, 'tcp')).toBe('meshtastic.local:4403');
    expect(defaultIpAddressForTransport(undefined, 'tcp')).toBe('meshtastic.local:4403');
  });

  it('ignores a saved non-IP transport', () => {
    // A BLE or serial last-connection has no host to carry over.
    expect(defaultIpAddressForTransport({ type: 'ble', httpAddress: '' }, 'tcp')).toBe(
      'meshtastic.local:4403',
    );
    expect(defaultIpAddressForTransport({ type: 'serial' }, 'http')).toBe('meshtastic.local');
  });

  it('ignores a blank saved address', () => {
    expect(defaultIpAddressForTransport({ type: 'http', httpAddress: '   ' }, 'tcp')).toBe(
      'meshtastic.local:4403',
    );
  });

  it('preserves a hostname the user actually saved', () => {
    expect(defaultIpAddressForTransport({ type: 'http', httpAddress: 'radio.lan' }, 'tcp')).toBe(
      'radio.lan:4403',
    );
  });
});
