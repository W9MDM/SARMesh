/**
 * Tracker types: what a tracked radio *is* in the field.
 *
 * One operator choice drives two things that would otherwise be configured
 * separately:
 *
 *  - the **APRS symbol** sent to CalTopo / SARTopo and any other APRS consumer
 *  - the **map icon** drawn in SARMesh's own map and node lists
 *
 * Keeping them in one table means a K9 team looks like a dog everywhere, and
 * an operator never has to know what `/p` means.
 *
 * APRS symbol codes are from the APRS Protocol Reference 1.0.1 primary table
 * (table id `/`). They are what other APRS software renders, so they are not
 * free to change once teams are relying on them.
 */

export const TRACKER_TYPE_IDS = [
  'ground-team',
  'k9-team',
  'hasty-team',
  'utv',
  'vehicle',
  'truck',
  'ambulance',
  'helicopter',
  'aircraft',
  'boat',
  'command-post',
  'base',
  'repeater',
] as const;

export type TrackerTypeId = (typeof TRACKER_TYPE_IDS)[number];

/** Icon names, resolved against lucide in the renderer. */
export type TrackerIconName =
  | 'PersonStanding'
  | 'Dog'
  | 'Footprints'
  | 'Tractor'
  | 'Car'
  | 'Truck'
  | 'Ambulance'
  | 'Helicopter'
  | 'Plane'
  | 'Ship'
  | 'Flag'
  | 'House'
  | 'RadioTower';

export interface TrackerType {
  id: TrackerTypeId;
  /** APRS symbol table id; `/` is the primary table. */
  symbolTable: string;
  /** APRS symbol code within that table. */
  symbolCode: string;
  /** Icon drawn on the map and in lists. */
  icon: TrackerIconName;
  /** i18n key under `aprsPanel.trackerType`. */
  labelKey: TrackerTypeId;
}

export const TRACKER_TYPES: readonly TrackerType[] = [
  // `[` is "jogger / human" — the standard APRS symbol for a person on foot.
  {
    id: 'ground-team',
    symbolTable: '/',
    symbolCode: '[',
    icon: 'PersonStanding',
    labelKey: 'ground-team',
  },
  // `p` is "rover (puppy)", the conventional APRS symbol for a dog team.
  { id: 'k9-team', symbolTable: '/', symbolCode: 'p', icon: 'Dog', labelKey: 'k9-team' },
  {
    id: 'hasty-team',
    symbolTable: '/',
    symbolCode: 'b',
    icon: 'Footprints',
    labelKey: 'hasty-team',
  },
  // `j` is "jeep"; the closest standard symbol for a UTV/ATV.
  { id: 'utv', symbolTable: '/', symbolCode: 'j', icon: 'Tractor', labelKey: 'utv' },
  { id: 'vehicle', symbolTable: '/', symbolCode: '>', icon: 'Car', labelKey: 'vehicle' },
  { id: 'truck', symbolTable: '/', symbolCode: 'k', icon: 'Truck', labelKey: 'truck' },
  { id: 'ambulance', symbolTable: '/', symbolCode: 'a', icon: 'Ambulance', labelKey: 'ambulance' },
  {
    id: 'helicopter',
    symbolTable: '/',
    symbolCode: 'X',
    icon: 'Helicopter',
    labelKey: 'helicopter',
  },
  { id: 'aircraft', symbolTable: '/', symbolCode: "'", icon: 'Plane', labelKey: 'aircraft' },
  { id: 'boat', symbolTable: '/', symbolCode: 's', icon: 'Ship', labelKey: 'boat' },
  { id: 'command-post', symbolTable: '/', symbolCode: 'W', icon: 'Flag', labelKey: 'command-post' },
  // `-` is "house / QTH", which is how a fixed incident base is normally shown.
  { id: 'base', symbolTable: '/', symbolCode: '-', icon: 'House', labelKey: 'base' },
  // `#` is "digipeater", the right symbol for a deployed relay node.
  { id: 'repeater', symbolTable: '/', symbolCode: '#', icon: 'RadioTower', labelKey: 'repeater' },
];

const BY_ID = new Map<TrackerTypeId, TrackerType>(TRACKER_TYPES.map((type) => [type.id, type]));

export const DEFAULT_TRACKER_TYPE_ID: TrackerTypeId = 'ground-team';

export function getTrackerType(id: string | undefined): TrackerType {
  const found = id ? BY_ID.get(id as TrackerTypeId) : undefined;
  // An unknown id (older config, hand-edited file) degrades to a ground team
  // rather than leaving a tracker with no symbol at all.
  return found ?? BY_ID.get(DEFAULT_TRACKER_TYPE_ID)!;
}

export function isTrackerTypeId(value: unknown): value is TrackerTypeId {
  return typeof value === 'string' && BY_ID.has(value as TrackerTypeId);
}

/**
 * Resolve the APRS symbol for a tracker. An explicit symbol override wins, so a
 * team that needs a symbol outside this table is not blocked by it.
 */
export function resolveSymbol(
  trackerType: string | undefined,
  overrideTable?: string,
  overrideCode?: string,
): { symbolTable: string; symbolCode: string } {
  if (overrideTable && overrideCode) {
    return { symbolTable: overrideTable, symbolCode: overrideCode };
  }
  const type = getTrackerType(trackerType);
  return { symbolTable: type.symbolTable, symbolCode: type.symbolCode };
}
