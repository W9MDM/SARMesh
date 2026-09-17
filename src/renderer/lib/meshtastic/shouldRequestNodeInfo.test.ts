import { describe, expect, it } from 'vitest';

import type { MeshNode } from '../types';
import { shouldRequestNodeInfo } from './shouldRequestNodeInfo';

const PEER = 0x9e6932e9;
const ME = 0x11111111;
const MIN_INTERVAL = 120_000;
const NOW = 1_700_000_000_000;

function node(overrides: Partial<MeshNode> = {}): MeshNode {
  return { node_id: PEER, ...overrides } as MeshNode;
}

function base(overrides: Partial<Parameters<typeof shouldRequestNodeInfo>[0]> = {}) {
  return {
    nodeNum: PEER,
    existing: undefined,
    myNodeNum: ME,
    isConfiguring: false,
    lastRequestAtMs: undefined,
    nowMs: NOW,
    minIntervalMs: MIN_INTERVAL,
    ...overrides,
  };
}

describe('shouldRequestNodeInfo', () => {
  it('asks about a node we have never seen before', () => {
    expect(shouldRequestNodeInfo(base())).toBe(true);
  });

  it('asks about a node with no name yet', () => {
    expect(shouldRequestNodeInfo(base({ existing: node({ long_name: '' }) }))).toBe(true);
  });

  it('asks about a node whose long name is only the !id placeholder', () => {
    expect(shouldRequestNodeInfo(base({ existing: node({ long_name: '!9e6932e9' }) }))).toBe(true);
  });

  it('does not ask about a node we can already name', () => {
    expect(shouldRequestNodeInfo(base({ existing: node({ long_name: 'Base Camp' }) }))).toBe(false);
  });

  it('never asks itself or node 0', () => {
    expect(shouldRequestNodeInfo(base({ nodeNum: ME }))).toBe(false);
    expect(shouldRequestNodeInfo(base({ nodeNum: 0 }))).toBe(false);
  });

  it('stays quiet while the radio is still configuring', () => {
    expect(shouldRequestNodeInfo(base({ isConfiguring: true }))).toBe(false);
  });

  it('respects the per-node rate limit', () => {
    expect(shouldRequestNodeInfo(base({ lastRequestAtMs: NOW - 1000 }))).toBe(false);
    expect(shouldRequestNodeInfo(base({ lastRequestAtMs: NOW - MIN_INTERVAL }))).toBe(true);
  });

  // The airtime case: a distant MQTT node cannot hear us, so asking is pure cost
  // on a shared LoRa channel.
  it('does not transmit at a node heard only through MQTT', () => {
    expect(
      shouldRequestNodeInfo(base({ existing: node({ heard_via_mqtt_only: true, long_name: '' }) })),
    ).toBe(false);
  });

  it('still asks a node that has been heard over RF as well as MQTT', () => {
    expect(
      shouldRequestNodeInfo(
        base({
          existing: node({ heard_via_mqtt_only: false, heard_via_mqtt: true, long_name: '' }),
        }),
      ),
    ).toBe(true);
  });

  it('keeps the MQTT rule even during missing-key recovery', () => {
    // ignoreDisplayIdentity re-asks a node we can name; it must not become a
    // loophole that puts requests on the air for unreachable nodes.
    expect(
      shouldRequestNodeInfo(
        base({
          existing: node({ heard_via_mqtt_only: true, long_name: 'Chicago Relay' }),
          ignoreDisplayIdentity: true,
        }),
      ),
    ).toBe(false);
  });

  it('re-asks a named RF node during missing-key recovery', () => {
    expect(
      shouldRequestNodeInfo(
        base({ existing: node({ long_name: 'Base Camp' }), ignoreDisplayIdentity: true }),
      ),
    ).toBe(true);
  });

  it('applies the rate limit during missing-key recovery too', () => {
    expect(
      shouldRequestNodeInfo(
        base({
          existing: node({ long_name: 'Base Camp' }),
          ignoreDisplayIdentity: true,
          lastRequestAtMs: NOW - 1000,
        }),
      ),
    ).toBe(false);
  });
});
