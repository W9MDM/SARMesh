import { describe, expect, it } from 'vitest';

import {
  clampRetentionHours,
  PACKET_MONITOR_DEFAULT_HOURS,
  PACKET_MONITOR_MAX_HEX_BYTES,
  PACKET_MONITOR_MAX_HOURS,
  PACKET_MONITOR_MIN_HOURS,
  rawFrameToStoredHex,
  retentionCutoffMs,
} from './packet-monitor-types';

describe('clampRetentionHours', () => {
  it('keeps a value inside the supported range', () => {
    expect(clampRetentionHours(12)).toBe(12);
    expect(clampRetentionHours(PACKET_MONITOR_MIN_HOURS)).toBe(PACKET_MONITOR_MIN_HOURS);
    expect(clampRetentionHours(PACKET_MONITOR_MAX_HOURS)).toBe(PACKET_MONITOR_MAX_HOURS);
  });

  it('clamps rather than accepting an absurd window', () => {
    // A packet log is written continuously; an unbounded window fills a disk.
    expect(clampRetentionHours(0)).toBe(PACKET_MONITOR_MIN_HOURS);
    expect(clampRetentionHours(-5)).toBe(PACKET_MONITOR_MIN_HOURS);
    expect(clampRetentionHours(100_000)).toBe(PACKET_MONITOR_MAX_HOURS);
  });

  it('falls back to the default for a non-number', () => {
    expect(clampRetentionHours(Number.NaN)).toBe(PACKET_MONITOR_DEFAULT_HOURS);
    expect(clampRetentionHours(Number.POSITIVE_INFINITY)).toBe(PACKET_MONITOR_DEFAULT_HOURS);
  });

  it('rounds fractional hours', () => {
    expect(clampRetentionHours(2.4)).toBe(2);
    expect(clampRetentionHours(2.6)).toBe(3);
  });
});

describe('retentionCutoffMs', () => {
  const NOW = 1_700_000_000_000;

  it('is exactly N hours before now', () => {
    expect(retentionCutoffMs(1, NOW)).toBe(NOW - 3_600_000);
    expect(retentionCutoffMs(12, NOW)).toBe(NOW - 12 * 3_600_000);
  });

  it('uses the clamped window, so a bad setting cannot widen retention', () => {
    expect(retentionCutoffMs(100_000, NOW)).toBe(NOW - PACKET_MONITOR_MAX_HOURS * 3_600_000);
    expect(retentionCutoffMs(0, NOW)).toBe(NOW - PACKET_MONITOR_MIN_HOURS * 3_600_000);
  });

  it('a packet exactly on the boundary is kept', () => {
    const cutoff = retentionCutoffMs(6, NOW);
    expect(cutoff).toBeLessThanOrEqual(NOW - 6 * 3_600_000);
    // prune deletes strictly older than the cutoff
    expect(cutoff < NOW).toBe(true);
  });
});

describe('rawFrameToStoredHex', () => {
  it('encodes bytes as lowercase hex', () => {
    expect(rawFrameToStoredHex(new Uint8Array([0x0d, 0xec, 0x16, 0x35]))).toBe('0dec1635');
  });

  it('pads single-digit bytes', () => {
    expect(rawFrameToStoredHex(new Uint8Array([0x00, 0x01, 0x0f]))).toBe('00010f');
  });

  it('truncates long frames so message bodies are not archived wholesale', () => {
    const long = new Uint8Array(500).fill(0xab);
    const hex = rawFrameToStoredHex(long);
    expect(hex).toHaveLength(PACKET_MONITOR_MAX_HEX_BYTES * 2);
  });

  it('honours an explicit cap', () => {
    const raw = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(rawFrameToStoredHex(raw, 3)).toBe('010203');
  });

  it('returns undefined for an empty or missing frame', () => {
    expect(rawFrameToStoredHex(undefined)).toBeUndefined();
    expect(rawFrameToStoredHex(new Uint8Array(0))).toBeUndefined();
  });
});
