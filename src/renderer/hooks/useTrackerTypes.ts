import { useEffect, useState } from 'react';

import type { TrackerTypeId } from '@/shared/tracker-types';

/**
 * Tracker type per node id, for drawing the right icon on the map.
 *
 * The APRS roster is the single place an operator says "this radio is a K9
 * team", so the map reads it rather than keeping a second list. The roster is
 * small (bounded at 500) and changes rarely, so it is re-read whenever the
 * bridge reports a status change — which `setRoster` triggers.
 */
export function useTrackerTypes(): Map<number, TrackerTypeId> {
  const [types, setTypes] = useState<Map<number, TrackerTypeId>>(new Map());

  useEffect(() => {
    let mounted = true;
    const api = window.electronAPI.aprs;

    const refresh = async (): Promise<void> => {
      try {
        const roster = await api.getRoster();
        if (!mounted) return;
        setTypes(new Map(roster.map((entry) => [entry.nodeId, entry.trackerType])));
      } catch {
        // catch-no-log-ok: map icons fall back to plain markers; the APRS panel
        // surfaces the real error
      }
    };

    void refresh();
    const unsub = api.onStatus(() => {
      void refresh();
    });

    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return types;
}
