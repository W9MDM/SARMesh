/**
 * Alphabetical ordering for the SARMesh radio lists (asset register, APRS
 * roster, and the pickers that feed them).
 *
 * `numeric: true` matters more than it looks: agency tags run `SAR-2`, `SAR-10`,
 * `SAR-14`, and a plain string sort files `SAR-10` before `SAR-2`. A team leader
 * scanning for a unit number needs them in the order the tags imply.
 *
 * `sensitivity: 'base'` keeps case and accents from splitting the list, so
 * `alpha` and `Alpha` land together.
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Compare two display labels in natural, case-insensitive order. */
export function compareNodeLabels(a: string | undefined, b: string | undefined): number {
  const left = a?.trim() ?? '';
  const right = b?.trim() ?? '';
  // An unlabelled entry sorts last rather than jumping to the top of the list.
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return COLLATOR.compare(left, right);
}

/**
 * Sort a copy by the label each item displays, falling back to node number so
 * the order is stable when two radios share a label.
 */
export function sortByNodeLabel<T>(
  items: readonly T[],
  getLabel: (item: T) => string | undefined,
  getNodeId: (item: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const byLabel = compareNodeLabels(getLabel(a), getLabel(b));
    return byLabel !== 0 ? byLabel : getNodeId(a) - getNodeId(b);
  });
}
