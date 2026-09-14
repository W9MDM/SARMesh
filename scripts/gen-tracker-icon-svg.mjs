#!/usr/bin/env node
/**
 * Regenerate src/renderer/lib/trackerIconSvg.ts from lucide's icon data.
 *
 * Map markers are built as inline SVG strings for Leaflet, so they cannot reuse
 * the React icon components. Extracting the geometry from the same package
 * keeps a K9 team's map marker identical to its icon in the roster, instead of
 * two hand-drawn shapes that drift apart.
 *
 * Run after changing TRACKER_ICON_NAMES or upgrading lucide:
 *   node scripts/gen-tracker-icon-svg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LUCIDE = path.join(ROOT, 'node_modules', 'lucide-react-motion', 'dist', 'index.js');
const OUT = path.join(ROOT, 'src', 'renderer', 'lib', 'trackerIconSvg.ts');

/** Keep in sync with TrackerIconName in src/shared/tracker-types.ts. */
const ICON_NAMES = [
  'PersonStanding',
  'Dog',
  'Footprints',
  'Tractor',
  'Car',
  'Truck',
  'Ambulance',
  'Helicopter',
  'Plane',
  'Ship',
  'Flag',
  'House',
  'RadioTower',
];

const src = fs.readFileSync(LUCIDE, 'utf8');

/** Pull one icon's `[tag, attrs]` node array out of the bundle. */
function extractNodes(name) {
  const fnIdx = src.indexOf(`function ${name}(props)`);
  if (fnIdx === -1) throw new Error(`${name}: component not found in lucide bundle`);

  const ref = /nodes:\s*(nodes\d+)/.exec(src.slice(fnIdx, fnIdx + 300));
  if (!ref) throw new Error(`${name}: could not resolve its nodes reference`);

  const declIdx = src.lastIndexOf(`var ${ref[1]} = `, fnIdx);
  if (declIdx === -1) throw new Error(`${name}: nodes declaration not found`);

  const start = src.indexOf('[', declIdx);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) return JSON.parse(src.slice(start, i + 1));
    }
  }
  throw new Error(`${name}: unbalanced nodes array`);
}

const entries = ICON_NAMES.map((name) => {
  const markup = extractNodes(name)
    .map(
      ([tag, attrs]) =>
        `<${tag} ${Object.entries(attrs)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')}/>`,
    )
    .join('');
  return `  ${name}: '${markup.replace(/'/g, "\\'")}',`;
});

const file = `/**
 * Inline SVG geometry for tracker icons, so map markers use exactly the same
 * shapes as the lucide icons rendered elsewhere in the UI.
 *
 * GENERATED from lucide-react-motion's icon node data — see
 * scripts/gen-tracker-icon-svg.mjs. Each value is the inner markup of a 24x24
 * stroke icon: draw it with fill="none" and an explicit stroke.
 */
import type { TrackerIconName } from '@/shared/tracker-types';

export const TRACKER_ICON_SVG: Record<TrackerIconName, string> = {
${entries.join('\n')}
};
`;

fs.writeFileSync(OUT, file);
console.log(`Wrote ${ICON_NAMES.length} tracker icons to ${path.relative(ROOT, OUT)}`);
