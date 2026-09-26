import { describe, expect, it } from 'vitest';

import {
  RF_MAX_RECONNECT_ATTEMPTS,
  RF_MAX_RECONNECT_ATTEMPTS_BLE,
  RF_MAX_RECONNECT_ATTEMPTS_NETWORK,
  RF_MAX_RECONNECT_ATTEMPTS_SERIAL,
  rfMaxReconnectAttemptsForTransport,
} from './rfReconnectShared';

describe('rfMaxReconnectAttemptsForTransport', () => {
  it.each([null, undefined, 'other'] as const)('uses default budget for %s', (transport) => {
    expect(rfMaxReconnectAttemptsForTransport(transport)).toBe(RF_MAX_RECONNECT_ATTEMPTS);
  });

  it.each(['tcp', 'http', 'network'] as const)('never gives up on %s', (transport) => {
    // A networked node is a fixed host that comes back. The old five-attempt
    // budget expired after about a minute — less than a Meshtastic reboot —
    // so the app latched off shortly before the radio returned and stayed
    // disconnected until someone noticed.
    expect(rfMaxReconnectAttemptsForTransport(transport)).toBe(RF_MAX_RECONNECT_ATTEMPTS_NETWORK);
    expect(Number.isFinite(rfMaxReconnectAttemptsForTransport(transport))).toBe(false);
  });

  it('uses a longer budget for BLE and serial', () => {
    expect(rfMaxReconnectAttemptsForTransport('ble')).toBe(RF_MAX_RECONNECT_ATTEMPTS_BLE);
    expect(rfMaxReconnectAttemptsForTransport('serial')).toBe(RF_MAX_RECONNECT_ATTEMPTS_SERIAL);
    expect(RF_MAX_RECONNECT_ATTEMPTS_BLE).toBeGreaterThan(RF_MAX_RECONNECT_ATTEMPTS);
    expect(RF_MAX_RECONNECT_ATTEMPTS_SERIAL).toBeGreaterThan(RF_MAX_RECONNECT_ATTEMPTS);
  });
});
