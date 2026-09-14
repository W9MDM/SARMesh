import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AprsBridgeStatus,
  AprsEmitRecord,
  AprsSettings,
  AprsTrackedClient,
} from '@/shared/aprs-types';
import { DEFAULT_APRS_SETTINGS, IDLE_APRS_STATUS } from '@/shared/aprs-types';

/** Newest beacons kept in the panel; the main process keeps a longer history. */
const RECENT_LIMIT = 100;

export interface UseAprsBridgeResult {
  status: AprsBridgeStatus;
  settings: AprsSettings;
  roster: AprsTrackedClient[];
  recent: AprsEmitRecord[];
  error: string | null;
  busy: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  saveSettings: (next: AprsSettings) => Promise<void>;
  upsertClient: (client: AprsTrackedClient) => Promise<void>;
  removeClient: (nodeId: number) => Promise<void>;
  sendTestBeacon: (callsign: string, latitude: number, longitude: number) => Promise<void>;
}

/**
 * Owns the renderer's view of the APRS bridge. The main process is the source
 * of truth; this mirrors it and re-reads on every push.
 */
export function useAprsBridge(): UseAprsBridgeResult {
  const [status, setStatus] = useState<AprsBridgeStatus>(IDLE_APRS_STATUS);
  const [settings, setSettings] = useState<AprsSettings>(DEFAULT_APRS_SETTINGS);
  const [roster, setRoster] = useState<AprsTrackedClient[]>([]);
  const [recent, setRecent] = useState<AprsEmitRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const api = window.electronAPI.aprs;

    void (async () => {
      try {
        const [s, cfg, r, rec] = await Promise.all([
          api.getStatus(),
          api.getSettings(),
          api.getRoster(),
          api.getRecent(RECENT_LIMIT),
        ]);
        if (!mounted.current) return;
        setStatus(s);
        setSettings(cfg);
        setRoster(r);
        setRecent(rec);
      } catch (err) {
        // catch-no-log-ok: surfaced to the operator as the panel's error banner
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    const unsubStatus = api.onStatus((next) => {
      if (mounted.current) setStatus(next);
    });
    const unsubEmitted = api.onEmitted((record) => {
      if (!mounted.current) return;
      setRecent((prev) => [record, ...prev].slice(0, RECENT_LIMIT));
    });

    return () => {
      mounted.current = false;
      unsubStatus();
      unsubEmitted();
    };
  }, []);

  /** Run an API call, surfacing failures instead of leaving the UI silent. */
  const run = useCallback(async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      // catch-no-log-ok: surfaced to the operator as the panel's error banner
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const start = useCallback(
    () =>
      run(async () => {
        const api = window.electronAPI.aprs;
        await api.start({ ...settings, enabled: true });
        if (mounted.current) setStatus(await api.getStatus());
      }),
    [run, settings],
  );

  const stop = useCallback(
    () =>
      run(async () => {
        const api = window.electronAPI.aprs;
        await api.stop();
        if (mounted.current) setStatus(await api.getStatus());
      }),
    [run],
  );

  const saveSettings = useCallback(
    (next: AprsSettings) =>
      run(async () => {
        await window.electronAPI.aprs.saveSettings(next);
        if (mounted.current) setSettings(next);
      }),
    [run],
  );

  const upsertClient = useCallback(
    (client: AprsTrackedClient) =>
      run(async () => {
        const next = await window.electronAPI.aprs.upsertTrackedClient(client);
        if (mounted.current) setRoster(next);
      }),
    [run],
  );

  const removeClient = useCallback(
    (nodeId: number) =>
      run(async () => {
        const next = await window.electronAPI.aprs.removeTrackedClient(nodeId);
        if (mounted.current) setRoster(next);
      }),
    [run],
  );

  const sendTestBeacon = useCallback(
    (callsign: string, latitude: number, longitude: number) =>
      run(async () => {
        await window.electronAPI.aprs.sendTestBeacon(callsign, latitude, longitude);
      }),
    [run],
  );

  return {
    status,
    settings,
    roster,
    recent,
    error,
    busy,
    start,
    stop,
    saveSettings,
    upsertClient,
    removeClient,
    sendTestBeacon,
  };
}
