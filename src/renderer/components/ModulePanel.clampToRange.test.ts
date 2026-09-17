import { describe, expect, it } from 'vitest';

import { clampToRange } from './ModulePanel';

describe('clampToRange', () => {
  it('leaves an in-range value alone', () => {
    expect(clampToRange(1800, 0, 86400)).toBe(1800);
    expect(clampToRange(0, 0, 86400)).toBe(0);
    expect(clampToRange(86400, 0, 86400)).toBe(86400);
  });

  it('clamps the INT32_MAX a radio can report for a telemetry interval', () => {
    // A 2147483647-second interval is not a setting; writing it back to a radio
    // would persist a value that governs airtime.
    expect(clampToRange(2147483647, 0, 86400)).toBe(86400);
  });

  it('clamps below the minimum', () => {
    expect(clampToRange(-5, 0, 86400)).toBe(0);
  });

  it('honours a single bound', () => {
    expect(clampToRange(50, 100, undefined)).toBe(100);
    expect(clampToRange(500, undefined, 100)).toBe(100);
  });

  it('passes through when no bounds are declared', () => {
    expect(clampToRange(2147483647, undefined, undefined)).toBe(2147483647);
  });
});
