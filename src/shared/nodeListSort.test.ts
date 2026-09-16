import { describe, expect, it } from 'vitest';

import { compareNodeLabels, sortByNodeLabel } from './nodeListSort';

describe('compareNodeLabels', () => {
  it('orders alphabetically', () => {
    expect(compareNodeLabels('Alpha', 'Bravo')).toBeLessThan(0);
    expect(compareNodeLabels('Charlie', 'Bravo')).toBeGreaterThan(0);
    expect(compareNodeLabels('Alpha', 'Alpha')).toBe(0);
  });

  it('orders agency tags by their number, not by string order', () => {
    // The whole point: a plain sort puts SAR-10 before SAR-2.
    expect(compareNodeLabels('SAR-2', 'SAR-10')).toBeLessThan(0);
    expect(compareNodeLabels('SAR-14', 'SAR-9')).toBeGreaterThan(0);
  });

  it('does not split a list on case', () => {
    expect(compareNodeLabels('alpha', 'Alpha')).toBe(0);
    expect(compareNodeLabels('bravo', 'Alpha')).toBeGreaterThan(0);
  });

  it('sends unlabelled entries to the end', () => {
    expect(compareNodeLabels(undefined, 'Alpha')).toBeGreaterThan(0);
    expect(compareNodeLabels('Alpha', undefined)).toBeLessThan(0);
    expect(compareNodeLabels(undefined, undefined)).toBe(0);
    expect(compareNodeLabels('   ', 'Alpha')).toBeGreaterThan(0);
  });
});

describe('sortByNodeLabel', () => {
  const rows = [
    { nodeId: 3, label: 'SAR-10' },
    { nodeId: 1, label: 'SAR-2' },
    { nodeId: 2, label: undefined },
    { nodeId: 4, label: 'Base' },
  ];

  it('sorts by label with unlabelled radios last', () => {
    expect(
      sortByNodeLabel(
        rows,
        (r) => r.label,
        (r) => r.nodeId,
      ).map((r) => r.nodeId),
    ).toEqual([4, 1, 3, 2]);
  });

  it('breaks ties on node number so the order does not shuffle between renders', () => {
    const tied = [
      { nodeId: 9, label: 'Alpha' },
      { nodeId: 4, label: 'Alpha' },
    ];
    expect(
      sortByNodeLabel(
        tied,
        (r) => r.label,
        (r) => r.nodeId,
      ).map((r) => r.nodeId),
    ).toEqual([4, 9]);
  });

  it('does not mutate the input', () => {
    const input = [...rows];
    sortByNodeLabel(
      input,
      (r) => r.label,
      (r) => r.nodeId,
    );
    expect(input.map((r) => r.nodeId)).toEqual([3, 1, 2, 4]);
  });
});
