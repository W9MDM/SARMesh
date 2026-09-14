import { describe, expect, it } from 'vitest';

import { TRACKER_TYPES, type TrackerIconName } from '@/shared/tracker-types';

import { TRACKER_ICON_SVG } from './trackerIconSvg';

describe('TRACKER_ICON_SVG', () => {
  it('has geometry for every icon a tracker type can ask for', () => {
    // A missing entry would silently drop the glyph and draw a bare marker, so
    // this is the guard against adding a tracker type without regenerating.
    for (const type of TRACKER_TYPES) {
      expect(TRACKER_ICON_SVG[type.icon], `missing SVG for ${type.icon}`).toBeTruthy();
    }
  });

  it('contains only drawable SVG shape elements', () => {
    // The markup is interpolated straight into a marker's SVG, so anything that
    // is not a shape element would either not render or be a injection vector.
    const allowed = /^(path|circle|rect|line|polyline|polygon|ellipse)$/;
    for (const [name, markup] of Object.entries(TRACKER_ICON_SVG)) {
      const tags = [...markup.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]);
      expect(tags.length, `${name} has no shapes`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag, `${name} contains <${tag}>`).toMatch(allowed);
      }
    }
  });

  it('carries no stroke or fill of its own, so the marker controls colour', () => {
    for (const [name, markup] of Object.entries(TRACKER_ICON_SVG)) {
      expect(markup, `${name} hardcodes a colour`).not.toMatch(/\b(?:fill|stroke)=/);
    }
  });

  it('has no unescaped quote that could break the attribute it sits in', () => {
    for (const [name, markup] of Object.entries(TRACKER_ICON_SVG)) {
      const quotes = (markup.match(/"/g) ?? []).length;
      expect(quotes % 2, `${name} has an unbalanced quote`).toBe(0);
    }
  });

  it('covers each distinct icon name exactly once', () => {
    const names = TRACKER_TYPES.map((type) => type.icon);
    const distinct = new Set<TrackerIconName>(names);
    expect(Object.keys(TRACKER_ICON_SVG).sort()).toEqual([...distinct].sort());
  });
});
