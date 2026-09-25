/**
 * Find-a-node box for the network map.
 *
 * The map draws a marker per positioned node, and a busy mesh puts a few
 * hundred of them on screen at once. Picking one out by eye is not realistic,
 * and clustering hides the one you want inside a count bubble.
 *
 * The search deliberately looks at *every* known node, not only the ones with
 * a marker. About half the nodes in a live mesh have never reported a
 * position, and a search that simply returned nothing for those is
 * indistinguishable from a search that is broken. A node with no fix is listed
 * and labelled as having no position instead.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MeshNode } from '@/renderer/lib/types';
import { sortByNodeLabel } from '@/shared/nodeListSort';
import {
  formatMeshtasticNodeId,
  isPlaceholderLongName,
  meshtasticNodeIdMatchesHexQuery,
} from '@/shared/nodeNameUtils';

/** Enough to scan; more than this and the query needs narrowing anyway. */
const MAX_RESULTS = 40;

/** Close enough to read a callsign off the marker without losing context. */
const FOCUS_ZOOM = 15;

export interface MapNodeSearchProps {
  /** Every known node, including those the map cannot draw. */
  nodes: Map<number, MeshNode>;
  /** Coordinates the map drew each marker at, keyed by node id. */
  mappable: Map<number, { lat: number; lon: number }>;
  onPick: (nodeId: number, pos: { lat: number; lon: number }, zoom: number) => void;
}

/** The name the marker popup shows, so search results match what is on the map. */
export function mapNodeSearchLabel(node: MeshNode): string {
  const long = node.long_name.trim();
  if (long && !isPlaceholderLongName(long, node.node_id)) return long;
  const short = node.short_name.trim();
  if (short) return short;
  return formatMeshtasticNodeId(node.node_id);
}

export function matchesMapNodeQuery(node: MeshNode, query: string, meshcore: boolean): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    node.long_name.toLowerCase().includes(q) ||
    node.short_name.toLowerCase().includes(q) ||
    node.hw_model.toLowerCase().includes(q) ||
    (meshcore
      ? node.node_id.toString(16).includes(q.replace(/^!/, ''))
      : meshtasticNodeIdMatchesHexQuery(node.node_id, q))
  );
}

export default function MapNodeSearch({
  nodes,
  mappable,
  onPick,
  meshcore = false,
}: MapNodeSearchProps & { meshcore?: boolean }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const matched = [...nodes.values()].filter((n) => matchesMapNodeQuery(n, query, meshcore));
    // Positioned nodes first: those are the ones the user can actually be
    // taken to, and burying them under unlocatable ones defeats the search.
    const withPos = matched.filter((n) => mappable.has(n.node_id));
    const withoutPos = matched.filter((n) => !mappable.has(n.node_id));
    return [
      ...sortByNodeLabel(withPos, mapNodeSearchLabel, (n) => n.node_id),
      ...sortByNodeLabel(withoutPos, mapNodeSearchLabel, (n) => n.node_id),
    ].slice(0, MAX_RESULTS);
  }, [nodes, query, mappable, meshcore]);

  const locatableCount = useMemo(
    () => results.filter((n) => mappable.has(n.node_id)).length,
    [results, mappable],
  );

  const pick = useCallback(
    (node: MeshNode) => {
      const pos = mappable.get(node.node_id);
      if (!pos) return;
      onPick(node.node_id, pos, FOCUS_ZOOM);
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    },
    [mappable, onPick],
  );

  return (
    <div className="w-52 sm:w-64">
      <input
        ref={inputRef}
        type="search"
        value={query}
        aria-label={t('mapPanel.search.aria')}
        placeholder={t('mapPanel.search.placeholder')}
        className="bg-deep-black/80 w-full rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 backdrop-blur-sm placeholder:text-gray-500"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setQuery('');
            setOpen(false);
            inputRef.current?.blur();
            return;
          }
          if (e.key === 'Enter') {
            // Enter takes the first result that can actually be shown.
            const first = results.find((n) => mappable.has(n.node_id));
            if (first) pick(first);
          }
        }}
      />

      {open && query.trim() !== '' && (
        <div className="bg-deep-black/95 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-700 backdrop-blur-sm">
          {results.length === 0 ? (
            <p className="text-muted px-3 py-2 text-xs">{t('mapPanel.search.noMatches')}</p>
          ) : (
            <>
              {results.map((node) => {
                const pos = mappable.get(node.node_id);
                const label = mapNodeSearchLabel(node);
                return (
                  <button
                    key={node.node_id}
                    type="button"
                    disabled={!pos}
                    onClick={() => {
                      pick(node);
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-800 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className={pos ? 'truncate text-gray-200' : 'text-muted truncate'}>
                      {label}
                    </span>
                    <span className="text-muted shrink-0 font-mono text-[10px]">
                      {pos ? formatMeshtasticNodeId(node.node_id) : t('mapPanel.search.noPosition')}
                    </span>
                  </button>
                );
              })}
              {locatableCount === 0 && (
                // Every match exists but none can be drawn. Say why, rather
                // than leaving a list of rows that do nothing when clicked.
                <p className="text-muted border-t border-gray-700 px-3 py-2 text-[11px]">
                  {t('mapPanel.search.allUnlocatable')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
