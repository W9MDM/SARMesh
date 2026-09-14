import {
  Ambulance,
  Car,
  Dog,
  Flag,
  Footprints,
  Helicopter,
  House,
  PersonStanding,
  Plane,
  RadioTower,
  Ship,
  Tractor,
  Truck,
} from 'lucide-react-motion';

import { getTrackerType, type TrackerIconName } from '@/shared/tracker-types';

/**
 * lucide-react-motion icons take their own prop type rather than plain SVG
 * attributes, so the map is typed from one of the components instead of being
 * hand-declared.
 */
type IconComponent = typeof PersonStanding;
type TrackerIconExtraProps = Omit<Parameters<IconComponent>[0], 'ref'>;

/**
 * Tracker icons are addressed by name in shared config, so the mapping from
 * name to component lives here rather than in the shared module — the shared
 * module must stay free of renderer imports.
 */
const ICONS: Record<TrackerIconName, IconComponent> = {
  PersonStanding,
  Dog,
  Footprints,
  Tractor,
  Car,
  Truck,
  Ambulance,
  Helicopter,
  Plane,
  Ship,
  Flag,
  House,
  RadioTower,
};

export interface TrackerIconProps extends TrackerIconExtraProps {
  /** Tracker type id; an unknown value falls back to the ground-team icon. */
  trackerType: string | undefined;
}

/** Renders the icon for a tracker type, on the map and in roster lists. */
export function TrackerIcon({ trackerType, ...props }: TrackerIconProps): React.JSX.Element {
  const Icon = ICONS[getTrackerType(trackerType).icon];
  return <Icon aria-hidden {...props} />;
}

export default TrackerIcon;
