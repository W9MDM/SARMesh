import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  InventoryConfig,
  InventoryNode,
  InventoryProfile,
  InventorySettings,
  ReconcileResult,
} from '@/shared/inventory-types';
import { DEFAULT_INVENTORY_SETTINGS } from '@/shared/inventory-types';

export interface UseInventoryResult {
  nodes: InventoryNode[];
  profiles: InventoryProfile[];
  settings: InventorySettings;
  lastReconcile: ReconcileResult | null;
  error: string | null;
  busy: boolean;
  registerNode: (nodeId: number, seed?: Partial<InventoryNode>) => Promise<void>;
  updateNode: (nodeId: number, patch: Partial<InventoryNode>) => Promise<void>;
  removeNode: (nodeId: number) => Promise<void>;
  addNote: (nodeId: number, note: string) => Promise<void>;
  queueChange: (nodeIds: number[], label: string, config: InventoryConfig) => Promise<void>;
  cancelChange: (nodeId: number, changeId: string) => Promise<void>;
  saveProfile: (profile: InventoryProfile) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  setSettings: (settings: InventorySettings) => Promise<void>;
}

/**
 * The renderer's view of the radio asset register. Main owns the data; this
 * mirrors it and refreshes on the change events main pushes.
 */
export function useInventory(): UseInventoryResult {
  const [nodes, setNodes] = useState<InventoryNode[]>([]);
  const [profiles, setProfiles] = useState<InventoryProfile[]>([]);
  const [settings, setSettingsState] = useState<InventorySettings>(DEFAULT_INVENTORY_SETTINGS);
  const [lastReconcile, setLastReconcile] = useState<ReconcileResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const api = window.electronAPI.inventory;

    void (async () => {
      try {
        const [n, p, s] = await Promise.all([api.list(), api.listProfiles(), api.getSettings()]);
        if (!mounted.current) return;
        setNodes(n);
        setProfiles(p);
        setSettingsState(s);
      } catch (err) {
        // catch-no-log-ok: surfaced to the operator as the panel's error banner
        if (mounted.current) setError(err instanceof Error ? err.message : String(err));
      }
    })();

    const unsubChanged = api.onChanged((next) => {
      if (mounted.current) setNodes(next);
    });
    const unsubReconciled = api.onReconciled((result) => {
      if (mounted.current) setLastReconcile(result);
    });

    return () => {
      mounted.current = false;
      unsubChanged();
      unsubReconciled();
    };
  }, []);

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

  const registerNode = useCallback(
    (nodeId: number, seed?: Partial<InventoryNode>) =>
      run(async () => {
        await window.electronAPI.inventory.register(nodeId, seed);
      }),
    [run],
  );

  const updateNode = useCallback(
    (nodeId: number, patch: Partial<InventoryNode>) =>
      run(async () => {
        await window.electronAPI.inventory.update(nodeId, patch);
      }),
    [run],
  );

  const removeNode = useCallback(
    (nodeId: number) =>
      run(async () => {
        setNodes(await window.electronAPI.inventory.remove(nodeId));
      }),
    [run],
  );

  const addNote = useCallback(
    (nodeId: number, note: string) =>
      run(async () => {
        await window.electronAPI.inventory.addNote(nodeId, note);
      }),
    [run],
  );

  const queueChange = useCallback(
    (nodeIds: number[], label: string, config: InventoryConfig) =>
      run(async () => {
        setNodes(await window.electronAPI.inventory.queueChange(nodeIds, label, config));
      }),
    [run],
  );

  const cancelChange = useCallback(
    (nodeId: number, changeId: string) =>
      run(async () => {
        setNodes(await window.electronAPI.inventory.cancelChange(nodeId, changeId));
      }),
    [run],
  );

  const saveProfile = useCallback(
    (profile: InventoryProfile) =>
      run(async () => {
        setProfiles(await window.electronAPI.inventory.saveProfile(profile));
      }),
    [run],
  );

  const deleteProfile = useCallback(
    (id: string) =>
      run(async () => {
        setProfiles(await window.electronAPI.inventory.deleteProfile(id));
      }),
    [run],
  );

  const setSettings = useCallback(
    (next: InventorySettings) =>
      run(async () => {
        setSettingsState(await window.electronAPI.inventory.setSettings(next));
      }),
    [run],
  );

  return {
    nodes,
    profiles,
    settings,
    lastReconcile,
    error,
    busy,
    registerNode,
    updateNode,
    removeNode,
    addNote,
    queueChange,
    cancelChange,
    saveProfile,
    deleteProfile,
    setSettings,
  };
}
