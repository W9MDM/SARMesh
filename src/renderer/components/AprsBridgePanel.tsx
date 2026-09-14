import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AprsSettings, AprsTrackedClient } from '@/shared/aprs-types';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import { getTrackerType, TRACKER_TYPES, type TrackerTypeId } from '@/shared/tracker-types';

import { useAprsBridge } from '../hooks/useAprsBridge';
import { TrackerIcon } from './TrackerIcon';

/** A node the operator can add to the roster. */
export interface AprsCandidateNode {
  nodeId: number;
  label: string;
  hasPosition: boolean;
}

export interface AprsBridgePanelProps {
  /** Nodes currently known to the app, offered in the "add tracker" picker. */
  nodes?: AprsCandidateNode[];
}

const FIELD = 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm';
const LABEL = 'text-muted mb-1 block text-xs';
const CARD = 'rounded border border-slate-800 bg-slate-900/40 p-3';

export function AprsBridgePanel({ nodes = [] }: AprsBridgePanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const {
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
  } = useAprsBridge();

  const ids = useId();
  const [draft, setDraft] = useState<AprsSettings | null>(null);
  const [pendingNode, setPendingNode] = useState('');
  const [testLat, setTestLat] = useState('39.7392');
  const [testLon, setTestLon] = useState('-104.9903');

  // The form edits a local draft so a half-typed port never reaches the bridge.
  const form = draft ?? settings;
  const edit = (patch: Partial<AprsSettings>): void => {
    setDraft({ ...form, ...patch });
  };
  const commit = async (): Promise<void> => {
    await saveSettings(form);
    setDraft(null);
  };

  const rosterIds = useMemo(() => new Set(roster.map((entry) => entry.nodeId)), [roster]);
  const available = nodes.filter((node) => !rosterIds.has(node.nodeId));

  const addTracker = async (): Promise<void> => {
    const nodeId = Number.parseInt(pendingNode, 10);
    if (!Number.isFinite(nodeId)) return;
    const type = getTrackerType('ground-team');
    await upsertClient({
      nodeId,
      callsign: `TEAM${roster.length + 1}`,
      trackerType: 'ground-team',
      symbolTable: type.symbolTable,
      symbolCode: type.symbolCode,
      enabled: true,
    });
    setPendingNode('');
  };

  const patchClient = (client: AprsTrackedClient, patch: Partial<AprsTrackedClient>): void => {
    void upsertClient({ ...client, ...patch });
  };

  /** Changing the tracker type re-derives the APRS symbol to match. */
  const changeTrackerType = (client: AprsTrackedClient, trackerType: TrackerTypeId): void => {
    const type = getTrackerType(trackerType);
    patchClient(client, {
      trackerType,
      symbolTable: type.symbolTable,
      symbolCode: type.symbolCode,
    });
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('aprsPanel.title')}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            status.running
              ? 'border-emerald-700 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          {status.running ? t('aprsPanel.running') : t('aprsPanel.stopped')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded bg-sky-700 px-3 py-1 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => void (status.running ? stop() : start())}
        >
          {status.running ? t('aprsPanel.stop') : t('aprsPanel.start')}
        </button>
      </header>

      <p className="text-muted text-sm">
        {t('aprsPanel.localHint', { port: form.localServer.port })}
      </p>

      {error ? (
        <p className="rounded border border-red-800 bg-red-950/40 p-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {status.error ? (
        <p className="rounded border border-amber-800 bg-amber-950/30 p-2 text-sm text-amber-300">
          {status.error}
        </p>
      ) : null}

      {/* ── sink status ─────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-3">
        {status.sinks.map((sink) => (
          <div key={sink.kind} className={CARD}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t(`aprsPanel.sink.${sink.kind}`)}</span>
              <span className={sink.running ? 'text-xs text-emerald-400' : 'text-muted text-xs'}>
                {sink.running ? t('aprsPanel.up') : t('aprsPanel.down')}
              </span>
            </div>
            <p className="text-muted mt-1 text-xs">
              {t('aprsPanel.sinkStats', { clients: sink.clients, emitted: sink.emitted })}
            </p>
          </div>
        ))}
      </div>

      {/* ── roster ──────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h3 className="mb-2 text-sm font-semibold">{t('aprsPanel.rosterTitle')}</h3>
        <p className="text-muted mb-3 text-xs">{t('aprsPanel.rosterHint')}</p>

        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1">
            <label className={LABEL} htmlFor={`${ids}-add`}>
              {t('aprsPanel.addTracker')}
            </label>
            <select
              id={`${ids}-add`}
              className={FIELD}
              value={pendingNode}
              onChange={(e) => {
                setPendingNode(e.target.value);
              }}
            >
              <option value="">{t('aprsPanel.choose')}</option>
              {available.map((node) => (
                <option key={node.nodeId} value={node.nodeId}>
                  {node.label}
                  {node.hasPosition ? '' : ` ${t('aprsPanel.noFixSuffix')}`}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || !pendingNode}
            onClick={() => void addTracker()}
          >
            {t('aprsPanel.add')}
          </button>
        </div>

        {roster.length === 0 ? (
          <p className="text-muted py-4 text-center text-sm">{t('aprsPanel.rosterEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-left text-xs">
                  <th className="py-1 pr-2">{t('aprsPanel.colNode')}</th>
                  <th className="py-1 pr-2">{t('aprsPanel.colCallsign')}</th>
                  <th className="py-1 pr-2">{t('aprsPanel.colTeam')}</th>
                  <th className="py-1 pr-2">{t('aprsPanel.colType')}</th>
                  <th className="py-1 pr-2">{t('aprsPanel.colOn')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {roster.map((client) => (
                  <tr key={client.nodeId} className="border-t border-slate-800">
                    <td className="py-1 pr-2">
                      <span className="flex items-center gap-2">
                        <TrackerIcon
                          trackerType={client.trackerType}
                          className="h-4 w-4 text-sky-400"
                        />
                        <span className="font-mono text-xs">
                          {formatMeshtasticNodeId(client.nodeId)}
                        </span>
                      </span>
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={FIELD}
                        defaultValue={client.callsign}
                        onBlur={(e) => {
                          patchClient(client, { callsign: e.target.value });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={FIELD}
                        defaultValue={client.team ?? ''}
                        onBlur={(e) => {
                          patchClient(client, { team: e.target.value });
                        }}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className={FIELD}
                        value={client.trackerType}
                        onChange={(e) => {
                          changeTrackerType(client, e.target.value as TrackerTypeId);
                        }}
                      >
                        {TRACKER_TYPES.map((type) => (
                          <option key={type.id} value={type.id}>
                            {t(`aprsPanel.trackerType.${type.labelKey}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="checkbox"
                        checked={client.enabled}
                        aria-label={t('aprsPanel.colOn')}
                        onChange={(e) => {
                          patchClient(client, { enabled: e.target.checked });
                        }}
                      />
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        className="text-xs text-red-400"
                        onClick={() => void removeClient(client.nodeId)}
                      >
                        {t('aprsPanel.remove')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── settings ────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h3 className="mb-2 text-sm font-semibold">{t('aprsPanel.settingsTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor={`${ids}-host`}>
              {t('aprsPanel.bindAddress')}
            </label>
            <input
              id={`${ids}-host`}
              className={FIELD}
              value={form.localServer.host}
              onChange={(e) => {
                edit({ localServer: { ...form.localServer, host: e.target.value } });
              }}
              onBlur={() => void commit()}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${ids}-port`}>
              {t('aprsPanel.port')}
            </label>
            <input
              id={`${ids}-port`}
              className={FIELD}
              type="number"
              value={form.localServer.port}
              onChange={(e) => {
                edit({
                  localServer: {
                    ...form.localServer,
                    port: Number.parseInt(e.target.value, 10) || 14580,
                  },
                });
              }}
              onBlur={() => void commit()}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${ids}-interval`}>
              {t('aprsPanel.minInterval')}
            </label>
            <input
              id={`${ids}-interval`}
              className={FIELD}
              type="number"
              value={form.minIntervalSeconds}
              onChange={(e) => {
                edit({ minIntervalSeconds: Number.parseInt(e.target.value, 10) || 0 });
              }}
              onBlur={() => void commit()}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${ids}-age`}>
              {t('aprsPanel.maxAge')}
            </label>
            <input
              id={`${ids}-age`}
              className={FIELD}
              type="number"
              value={form.maxAgeSeconds}
              onChange={(e) => {
                edit({ maxAgeSeconds: Number.parseInt(e.target.value, 10) || 0 });
              }}
              onBlur={() => void commit()}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL} htmlFor={`${ids}-comment`}>
              {t('aprsPanel.commentSuffix')}
            </label>
            <input
              id={`${ids}-comment`}
              className={FIELD}
              value={form.commentSuffix}
              onChange={(e) => {
                edit({ commentSuffix: e.target.value });
              }}
              onBlur={() => void commit()}
            />
          </div>
        </div>
      </section>

      {/* ── verify ──────────────────────────────────────────────────── */}
      <section className={CARD}>
        <h3 className="mb-1 text-sm font-semibold">{t('aprsPanel.verifyTitle')}</h3>
        <p className="text-muted mb-2 text-xs">{t('aprsPanel.verifyHint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${FIELD} max-w-32`}
            value={testLat}
            aria-label={t('aprsPanel.latitude')}
            onChange={(e) => {
              setTestLat(e.target.value);
            }}
          />
          <input
            className={`${FIELD} max-w-32`}
            value={testLon}
            aria-label={t('aprsPanel.longitude')}
            onChange={(e) => {
              setTestLon(e.target.value);
            }}
          />
          <button
            type="button"
            className="rounded bg-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={busy || !status.running}
            onClick={() =>
              void sendTestBeacon('TEST-1', Number.parseFloat(testLat), Number.parseFloat(testLon))
            }
          >
            {t('aprsPanel.sendTest')}
          </button>
        </div>
      </section>

      {/* ── recent beacons ──────────────────────────────────────────── */}
      <section className={CARD}>
        <h3 className="mb-2 text-sm font-semibold">{t('aprsPanel.recentTitle')}</h3>
        {recent.length === 0 ? (
          <p className="text-muted py-3 text-center text-sm">{t('aprsPanel.recentEmpty')}</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto font-mono text-xs">
            {recent.map((record, index) => (
              <li key={`${record.time}-${index}`} className="flex gap-2 py-0.5">
                <span className="text-muted shrink-0">
                  {new Date(record.time).toLocaleTimeString()}
                </span>
                <span className="break-all">{record.frame}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default AprsBridgePanel;
