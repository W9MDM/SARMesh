import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MeshNode } from '../../lib/types';
import MapNodeSearch, { mapNodeSearchLabel, matchesMapNodeQuery } from './MapNodeSearch';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function node(partial: Partial<MeshNode> & { node_id: number }): MeshNode {
  return {
    long_name: '',
    short_name: '',
    hw_model: '',
    snr: 0,
    battery: 0,
    last_heard: 0,
    latitude: null,
    longitude: null,
    ...partial,
  };
}

const ALPHA = node({ node_id: 0x1111_1111, long_name: 'Alpha Base', short_name: 'ALFA' });
const BRAVO = node({ node_id: 0x2222_2222, long_name: 'Bravo Ridge', short_name: 'BRVO' });
// Firmware default: an unconfigured radio names itself after its own id.
const UNSET = node({ node_id: 0x8f58_8f58, long_name: '!8f588f58', short_name: '8f58' });

function renderSearch(
  nodes: MeshNode[],
  mappable: Map<number, { lat: number; lon: number }>,
  onPick = vi.fn(),
) {
  render(
    <MapNodeSearch
      nodes={new Map(nodes.map((n) => [n.node_id, n]))}
      mappable={mappable}
      onPick={onPick}
    />,
  );
  return onPick;
}

describe('mapNodeSearchLabel', () => {
  it('prefers the long name', () => {
    expect(mapNodeSearchLabel(ALPHA)).toBe('Alpha Base');
  });

  it('falls back to the short name when the long name is the id placeholder', () => {
    // Otherwise the list shows "!8f588f58" twice over, name and id column alike.
    expect(mapNodeSearchLabel(UNSET)).toBe('8f58');
  });

  it('falls back to the formatted id when the node has no names at all', () => {
    expect(mapNodeSearchLabel(node({ node_id: 0x00ab_cdef }))).toBe('!00abcdef');
  });
});

describe('matchesMapNodeQuery', () => {
  it('matches on long name, short name and hardware, case-insensitively', () => {
    expect(matchesMapNodeQuery(ALPHA, 'alpha', false)).toBe(true);
    expect(matchesMapNodeQuery(ALPHA, 'ALFA', false)).toBe(true);
    expect(matchesMapNodeQuery(BRAVO, 'alpha', false)).toBe(false);
  });

  it('matches a hex id with or without the leading bang', () => {
    expect(matchesMapNodeQuery(ALPHA, '!11111111', false)).toBe(true);
    expect(matchesMapNodeQuery(ALPHA, '1111', false)).toBe(true);
  });

  it('never matches on an empty query', () => {
    expect(matchesMapNodeQuery(ALPHA, '   ', false)).toBe(false);
  });
});

describe('MapNodeSearch', () => {
  it('flies to the picked node using the coordinates the map drew it at', async () => {
    const user = userEvent.setup();
    const mappable = new Map([[ALPHA.node_id, { lat: 41.5, lon: -87.3 }]]);
    const onPick = renderSearch([ALPHA, BRAVO], mappable);

    await user.type(screen.getByRole('searchbox'), 'alpha');
    await user.click(screen.getByRole('button', { name: /Alpha Base/ }));

    expect(onPick).toHaveBeenCalledWith(ALPHA.node_id, { lat: 41.5, lon: -87.3 }, 15);
  });

  it('lists a node with no position and refuses to fly to it', async () => {
    const user = userEvent.setup();
    // Roughly half a real mesh looks like this. Returning nothing for such a
    // node is indistinguishable from a broken search, so it is listed instead.
    const onPick = renderSearch([BRAVO], new Map());

    await user.type(screen.getByRole('searchbox'), 'bravo');

    const row = screen.getByRole('button', { name: /Bravo Ridge/ });
    expect(row).toBeDisabled();
    await user.click(row);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText('mapPanel.search.allUnlocatable')).toBeInTheDocument();
  });

  it('orders positioned nodes ahead of unlocatable ones', async () => {
    const user = userEvent.setup();
    // "Alpha" sorts first alphabetically but cannot be shown; the node the
    // user can actually be taken to has to come first.
    const mappable = new Map([[BRAVO.node_id, { lat: 1, lon: 2 }]]);
    renderSearch([ALPHA, BRAVO], mappable);

    await user.type(screen.getByRole('searchbox'), 'a');

    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels[0]).toContain('Bravo Ridge');
    expect(labels[1]).toContain('Alpha Base');
  });

  it('picks the first locatable match on Enter', async () => {
    const user = userEvent.setup();
    const mappable = new Map([[BRAVO.node_id, { lat: 1, lon: 2 }]]);
    const onPick = renderSearch([ALPHA, BRAVO], mappable);

    await user.type(screen.getByRole('searchbox'), 'a{Enter}');

    expect(onPick).toHaveBeenCalledWith(BRAVO.node_id, { lat: 1, lon: 2 }, 15);
  });

  it('shows nothing until something is typed', () => {
    renderSearch([ALPHA], new Map([[ALPHA.node_id, { lat: 1, lon: 2 }]]));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reports when a query matches no node at all', async () => {
    const user = userEvent.setup();
    renderSearch([ALPHA], new Map());

    await user.type(screen.getByRole('searchbox'), 'zulu');

    expect(screen.getByText('mapPanel.search.noMatches')).toBeInTheDocument();
  });
});
