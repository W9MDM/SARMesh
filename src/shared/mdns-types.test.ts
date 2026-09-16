import { describe, expect, it } from 'vitest';

import { MESHTASTIC_TCP_PORT, nodeIdToNum } from './mdns-types';

describe('nodeIdToNum', () => {
  it('parses the firmware `id` TXT record form', () => {
    expect(nodeIdToNum('!a1b2c3d4')).toBe(0xa1b2c3d4);
  });

  it('accepts bare hex and short ids', () => {
    expect(nodeIdToNum('a1b2c3d4')).toBe(0xa1b2c3d4);
    expect(nodeIdToNum('!ff')).toBe(0xff);
  });

  it('keeps high node numbers unsigned', () => {
    // A node id with the top bit set must not come back negative, or it will
    // never match the register, which stores unsigned node numbers.
    expect(nodeIdToNum('!ffffffff')).toBe(0xffffffff);
    expect(nodeIdToNum('!ffffffff')).toBeGreaterThan(0);
  });

  it('returns undefined for missing or malformed ids', () => {
    expect(nodeIdToNum(undefined)).toBeUndefined();
    expect(nodeIdToNum('')).toBeUndefined();
    expect(nodeIdToNum('!nothex')).toBeUndefined();
    expect(nodeIdToNum('!a1b2c3d4e5')).toBeUndefined();
  });

  it('tolerates surrounding whitespace from the TXT record', () => {
    expect(nodeIdToNum('  !a1b2c3d4 ')).toBe(0xa1b2c3d4);
  });
});

describe('MESHTASTIC_TCP_PORT', () => {
  it('matches the firmware SERVER_API_DEFAULT_PORT', () => {
    expect(MESHTASTIC_TCP_PORT).toBe(4403);
  });
});
