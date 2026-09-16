import { useCallback, useEffect, useRef, useState } from 'react';

import type { DiscoveryState } from '@/shared/mdns-types';
import { IDLE_DISCOVERY_STATE } from '@/shared/mdns-types';

export interface UseNodeDiscoveryResult extends DiscoveryState {
  /** Re-issue the multicast query so radios answer again right away. */
  refresh: () => void;
}

/**
 * Mirrors the main process's mDNS browse for `_meshtastic._tcp` radios.
 *
 * Browsing is only started while `enabled` is true — i.e. while the operator is
 * actually looking at a Wi-Fi connection form. A search-and-rescue base station
 * is often on battery, and there is no reason to keep a multicast socket and a
 * sweep timer alive behind a serial or BLE connection.
 */
export function useNodeDiscovery(enabled: boolean): UseNodeDiscoveryResult {
  const [state, setState] = useState<DiscoveryState>(IDLE_DISCOVERY_STATE);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const api = window.electronAPI.mdns;
    if (!enabled) {
      void api.stop().catch((err: unknown) => {
        console.warn('[mdns] stop failed:', err);
      });
      return;
    }

    const unsubscribe = api.onState((next) => {
      if (mounted.current) setState(next);
    });

    void api
      .start()
      .then((next) => {
        if (mounted.current) setState(next);
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        setState({
          browsing: false,
          nodes: [],
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      unsubscribe();
      void api.stop().catch((err: unknown) => {
        console.warn('[mdns] stop failed:', err);
      });
    };
  }, [enabled]);

  const refresh = useCallback(() => {
    void window.electronAPI.mdns
      .refresh()
      .then((next) => {
        if (mounted.current) setState(next);
      })
      .catch((err: unknown) => {
        console.warn('[mdns] refresh failed:', err);
      });
  }, []);

  // Derived rather than reset in the effect: a disabled hook reports idle even
  // if the last browse's nodes are still in state, and React never has to do a
  // second render pass to get there.
  return enabled ? { ...state, refresh } : { ...IDLE_DISCOVERY_STATE, refresh };
}
