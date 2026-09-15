import { useEffect, useRef } from 'react';

import type { ReconcileResult } from '@/shared/inventory-types';

import {
  type ApplyActions,
  applyInventoryConfig,
  type CurrentOwner,
} from '../lib/inventory/applyInventoryConfig';
import { type DeviceChannel, snapshotFromDevice } from '../lib/inventory/snapshotFromDevice';

/**
 * Drains a radio's queued configuration when it connects.
 *
 * This is the wire that makes queueing worth anything: a leader queues a change
 * while the radio is in a cache, and it lands the next time the radio is
 * plugged in — without anyone remembering to go and apply it.
 *
 * It also captures a snapshot on every connect, so the register's "retained
 * configuration" fills itself in rather than depending on someone pressing a
 * button.
 */
export interface UseInventoryAutoApplyOptions {
  /** Runtime status; work happens once the radio reaches `configured`. */
  status: string;
  /** The attached radio's own node number. */
  myNodeNum: number | undefined;
  configSlices: Record<string, unknown> | undefined;
  channels: DeviceChannel[] | undefined;
  firmwareVersion?: string;
  ownerLongName?: string;
  ownerShortName?: string;
  /** The radio's current owner record, merged onto by partial owner changes. */
  currentOwner?: CurrentOwner;
  actions: Partial<ApplyActions>;
}

export function useInventoryAutoApply(options: UseInventoryAutoApplyOptions): void {
  // Only these two drive the effect; everything else is read through `latest`
  // at the moment of use, so a late-arriving config slice cannot re-trigger it.
  const { status, myNodeNum } = options;

  /**
   * The node this hook has already serviced on the current connection. Cleared
   * on disconnect so the next connect runs again, but held while connected so a
   * re-render — or a config slice arriving late — cannot re-apply a change or
   * reboot the radio twice.
   */
  const servicedRef = useRef<number | null>(null);
  /** Guards against a second pass starting while the first is still writing. */
  const runningRef = useRef(false);

  // Keep the latest inputs without making them effect dependencies: the effect
  // must fire on connect, not every time a slice updates. Synced in an effect
  // rather than during render, and declared before the connect effect so it is
  // already current when that one runs.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    if (status !== 'configured' && status !== 'connected') {
      servicedRef.current = null;
      return;
    }
    if (myNodeNum === undefined || servicedRef.current === myNodeNum) return;
    if (runningRef.current) return;

    servicedRef.current = myNodeNum;
    runningRef.current = true;

    void (async () => {
      const api = window.electronAPI.inventory;
      const nodeId = myNodeNum;
      try {
        // Register on first sight so a radio a leader plugs in is never
        // silently untracked.
        await api.register(nodeId, {});

        const current = latest.current;
        await api.recordSnapshot(
          nodeId,
          snapshotFromDevice({
            configSlices: current.configSlices,
            channels: current.channels,
            firmwareVersion: current.firmwareVersion,
            ownerLongName: current.ownerLongName,
            ownerShortName: current.ownerShortName,
          }),
        );

        const settings = await api.getSettings();
        if (!settings.autoApplyOnConnect) return;

        const pending = await api.pendingFor(nodeId);
        if (pending.length === 0) return;

        const { setConfig, setDeviceChannel, setOwner, commitConfig } = latest.current.actions;
        if (!setConfig || !setDeviceChannel || !setOwner || !commitConfig) {
          console.warn('[inventory] radio connected but config actions are unavailable');
          return;
        }

        const result: ReconcileResult = {
          nodeId,
          applied: [],
          failed: [],
          rebooted: false,
        };

        for (const change of pending) {
          await api.markChangeState(nodeId, change.id, 'applying');
          const outcome = await applyInventoryConfig(
            change.config,
            latest.current.configSlices,
            { setConfig, setDeviceChannel, setOwner, commitConfig },
            latest.current.currentOwner,
          );

          if (outcome.rebooted) result.rebooted = true;

          if (outcome.ok) {
            await api.markChangeState(nodeId, change.id, 'applied');
            result.applied.push(change.label);
          } else {
            const error = outcome.steps.find((step) => !step.ok)?.error ?? 'Unknown failure';
            await api.markChangeState(nodeId, change.id, 'failed', error);
            result.failed.push({ label: change.label, error });
            // Stop rather than pushing the rest at a radio that is mid-reboot
            // or whose link has already gone.
            break;
          }
        }

        await api.recordReconcile(result);
      } catch (err) {
        console.error(
          '[inventory] applying queued config failed:',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        runningRef.current = false;
      }
    })();
    // Only the connect transition should trigger this; everything else is read
    // through `latest` so a late-arriving config slice does not re-run it.
  }, [status, myNodeNum]);
}
