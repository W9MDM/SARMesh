import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  conventionalFileNames,
  fetchDeviceTargets,
  fetchFirmwareReleases,
  fetchTargetManifest,
  findAppFile,
  findFileSystemFile,
  findOtaFile,
  findTargetByPioEnv,
  findUpdateFile,
  type FirmwareRelease,
  isUf2Architecture,
} from '@/renderer/lib/flasher/meshtasticFirmwareCatalog';
import { flashMeshtasticFirmware } from '@/renderer/lib/flasher/meshtasticFlasher';
import type { DeviceTarget, FirmwareManifest, FlashPlan } from '@/shared/meshtasticFirmware';
import { buildCleanInstallPlan, buildUpdatePlan } from '@/shared/meshtasticFirmware';
import { compareNodeLabels } from '@/shared/nodeListSort';

const FIELD = 'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm';
const LABEL = 'text-muted mb-1 block text-xs';
const CARD = 'rounded border border-slate-800 bg-slate-900/40 p-3';

export interface FirmwarePanelProps {
  /** `pio_env` of the connected or discovered radio, used to preselect a board. */
  detectedPioEnv?: string;
  /** Firmware version the connected radio reports, so we can flag a downgrade. */
  currentFirmwareVersion?: string;
}

type InstallMode = 'update' | 'clean';

/** Flash is destructive and irreversible mid-write; the UI gates on this. */
type Stage = 'idle' | 'loading' | 'ready' | 'flashing' | 'done' | 'error';

export function FirmwarePanel({
  detectedPioEnv,
  currentFirmwareVersion,
}: FirmwarePanelProps): React.JSX.Element {
  const { t } = useTranslation();

  const [releases, setReleases] = useState<FirmwareRelease[]>([]);
  const [targets, setTargets] = useState<DeviceTarget[]>([]);
  const [versionId, setVersionId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [mode, setMode] = useState<InstallMode>('update');
  const [manifest, setManifest] = useState<FirmwareManifest | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ─── Catalog ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const httpFetch = (url: string) => fetch(url);
    void (async () => {
      try {
        const [releaseList, targetList] = await Promise.all([
          fetchFirmwareReleases(httpFetch),
          fetchDeviceTargets(httpFetch),
        ]);
        if (cancelled) return;
        setReleases(releaseList);
        setTargets(targetList);
        setVersionId((current) => current || (releaseList[0]?.id ?? ''));
        // A radio found over mDNS already told us its board.
        const detected = findTargetByPioEnv(targetList, detectedPioEnv);
        setTargetId((current) => current || detected?.platformioTarget || '');
        setStage('ready');
      } catch (err) {
        if (cancelled) return;
        console.warn('[firmware] catalog fetch failed:', err);
        setError(err instanceof Error ? err.message : String(err));
        setStage('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detectedPioEnv]);

  // ─── Manifest for the chosen version + board ────────────────────────────────
  useEffect(() => {
    if (!versionId || !targetId) return;
    let cancelled = false;
    void fetchTargetManifest((url) => fetch(url), versionId, targetId)
      .then((next) => {
        if (!cancelled) setManifest(next);
      })
      .catch(() => {
        // A missing manifest is normal before 2.8; the plan falls back to the
        // partition scheme, so this is not surfaced as an error.
        if (!cancelled) setManifest(null);
      });
    return () => {
      cancelled = true;
    };
  }, [versionId, targetId]);

  // Derived rather than reset in the effect: a cleared selection reads as "no
  // manifest" without a second render pass.
  const activeManifest = versionId && targetId ? manifest : null;

  const target = useMemo(
    () => targets.find((entry) => entry.platformioTarget === targetId),
    [targets, targetId],
  );

  const sortedTargets = useMemo(
    () => [...targets].sort((a, b) => compareNodeLabels(a.displayName, b.displayName)),
    [targets],
  );

  const needsUf2 = isUf2Architecture(target?.architecture);

  /** The exact files and addresses this install would write. */
  const plan: FlashPlan | null = useMemo(() => {
    if (!versionId || !targetId) return null;
    const fallback = conventionalFileNames(versionId, targetId);

    if (mode === 'update') {
      const updateFile = findUpdateFile(activeManifest, targetId) ?? fallback.updateFile;
      return buildUpdatePlan({ updateFile, manifest: activeManifest });
    }

    return buildCleanInstallPlan({
      appFile: findAppFile(activeManifest, targetId) ?? fallback.appFile,
      otaFile: findOtaFile(activeManifest) ?? fallback.otaFile,
      littleFsFile: findFileSystemFile(activeManifest) ?? fallback.littleFsFile,
      manifest: activeManifest,
      partitionScheme: target?.partitionScheme,
      hasMui: target?.hasMui,
      firmwareVersion: versionId,
    });
  }, [versionId, targetId, mode, activeManifest, target]);

  const startFlash = useCallback(async () => {
    if (!plan || !targetId) return;
    setError(null);
    setPercent(0);
    setStage('flashing');
    try {
      if (!navigator.serial?.requestPort) {
        throw new Error(t('firmwarePanel.noSerialApi'));
      }
      const serialPort = await navigator.serial.requestPort({});
      await flashMeshtasticFirmware({
        serialPort,
        platformioTarget: targetId,
        version: versionId,
        plan,
        fetchFn: (url) => fetch(url),
        onProgress: setPercent,
      });
      setStage('done');
    } catch (err) {
      // A failed flash is the first thing to look for in a support bundle.
      console.error('[firmware] flash failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }, [plan, targetId, versionId, t]);

  const busy = stage === 'flashing';

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{t('firmwarePanel.title')}</h2>
        {currentFirmwareVersion != null && currentFirmwareVersion !== '' && (
          <span className="text-muted text-xs">
            {t('firmwarePanel.currentVersion', { version: currentFirmwareVersion })}
          </span>
        )}
      </header>

      <p className="text-muted text-sm">{t('firmwarePanel.intro')}</p>

      {error != null && (
        <p className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL} htmlFor="firmware-board">
              {t('firmwarePanel.board')}
            </label>
            <select
              id="firmware-board"
              className={FIELD}
              value={targetId}
              disabled={busy}
              onChange={(e) => {
                setTargetId(e.target.value);
              }}
            >
              <option value="">{t('firmwarePanel.chooseBoard')}</option>
              {sortedTargets.map((entry) => (
                <option key={entry.platformioTarget} value={entry.platformioTarget}>
                  {entry.displayName}
                </option>
              ))}
            </select>
            {detectedPioEnv != null && detectedPioEnv !== '' && (
              <p className="text-muted mt-1 text-xs">
                {t('firmwarePanel.detectedBoard', { pioEnv: detectedPioEnv })}
              </p>
            )}
          </div>

          <div>
            <label className={LABEL} htmlFor="firmware-version">
              {t('firmwarePanel.version')}
            </label>
            <select
              id="firmware-version"
              className={FIELD}
              value={versionId}
              disabled={busy}
              onChange={(e) => {
                setVersionId(e.target.value);
              }}
            >
              {releases.map((release) => (
                <option key={release.id} value={release.id}>
                  {release.title}
                  {release.channel === 'alpha' ? ` ${t('firmwarePanel.alphaSuffix')}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h3 className="mb-2 text-sm font-semibold">{t('firmwarePanel.modeTitle')}</h3>
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2 text-sm">
            <input
              id="firmware-mode-update"
              type="radio"
              name="firmware-mode"
              className="mt-1"
              checked={mode === 'update'}
              disabled={busy}
              onChange={() => {
                setMode('update');
              }}
            />
            <label htmlFor="firmware-mode-update">
              <span className="font-medium">{t('firmwarePanel.modeUpdate')}</span>
              <span className="text-muted block text-xs">{t('firmwarePanel.modeUpdateHint')}</span>
            </label>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <input
              id="firmware-mode-clean"
              type="radio"
              name="firmware-mode"
              className="mt-1"
              checked={mode === 'clean'}
              disabled={busy}
              onChange={() => {
                setMode('clean');
              }}
            />
            <label htmlFor="firmware-mode-clean">
              <span className="font-medium">{t('firmwarePanel.modeClean')}</span>
              <span className="block text-xs text-yellow-400">
                {t('firmwarePanel.modeCleanHint')}
              </span>
            </label>
          </div>
        </div>
      </section>

      {needsUf2 ? (
        <section className={CARD}>
          <p className="text-sm text-yellow-400">
            {t('firmwarePanel.uf2Notice', { board: target?.displayName ?? targetId })}
          </p>
        </section>
      ) : (
        <section className={CARD}>
          <h3 className="mb-2 text-sm font-semibold">{t('firmwarePanel.planTitle')}</h3>
          {plan ? (
            <>
              <ul className="space-y-1 font-mono text-xs">
                {plan.files.map((file) => (
                  <li key={file.name} className="flex justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <span className="text-muted shrink-0">
                      0x{file.address.toString(16).padStart(6, '0')}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted mt-2 text-xs">
                {t(`firmwarePanel.offsetSource.${plan.source}`)}
              </p>
            </>
          ) : (
            <p className="text-muted text-xs">{t('firmwarePanel.selectToPlan')}</p>
          )}
        </section>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded bg-sky-700 px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={busy || !plan || needsUf2 || stage === 'loading'}
          onClick={() => void startFlash()}
        >
          {busy ? t('firmwarePanel.flashing') : t('firmwarePanel.flash')}
        </button>
        {busy && (
          <div className="flex-1">
            <div
              className="h-2 w-full overflow-hidden rounded bg-slate-800"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('firmwarePanel.flashing')}
            >
              <div
                className="bg-brand-green h-full transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-muted mt-1 text-xs">{t('firmwarePanel.percent', { percent })}</p>
          </div>
        )}
        {stage === 'done' && (
          <span className="text-sm text-emerald-400">{t('firmwarePanel.done')}</span>
        )}
      </div>

      <p className="text-muted text-xs">{t('firmwarePanel.powerWarning')}</p>
    </div>
  );
}

export default FirmwarePanel;
