import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InventoryProfile, NodeConfigSnapshot } from '../shared/inventory-types';

let dir: string;

// The manager resolves its file from app.getPath('userData').
vi.mock('electron', () => ({
  app: { getPath: () => dir },
}));

const { InventoryManager, computeDrift } = await import('./inventory-manager');

describe('InventoryManager', () => {
  let manager: InstanceType<typeof InventoryManager>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sarmesh-inventory-'));
    manager = new InventoryManager();
    manager.load();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('register', () => {
    it('records a new radio as needing config, with an audit entry', () => {
      const node = manager.register(0x1234, { assetTag: 'SAR-014' });
      expect(node.status).toBe('needs-config');
      expect(node.history[0]?.kind).toBe('registered');
      expect(node.history[0]?.detail).toContain('SAR-014');
    });

    it('is idempotent, so reconnecting a radio does not duplicate it', () => {
      manager.register(7, { assetTag: 'A' });
      const again = manager.register(7, { assetTag: 'B' });
      expect(again.assetTag).toBe('A');
      expect(manager.list()).toHaveLength(1);
    });
  });

  describe('retained configuration', () => {
    const snapshot: NodeConfigSnapshot = {
      capturedAt: 0,
      firmwareVersion: '2.7.26',
      owner: { longName: 'Team One', shortName: 'T1' },
      lora: { region: 'US', modemPreset: 'LONG_FAST' },
      channels: [
        {
          index: 0,
          name: 'SAR',
          psk: 'AQ==',
          role: 'PRIMARY',
          uplinkEnabled: false,
          downlinkEnabled: false,
        },
      ],
    };

    it('survives a reload, so a radio can be reviewed while it is in a cache', () => {
      manager.register(42);
      manager.recordSnapshot(42, snapshot);

      const reloaded = new InventoryManager();
      reloaded.load();
      const node = reloaded.get(42);
      expect(node?.lastKnownConfig?.owner?.longName).toBe('Team One');
      expect(node?.firmwareVersion).toBe('2.7.26');
    });

    it('summarises the read in the audit trail', () => {
      const node = manager.recordSnapshot(42, snapshot);
      const entry = node.history.find((h) => h.kind === 'config-read');
      expect(entry?.detail).toContain('region=US');
      expect(entry?.detail).toContain('channels=1');
    });
  });

  describe('the queue', () => {
    it('queues one change across many radios in a single call', () => {
      const nodes = manager.queueChangeForMany([1, 2, 3], 'Season config', {
        lora: { region: 'US' },
      });
      expect(nodes).toHaveLength(3);
      expect(manager.outstandingChanges(2)).toHaveLength(1);
      expect(manager.nodesAwaitingConfig()).toHaveLength(3);
    });

    it('does not report cancelled changes as outstanding', () => {
      const change = manager.queueChange(1, 'x', {});
      manager.cancelChange(1, change.id);
      expect(manager.outstandingChanges(1)).toHaveLength(0);
    });

    it('returns a radio to service once its queue is drained', () => {
      const change = manager.queueChange(1, 'Set region', { lora: { region: 'US' } });
      expect(manager.get(1)?.status).toBe('needs-config');

      manager.markChangeState(1, change.id, 'applied');
      const node = manager.get(1);
      expect(node?.status).toBe('in-service');
      expect(node?.lastConfiguredAt).toBeGreaterThan(0);
      expect(node?.history.some((h) => h.kind === 'config-applied')).toBe(true);
    });

    it('keeps a failure in the trail and leaves the radio needing config', () => {
      const change = manager.queueChange(1, 'Set region', {});
      manager.markChangeState(1, change.id, 'failed', 'transport closed');

      const node = manager.get(1);
      expect(node?.status).toBe('needs-config');
      expect(node?.pendingChanges[0]?.error).toBe('transport closed');
      expect(node?.history.some((h) => h.detail.includes('transport closed'))).toBe(true);
    });

    it('survives a restart, which is the whole point of queueing', () => {
      manager.queueChange(99, 'Apply later', { device: { role: 'CLIENT' } });

      const reloaded = new InventoryManager();
      reloaded.load();
      const pending = reloaded.outstandingChanges(99);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.config.device?.role).toBe('CLIENT');
    });
  });

  it('records status and assignment changes in the trail', () => {
    manager.register(5);
    manager.update(5, { assignedTo: 'Alpha Team' });
    manager.setStatus(5, 'deployed');

    const node = manager.get(5);
    expect(node?.history.some((h) => h.detail.includes('Alpha Team'))).toBe(true);
    expect(node?.history.some((h) => h.detail.includes('deployed'))).toBe(true);
  });
});

describe('computeDrift', () => {
  const profile: InventoryProfile = {
    id: 'p1',
    name: 'County SAR',
    updatedAt: 0,
    config: {
      lora: { region: 'US', modemPreset: 'LONG_FAST' },
      channels: [
        {
          index: 0,
          name: 'SAR',
          psk: 'AQ==',
          role: 'PRIMARY',
          uplinkEnabled: false,
          downlinkEnabled: false,
        },
      ],
    },
  };

  it('reports a radio still on last season config', () => {
    const drift = computeDrift(
      {
        capturedAt: 0,
        lora: { region: 'US', modemPreset: 'MEDIUM_FAST' },
        channels: [
          {
            index: 0,
            name: 'OLD',
            psk: 'Ag==',
            role: 'PRIMARY',
            uplinkEnabled: false,
            downlinkEnabled: false,
          },
        ],
      },
      profile,
    );
    const fields = drift.map((d) => d.field);
    expect(fields).toContain('lora.modemPreset');
    expect(fields).toContain('channel[0].name');
    expect(fields).toContain('channel[0].psk');
    expect(fields).not.toContain('lora.region');
  });

  it('never reveals a PSK, only that it differs', () => {
    const drift = computeDrift(
      {
        capturedAt: 0,
        channels: [
          {
            index: 0,
            name: 'SAR',
            psk: 'c3VwZXJzZWNyZXQ=',
            role: 'PRIMARY',
            uplinkEnabled: false,
            downlinkEnabled: false,
          },
        ],
      },
      profile,
    );
    const psk = drift.find((d) => d.field === 'channel[0].psk');
    expect(psk).toBeDefined();
    expect(psk?.desired).toBe('(set)');
    expect(psk?.actual).toBe('(different)');
    expect(JSON.stringify(drift)).not.toContain('supersecret');
  });

  it('is empty when the radio already matches', () => {
    expect(computeDrift({ capturedAt: 0, ...profile.config }, profile)).toEqual([]);
  });

  it('returns nothing rather than throwing when either side is missing', () => {
    expect(computeDrift(undefined, profile)).toEqual([]);
    expect(computeDrift({ capturedAt: 0 }, undefined)).toEqual([]);
  });
});
