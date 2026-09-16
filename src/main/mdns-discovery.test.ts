import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscoveryState } from '../shared/mdns-types';

/** Stand-in for bonjour-service's Browser. */
class FakeBrowser extends EventEmitter {
  stop = vi.fn();
  update = vi.fn();
}

const state = {
  browser: null as FakeBrowser | null,
  onUp: null as ((service: unknown) => void) | null,
  find: vi.fn(),
  destroy: vi.fn(),
  throwOnConstruct: null as Error | null,
};

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    constructor() {
      if (state.throwOnConstruct) throw state.throwOnConstruct;
    }
    find(_opts: unknown, onUp: (service: unknown) => void) {
      state.onUp = onUp;
      state.browser = new FakeBrowser();
      state.find(_opts);
      return state.browser;
    }
    destroy() {
      state.destroy();
    }
  },
}));

vi.mock('./log-service', () => ({ sanitizeLogMessage: (s: string) => s }));

const { MdnsDiscovery } = await import('./mdns-discovery');

function service(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Meshtastic-c3d4',
    host: 'Meshtastic-c3d4.local',
    port: 4403,
    addresses: ['fe80::1', '192.168.20.41'],
    txt: { shortname: 'ALFA', id: '!a1b2c3d4', pio_env: 'tbeam' },
    ...overrides,
  };
}

describe('MdnsDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.browser = null;
    state.onUp = null;
    state.throwOnConstruct = null;
    state.find.mockClear();
    state.destroy.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('browses _meshtastic._tcp and maps the TXT records the firmware sends', () => {
    const d = new MdnsDiscovery();
    d.start();
    expect(state.find).toHaveBeenCalledWith({ type: 'meshtastic', protocol: 'tcp' });

    state.onUp?.(service());
    const [node] = d.getState().nodes;
    expect(node).toMatchObject({
      host: '192.168.20.41', // IPv4 preferred: not every build answers on v6
      port: 4403,
      instance: 'Meshtastic-c3d4',
      hostname: 'Meshtastic-c3d4.local',
      nodeId: '!a1b2c3d4',
      nodeNum: 0xa1b2c3d4,
      shortName: 'ALFA',
      hardware: 'tbeam',
    });
    d.stop();
  });

  it('decodes TXT values that arrive as Buffers', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(
      service({ txt: { shortname: Buffer.from('BRVO'), id: Buffer.from('!000000ff') } }),
    );
    expect(d.getState().nodes[0]).toMatchObject({ shortName: 'BRVO', nodeNum: 0xff });
    d.stop();
  });

  it('keeps a node without TXT records — older firmware still advertises', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(service({ txt: undefined }));
    const [node] = d.getState().nodes;
    expect(node.shortName).toBeUndefined();
    expect(node.nodeNum).toBeUndefined();
    expect(node.host).toBe('192.168.20.41');
    d.stop();
  });

  it('ignores an announcement with no usable address', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(service({ addresses: [] }));
    expect(d.getState().nodes).toHaveLength(0);
    d.stop();
  });

  it('replaces rather than duplicates a node that re-announces', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(service());
    state.onUp?.(service({ addresses: ['192.168.20.77'] }));
    expect(d.getState().nodes).toHaveLength(1);
    expect(d.getState().nodes[0].host).toBe('192.168.20.77');
    d.stop();
  });

  it('drops a node that stops announcing', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(service());
    state.browser?.emit('down', { name: 'Meshtastic-c3d4' });
    expect(d.getState().nodes).toHaveLength(0);
    d.stop();
  });

  it('prunes a node that simply vanished from the link', () => {
    const d = new MdnsDiscovery();
    d.start();
    state.onUp?.(service());
    expect(d.getState().nodes).toHaveLength(1);

    vi.advanceTimersByTime(6 * 60 * 1000);
    expect(d.getState().nodes).toHaveLength(0);
    d.stop();
  });

  it('emits state so the renderer sees a radio appear', () => {
    const d = new MdnsDiscovery();
    const seen: DiscoveryState[] = [];
    d.on('state', (s: DiscoveryState) => seen.push(s));
    d.start();
    state.onUp?.(service());
    expect(seen.at(-1)?.nodes).toHaveLength(1);
    expect(seen.at(-1)?.browsing).toBe(true);
    d.stop();
  });

  it('reports a blocked socket instead of showing an empty list forever', () => {
    state.throwOnConstruct = new Error('EACCES: permission denied');
    const d = new MdnsDiscovery();
    const result = d.start();
    expect(result.browsing).toBe(false);
    expect(result.error).toContain('EACCES');
  });

  it('is idempotent — a second start does not open a second socket', () => {
    const d = new MdnsDiscovery();
    d.start();
    d.start();
    expect(state.find).toHaveBeenCalledTimes(1);
    d.stop();
  });

  it('tears the browse down and stops sweeping on stop', () => {
    const d = new MdnsDiscovery();
    d.start();
    const browser = state.browser;
    const result = d.stop();
    expect(browser?.stop).toHaveBeenCalled();
    expect(state.destroy).toHaveBeenCalled();
    expect(result.browsing).toBe(false);
    // The prune timer must be cleared, or it keeps the process awake.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-queries the link on refresh', () => {
    const d = new MdnsDiscovery();
    d.start();
    d.refresh();
    expect(state.browser?.update).toHaveBeenCalled();
    d.stop();
  });
});
