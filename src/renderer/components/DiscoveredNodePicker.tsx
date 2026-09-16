import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { InventoryNode } from '@/shared/inventory-types';
import type { DiscoveredNode } from '@/shared/mdns-types';
import { compareNodeLabels } from '@/shared/nodeListSort';

export interface DiscoveredNodePickerProps {
  nodes: DiscoveredNode[];
  browsing: boolean;
  error?: string;
  /** Register entries, so a found radio can be shown by its asset tag. */
  inventory?: InventoryNode[];
  /**
   * False for the HTTP form, whose address field takes a bare host — the web
   * server is on 80/443, not the 4403 the mDNS record advertises.
   */
  includePort?: boolean;
  /** Called with the address ready to drop into the address field. */
  onSelect: (address: string) => void;
  onRefresh: () => void;
}

/** `SAR-014` / `Alpha Team` from the register, when this radio is one of ours. */
function registerLabel(
  node: DiscoveredNode,
  inventory: InventoryNode[] | undefined,
): string | null {
  if (node.nodeNum === undefined || !inventory?.length) return null;
  const match = inventory.find((entry) => entry.nodeId === node.nodeNum);
  if (!match) return null;
  return match.assetTag ?? match.label ?? match.assignedTo ?? null;
}

/**
 * Lists Meshtastic radios found on the local link.
 *
 * Meshtastic firmware advertises `_meshtastic._tcp` with `shortname`, `id` and
 * `pio_env` TXT records, so every row can be identified before connecting —
 * which matters at a staging area where a dozen radios are on the same AP and
 * their addresses are whatever DHCP handed out.
 */
export default function DiscoveredNodePicker({
  nodes,
  browsing,
  error,
  inventory,
  includePort = true,
  onSelect,
  onRefresh,
}: DiscoveredNodePickerProps) {
  const { t } = useTranslation();

  // Main already sorts, but a browse arrives one announcement at a time — the
  // list must not depend on which radio answered the multicast query first.
  const sortedNodes = useMemo(
    () =>
      [...nodes].sort((a, b) =>
        compareNodeLabels(a.shortName ?? a.instance, b.shortName ?? b.instance),
      ),
    [nodes],
  );

  return (
    <div className="space-y-1" role="group" aria-label={t('connectionPanel.discovery.title')}>
      <div className="flex items-center justify-between">
        <span className="text-muted text-xs">{t('connectionPanel.discovery.title')}</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-brand-green rounded px-1.5 py-0.5 text-xs hover:underline focus:outline-none"
        >
          {t('connectionPanel.discovery.rescan')}
        </button>
      </div>

      {error != null && error !== '' && (
        <p className="text-xs text-yellow-400">
          {t('connectionPanel.discovery.error', { message: error })}
        </p>
      )}

      {nodes.length === 0 ? (
        <p className="text-muted text-xs">
          {browsing
            ? t('connectionPanel.discovery.searching')
            : t('connectionPanel.discovery.idle')}
        </p>
      ) : (
        <ul className="space-y-1">
          {sortedNodes.map((node) => {
            const known = registerLabel(node, inventory);
            const address = includePort ? `${node.host}:${node.port}` : node.host;
            return (
              <li key={node.instance}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(address);
                  }}
                  className="bg-secondary-dark/40 hover:border-brand-green flex w-full items-center justify-between gap-2 rounded border border-gray-600/50 px-2 py-1.5 text-left text-xs text-gray-200 focus:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{node.shortName ?? node.instance}</span>
                    {known != null && <span className="text-brand-green ml-1.5">{known}</span>}
                    {node.hardware != null && (
                      <span className="text-muted ml-1.5">{node.hardware}</span>
                    )}
                  </span>
                  <span className="text-muted shrink-0 font-mono">{address}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-muted text-xs">{t('connectionPanel.discovery.scopeHint')}</p>
    </div>
  );
}
