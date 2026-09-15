import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AssetStatus, InventoryNode } from '@/shared/inventory-types';
import { ASSET_STATUSES } from '@/shared/inventory-types';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { useInventory } from '../hooks/useInventory';

export interface InventoryCandidateNode {
  nodeId: number;
  label: string;
}

export interface InventoryPanelProps {
  /** Radios the app knows about, offered when registering a new asset. */
  nodes?: InventoryCandidateNode[];
}

const FIELD = 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm';
const LABEL = 'text-muted mb-1 block text-xs';
const CARD = 'rounded border border-slate-800 bg-slate-900/40 p-3';

const STATUS_CLASS: Record<AssetStatus, string> = {
  'in-service': 'text-emerald-400',
  deployed: 'text-sky-400',
  maintenance: 'text-amber-400',
  'needs-config': 'text-amber-400',
  lost: 'text-red-400',
  retired: 'text-slate-500',
};

function relativeTime(epochMs: number | undefined, never: string): string {
  if (!epochMs) return never;
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function InventoryPanel({ nodes = [] }: InventoryPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
    nodes: inventory,
    profiles,
    error,
    busy,
    registerNode,
    updateNode,
    removeNode,
    queueChange,
    cancelChange,
  } = useInventory();

  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [batchProfile, setBatchProfile] = useState('');
  const [pendingNode, setPendingNode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const registeredIds = useMemo(() => new Set(inventory.map((node) => node.nodeId)), [inventory]);
  const unregistered = nodes.filter((node) => !registeredIds.has(node.nodeId));

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return inventory;
    return inventory.filter((node) =>
      [node.assetTag, node.label, node.team, node.assignedTo, String(node.nodeId)]
        .filter(Boolean)
        .some((field) => field?.toLowerCase().includes(needle)),
    );
  }, [inventory, filter]);

  const detail = inventory.find((node) => node.nodeId === detailId);
  const pendingTotal = inventory.reduce(
    (sum, node) => sum + node.pendingChanges.filter((c) => c.state === 'queued').length,
    0,
  );

  const toggle = (nodeId: number): void => {
    const next = new Set(selected);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setSelected(next);
  };

  /** Queue one profile against every selected radio — the batch entry point. */
  const queueForSelected = async (): Promise<void> => {
    const profile = profiles.find((p) => p.id === batchProfile);
    if (!profile || selected.size === 0) return;
    await queueChange(
      [...selected],
      `${t('inventoryPanel.applyProfile')}: ${profile.name}`,
      profile.config,
    );
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('inventoryPanel.title')}</h2>
        <div className="flex-1" />
        <span className="text-muted text-xs">
          {t('inventoryPanel.count', { count: inventory.length })}
        </span>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 text-xs"
          onClick={() => {
            void window.electronAPI.inventory.exportFile().then((r) => {
              if (!r.cancelled) setNotice(t('inventoryPanel.exported', { count: r.nodes ?? 0 }));
            });
          }}
        >
          {t('inventoryPanel.export')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 text-xs"
          onClick={() => {
            void window.electronAPI.inventory.exportCsv();
          }}
        >
          {t('inventoryPanel.exportCsv')}
        </button>
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 text-xs"
          onClick={() => {
            void window.electronAPI.inventory.importFile('merge').then((r) => {
              if (r.cancelled || !r.summary) return;
              setNotice(
                t('inventoryPanel.imported', {
                  added: r.summary.added,
                  updated: r.summary.updated,
                }),
              );
            });
          }}
        >
          {t('inventoryPanel.import')}
        </button>
      </header>

      <p className="text-muted text-sm">{t('inventoryPanel.intro')}</p>

      {pendingTotal > 0 ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-sm text-amber-300">
          {t('inventoryPanel.pendingBanner', { count: pendingTotal })}
        </p>
      ) : null}

      {error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded border border-emerald-800 bg-emerald-950/30 p-2 text-sm text-emerald-300">
          {notice}
        </p>
      ) : null}

      {/* ── register + batch bar ─────────────────────────────────────── */}
      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label className={LABEL} htmlFor="inv-add">
              {t('inventoryPanel.addRadio')}
            </label>
            <select
              id="inv-add"
              className={FIELD}
              value={pendingNode}
              onChange={(e) => {
                setPendingNode(e.target.value);
              }}
            >
              <option value="">{t('inventoryPanel.choose')}</option>
              {unregistered.map((node) => (
                <option key={node.nodeId} value={node.nodeId}>
                  {node.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || !pendingNode}
            onClick={() => {
              void registerNode(Number.parseInt(pendingNode, 10)).then(() => {
                setPendingNode('');
              });
            }}
          >
            {t('inventoryPanel.register')}
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <input
            className={`${FIELD} max-w-72`}
            placeholder={t('inventoryPanel.filterPlaceholder')}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
            }}
          />
          <div className="flex-1" />
          <span className="text-muted text-xs">
            {t('inventoryPanel.selected', { count: selected.size })}
          </span>
          <select
            className={`${FIELD} max-w-56`}
            value={batchProfile}
            onChange={(e) => {
              setBatchProfile(e.target.value);
            }}
          >
            <option value="">{t('inventoryPanel.chooseProfile')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-sky-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || selected.size === 0 || !batchProfile}
            onClick={() => void queueForSelected()}
          >
            {t('inventoryPanel.queueForSelected')}
          </button>
        </div>
      </section>

      {/* ── the register ─────────────────────────────────────────────── */}
      <section className={CARD}>
        {visible.length === 0 ? (
          <p className="text-muted py-6 text-center text-sm">{t('inventoryPanel.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left text-xs">
                  <th className="w-8 py-1" />
                  <th className="py-1 pr-2">{t('inventoryPanel.colAsset')}</th>
                  <th className="py-1 pr-2">{t('inventoryPanel.colHolder')}</th>
                  <th className="py-1 pr-2">{t('inventoryPanel.colStatus')}</th>
                  <th className="py-1 pr-2">{t('inventoryPanel.colConfig')}</th>
                  <th className="py-1 pr-2">{t('inventoryPanel.colQueued')}</th>
                  <th className="py-1 pr-2">{t('inventoryPanel.colSeen')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((node) => {
                  const queued = node.pendingChanges.filter((c) => c.state === 'queued').length;
                  return (
                    <tr
                      key={node.nodeId}
                      className="cursor-pointer border-t border-slate-800 hover:bg-slate-800/40"
                      onClick={() => {
                        setDetailId(node.nodeId);
                      }}
                    >
                      <td
                        className="py-1"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <input
                          type="checkbox"
                          aria-label={t('inventoryPanel.selectRadio')}
                          checked={selected.has(node.nodeId)}
                          onChange={() => {
                            toggle(node.nodeId);
                          }}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <div>{node.assetTag ?? node.label ?? t('inventoryPanel.untagged')}</div>
                        <div className="text-muted font-mono text-xs">
                          {formatMeshtasticNodeId(node.nodeId)}
                        </div>
                      </td>
                      <td className="py-1 pr-2">
                        <div>{node.assignedTo ?? '—'}</div>
                        <div className="text-muted text-xs">{node.team ?? ''}</div>
                      </td>
                      <td className={`py-1 pr-2 text-xs ${STATUS_CLASS[node.status]}`}>
                        {t(`inventoryPanel.status.${node.status}`)}
                      </td>
                      <td className="text-muted py-1 pr-2 text-xs">
                        {node.lastKnownConfig
                          ? `${node.lastKnownConfig.lora?.region ?? '?'} · ${
                              node.lastKnownConfig.lora?.modemPreset ?? '?'
                            }`
                          : t('inventoryPanel.neverRead')}
                      </td>
                      <td className="py-1 pr-2 text-xs">
                        {queued > 0 ? (
                          <span className="text-amber-400">{queued}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-muted py-1 pr-2 text-xs">
                        {relativeTime(node.lastSeen, t('inventoryPanel.never'))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {detail ? (
        <RadioDetail
          node={detail}
          busy={busy}
          onClose={() => {
            setDetailId(null);
          }}
          onUpdate={updateNode}
          onRemove={removeNode}
          onCancelChange={cancelChange}
        />
      ) : null}
    </div>
  );
}

interface RadioDetailProps {
  node: InventoryNode;
  busy: boolean;
  onClose: () => void;
  onUpdate: (nodeId: number, patch: Partial<InventoryNode>) => Promise<void>;
  onRemove: (nodeId: number) => Promise<void>;
  onCancelChange: (nodeId: number, changeId: string) => Promise<void>;
}

/** Retained settings, queue and audit trail for one radio. */
function RadioDetail({
  node,
  busy,
  onClose,
  onUpdate,
  onRemove,
  onCancelChange,
}: RadioDetailProps): React.JSX.Element {
  const { t } = useTranslation();
  const config = node.lastKnownConfig;

  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold">
          {node.assetTag ?? node.label ?? formatMeshtasticNodeId(node.nodeId)}
        </h3>
        <div className="flex-1" />
        <button
          type="button"
          className="text-xs text-red-400"
          disabled={busy}
          onClick={() => {
            void onRemove(node.nodeId).then(onClose);
          }}
        >
          {t('inventoryPanel.remove')}
        </button>
        <button type="button" className="rounded bg-slate-700 px-3 py-1 text-xs" onClick={onClose}>
          {t('inventoryPanel.close')}
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <div>
          <label className={LABEL} htmlFor="inv-tag">
            {t('inventoryPanel.assetTag')}
          </label>
          <input
            id="inv-tag"
            className={FIELD}
            defaultValue={node.assetTag ?? ''}
            onBlur={(e) => void onUpdate(node.nodeId, { assetTag: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-holder">
            {t('inventoryPanel.assignedTo')}
          </label>
          <input
            id="inv-holder"
            className={FIELD}
            defaultValue={node.assignedTo ?? ''}
            onBlur={(e) => void onUpdate(node.nodeId, { assignedTo: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-team">
            {t('inventoryPanel.team')}
          </label>
          <input
            id="inv-team"
            className={FIELD}
            defaultValue={node.team ?? ''}
            onBlur={(e) => void onUpdate(node.nodeId, { team: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="inv-status">
            {t('inventoryPanel.colStatus')}
          </label>
          <select
            id="inv-status"
            className={FIELD}
            defaultValue={node.status}
            onChange={(e) => void onUpdate(node.nodeId, { status: e.target.value as AssetStatus })}
          >
            {ASSET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`inventoryPanel.status.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase">
            {t('inventoryPanel.retainedConfig')}
          </h4>
          {!config ? (
            <p className="text-muted text-sm">{t('inventoryPanel.neverReadHint')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                <Row
                  label={t('inventoryPanel.captured')}
                  value={new Date(config.capturedAt).toLocaleString()}
                />
                <Row label={t('inventoryPanel.firmware')} value={config.firmwareVersion} />
                <Row label={t('inventoryPanel.longName')} value={config.owner?.longName} />
                <Row label={t('inventoryPanel.region')} value={config.lora?.region} />
                <Row label={t('inventoryPanel.modemPreset')} value={config.lora?.modemPreset} />
                <Row label={t('inventoryPanel.role')} value={config.device?.role} />
                {config.channels?.map((channel) => (
                  <Row
                    key={channel.index}
                    label={t('inventoryPanel.channelN', { index: channel.index })}
                    value={`${channel.name || '—'} · ${channel.role}`}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase">{t('inventoryPanel.queued')}</h4>
          {node.pendingChanges.length === 0 ? (
            <p className="text-muted text-sm">{t('inventoryPanel.nothingQueued')}</p>
          ) : (
            <ul className="mb-4 text-sm">
              {node.pendingChanges.map((change) => (
                <li key={change.id} className="flex items-center gap-2 py-1">
                  <span className="flex-1">{change.label}</span>
                  <span
                    className={
                      change.state === 'applied'
                        ? 'text-xs text-emerald-400'
                        : change.state === 'failed'
                          ? 'text-xs text-red-400'
                          : 'text-xs text-amber-400'
                    }
                  >
                    {t(`inventoryPanel.changeState.${change.state}`)}
                  </span>
                  {change.state === 'queued' ? (
                    <button
                      type="button"
                      className="text-xs text-red-400"
                      onClick={() => void onCancelChange(node.nodeId, change.id)}
                    >
                      {t('inventoryPanel.cancel')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <h4 className="mb-2 text-xs font-semibold uppercase">{t('inventoryPanel.history')}</h4>
          <ul className="text-muted max-h-48 overflow-y-auto font-mono text-xs">
            {[...node.history].reverse().map((event, index) => (
              <li key={`${event.time}-${index}`} className="py-0.5">
                {new Date(event.time).toLocaleString()} · {event.kind} · {event.detail}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value?: string | number }): React.JSX.Element {
  return (
    <tr>
      <td className="text-muted w-2/5 py-0.5 text-xs">{label}</td>
      <td className="py-0.5">{value ?? '—'}</td>
    </tr>
  );
}

export default InventoryPanel;
