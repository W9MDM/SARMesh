import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setPacketCaptureEnabled } from '@/renderer/lib/packetMonitorCapture';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import type {
  PacketMonitorRecord,
  PacketMonitorSettings,
  PacketMonitorStats,
} from '@/shared/packet-monitor-types';
import {
  clampRetentionHours,
  DEFAULT_PACKET_MONITOR_SETTINGS,
  PACKET_MONITOR_MAX_HOURS,
  PACKET_MONITOR_MIN_HOURS,
} from '@/shared/packet-monitor-types';

const FIELD = 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm';
const LABEL = 'text-muted mb-1 block text-xs';
const CARD = 'rounded border border-slate-800 bg-slate-900/40 p-3';

/** Windows the operator can review, in hours. */
const WINDOW_CHOICES = [1, 4, 12, 24, 72] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function PacketMonitorPanel(): React.JSX.Element {
  const { t } = useTranslation();

  const [settings, setSettings] = useState<PacketMonitorSettings>(DEFAULT_PACKET_MONITOR_SETTINGS);
  const [stats, setStats] = useState<PacketMonitorStats | null>(null);
  const [rows, setRows] = useState<PacketMonitorRecord[]>([]);
  const [windowHours, setWindowHours] = useState<number>(1);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const sinceMs = Date.now() - windowHours * 60 * 60 * 1000;
      const [packets, nextStats] = await Promise.all([
        window.electronAPI.packetMonitor.query({ sinceMs, limit: 2000 }),
        window.electronAPI.packetMonitor.stats(),
      ]);
      setRows(packets);
      setStats(nextStats);
      setError(null);
    } catch (err) {
      console.warn('[packetMonitor] refresh failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [windowHours]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await window.electronAPI.packetMonitor.getSettings();
        if (cancelled) return;
        setSettings(stored);
        // Keep the renderer gate in step, so capture starts without a restart.
        setPacketCaptureEnabled(stored.enabled);
      } catch (err) {
        console.warn('[packetMonitor] settings read failed:', err);
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const save = useCallback(async (next: PacketMonitorSettings) => {
    setBusy(true);
    try {
      const saved = await window.electronAPI.packetMonitor.setSettings(next);
      setSettings(saved);
      setPacketCaptureEnabled(saved.enabled);
      setError(null);
    } catch (err) {
      // A failed settings write means capture silently stays as it was.
      console.warn('[packetMonitor] settings save failed:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [
        r.fromNode === undefined ? '' : formatMeshtasticNodeId(r.fromNode),
        r.portnum === undefined ? '' : String(r.portnum),
        r.protocol,
        r.direction,
        r.rawHex ?? '',
      ].some((f) => f.toLowerCase().includes(needle)),
    );
  }, [rows, filter]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('packetMonitor.title')}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            settings.enabled
              ? 'border-emerald-700 text-emerald-400'
              : 'border-slate-700 text-slate-400'
          }`}
        >
          {settings.enabled ? t('packetMonitor.capturing') : t('packetMonitor.paused')}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          className="rounded bg-sky-700 px-3 py-1 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => void save({ ...settings, enabled: !settings.enabled })}
        >
          {settings.enabled ? t('packetMonitor.stop') : t('packetMonitor.start')}
        </button>
      </header>

      <p className="text-muted text-sm">{t('packetMonitor.intro')}</p>

      {error != null && (
        <p className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={LABEL} htmlFor="packet-retention">
              {t('packetMonitor.retention')}
            </label>
            <input
              id="packet-retention"
              type="number"
              className={FIELD}
              min={PACKET_MONITOR_MIN_HOURS}
              max={PACKET_MONITOR_MAX_HOURS}
              value={settings.retentionHours}
              disabled={busy}
              onChange={(e) => {
                setSettings({ ...settings, retentionHours: Number(e.target.value) });
              }}
              onBlur={(e) => {
                void save({
                  ...settings,
                  retentionHours: clampRetentionHours(Number(e.target.value)),
                });
              }}
            />
            <p className="text-muted mt-1 text-xs">{t('packetMonitor.retentionHint')}</p>
          </div>

          <div>
            <label className={LABEL} htmlFor="packet-window">
              {t('packetMonitor.window')}
            </label>
            <select
              id="packet-window"
              className={FIELD}
              value={windowHours}
              onChange={(e) => {
                setWindowHours(Number(e.target.value));
              }}
            >
              {WINDOW_CHOICES.map((h) => (
                <option key={h} value={h}>
                  {t('packetMonitor.lastHours', { count: h })}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={LABEL} htmlFor="packet-filter">
              {t('packetMonitor.filter')}
            </label>
            <input
              id="packet-filter"
              type="search"
              className={FIELD}
              placeholder={t('packetMonitor.filterPlaceholder')}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            />
          </div>
        </div>

        {stats && (
          <p className="text-muted mt-3 text-xs">
            {t('packetMonitor.stats', {
              rows: stats.rowCount,
              size: formatBytes(stats.fileBytes),
              oldest: stats.oldestMs ? formatClock(stats.oldestMs) : '—',
            })}
          </p>
        )}
      </section>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-slate-700 px-3 py-1 text-sm"
          onClick={() => void refresh()}
        >
          {t('packetMonitor.refresh')}
        </button>
        <button
          type="button"
          className="rounded border border-red-800 px-3 py-1 text-sm text-red-300"
          disabled={busy}
          onClick={() => {
            void (async () => {
              await window.electronAPI.packetMonitor.clear();
              await refresh();
            })();
          }}
        >
          {t('packetMonitor.clear')}
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted py-6 text-center text-sm">
          {settings.enabled ? t('packetMonitor.empty') : t('packetMonitor.emptyPaused')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted text-left">
                <th className="py-1 pr-2">{t('packetMonitor.colTime')}</th>
                <th className="py-1 pr-2">{t('packetMonitor.colFrom')}</th>
                <th className="py-1 pr-2">{t('packetMonitor.colPort')}</th>
                <th className="py-1 pr-2">{t('packetMonitor.colVia')}</th>
                <th className="py-1 pr-2">{t('packetMonitor.colSnr')}</th>
                <th className="py-1 pr-2">{t('packetMonitor.colSize')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id ?? `${r.ts}-${r.fromNode ?? 0}`}
                  className="border-t border-slate-800"
                >
                  <td className="py-1 pr-2 font-mono">{formatClock(r.ts)}</td>
                  <td className="py-1 pr-2 font-mono">
                    {r.fromNode === undefined ? '—' : formatMeshtasticNodeId(r.fromNode)}
                  </td>
                  <td className="py-1 pr-2">{r.portnum ?? '—'}</td>
                  <td className="py-1 pr-2">
                    {r.viaMqtt ? t('packetMonitor.viaMqtt') : t('packetMonitor.viaRf')}
                  </td>
                  <td className="py-1 pr-2">{r.snr === undefined ? '—' : r.snr.toFixed(1)}</td>
                  <td className="py-1 pr-2">{r.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-muted text-xs">{t('packetMonitor.privacyNote')}</p>
    </div>
  );
}

export default PacketMonitorPanel;
