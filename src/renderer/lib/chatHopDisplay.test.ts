import { describe, expect, it } from 'vitest';

import { resolveChatHopDisplay } from './chatHopDisplay';

describe('resolveChatHopDisplay', () => {
  it('prefers the packet figure and reports it as exact', () => {
    expect(resolveChatHopDisplay(3, 5)).toEqual({ hops: 3, approximate: false });
  });

  it('keeps a genuine zero-hop receive rather than falling through', () => {
    // 0 is a direct neighbour, not "unknown" — a falsy check here would have
    // discarded the most certain reading there is.
    expect(resolveChatHopDisplay(0, 4)).toEqual({ hops: 0, approximate: false });
  });

  it('falls back to the sender distance, flagged approximate', () => {
    // Most traffic lands here: only firmware 2.3.0+ fills in hop_start, so
    // roughly seven in eight stored messages carry no hop count of their own.
    expect(resolveChatHopDisplay(undefined, 2)).toEqual({ hops: 2, approximate: true });
    expect(resolveChatHopDisplay(null, 0)).toEqual({ hops: 0, approximate: true });
  });

  it('returns null when neither source knows', () => {
    expect(resolveChatHopDisplay(undefined, undefined)).toBeNull();
    expect(resolveChatHopDisplay(null, null)).toBeNull();
  });

  it('treats a negative or non-finite count as unknown', () => {
    // hopLimit > hopStart means the fields disagreed; do not render "-1 hops".
    expect(resolveChatHopDisplay(-1, undefined)).toBeNull();
    expect(resolveChatHopDisplay(-1, 3)).toEqual({ hops: 3, approximate: true });
    expect(resolveChatHopDisplay(Number.NaN, undefined)).toBeNull();
    expect(resolveChatHopDisplay(Number.POSITIVE_INFINITY, undefined)).toBeNull();
  });

  it('truncates a fractional count', () => {
    expect(resolveChatHopDisplay(2.9, undefined)).toEqual({ hops: 2, approximate: false });
  });
});
