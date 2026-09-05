/**
 * @module ui/icons
 * THE ICON SET (it.66): hand-built SVG marks for the dark-fantasy system.
 *
 * Every icon is a single path family on a 24x24 grid, drawn with
 * `currentColor` so one button style can tint its mark for the resting, hot
 * and pressed states without a second asset. Vectors rather than glyphs
 * because an emoji is a different picture in every browser and a different
 * WIDTH in every font — the one thing a 48 px target cannot survive.
 *
 * Stroke weight is a constant 1.6 at 24 px: heavy enough to read at 20 px on
 * a phone, fine enough not to blot at 48 px on a desktop.
 */

const svg = (body: string): string =>
  `<svg class="ds-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

/** A backpack: flap, buckle and side straps. The bag. */
export const ICON_PACK = svg(
  '<path d="M6 9.5a6 6 0 0 1 12 0v9.2a1.8 1.8 0 0 1-1.8 1.8H7.8A1.8 1.8 0 0 1 6 18.7z"/>' +
    '<path d="M9.2 9.2V7a2.8 2.8 0 0 1 5.6 0v2.2"/>' +
    '<path d="M6.2 13.6h11.6"/><path d="M10.6 16.4h2.8"/>',
);

/** A talent tree: a trunk that forks twice, with nodes on the branches. */
export const ICON_TREE = svg(
  '<path d="M12 21v-6.4"/><path d="M12 14.6 8 11.2"/><path d="M12 14.6 16 11.2"/>' +
    '<path d="M8 11.2V8.6"/><path d="M16 11.2V8.6"/>' +
    '<circle cx="12" cy="16.6" r="1.7"/><circle cx="8" cy="7" r="1.7"/><circle cx="16" cy="7" r="1.7"/>' +
    '<path d="M9.7 7h4.6"/>',
);

/** A bestiary: a skull set into an open codex. */
export const ICON_BESTIARY = svg(
  '<path d="M3.4 6.2h6.1a2.5 2.5 0 0 1 2.5 2.5v11a2.1 2.1 0 0 0-2.1-2.1H3.4z"/>' +
    '<path d="M20.6 6.2h-6.1A2.5 2.5 0 0 0 12 8.7v11a2.1 2.1 0 0 1 2.1-2.1h6.5z"/>' +
    '<path d="M12 8.7v11"/>' +
    '<path d="M9.6 12.4a2.6 2.6 0 1 1 5.2 0c0 1.1-.7 1.5-.7 2.3h-3.8c0-.8-.7-1.2-.7-2.3z"/>' +
    '<path d="M11 12.5h.01"/><path d="M13.4 12.5h.01"/>',
);

/** A cog: eight teeth around a hollow hub. Settings, and the pause it opens. */
export const ICON_COG = svg(
  // The RING is what makes a cog a cog. Without it the eight teeth read as
  // a sun — which is exactly how the first cut of this icon looked.
  '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M12 3.4v2.1M12 18.5v2.1M20.6 12h-2.1M5.5 12H3.4M18.08 5.92l-1.48 1.48M7.4 16.6l-1.48 1.48M18.08 18.08 16.6 16.6M7.4 7.4 5.92 5.92"/>',
);

/** A map: three folded panels with a route across them. */
export const ICON_MAP = svg(
  '<path d="M3.4 6.6 9 4.4v13L3.4 19.6z"/><path d="M9 4.4l6 2.2v13L9 17.4z"/><path d="M15 6.6l5.6-2.2v13L15 19.6z"/>',
);

/** A crossed pair of blades: the attack. */
export const ICON_BLADES = svg(
  '<path d="M4.6 4.6 14 14M14 14l1.6 1.6a2.3 2.3 0 1 1-1.6 1.6z"/>' +
    '<path d="M19.4 4.6 10 14M10 14l-1.6 1.6a2.3 2.3 0 1 0 1.6 1.6z"/>',
);

/** A stoppered draught. Filled by the button's own colour. */
export const ICON_FLASK = svg(
  '<path d="M10.2 3.4h3.6v3.1l3.1 8.4a3.4 3.4 0 0 1-3.2 4.6h-3.4a3.4 3.4 0 0 1-3.2-4.6l3.1-8.4z"/>' +
    '<path d="M8.2 14.2h7.6"/><path d="M9.4 3.4h5.2"/>',
);

/** A hand reaching: the interact. */
export const ICON_HAND = svg(
  '<path d="M9 11.4V5.6a1.5 1.5 0 0 1 3 0v5.2"/>' +
    '<path d="M12 10.4V4.9a1.5 1.5 0 0 1 3 0v6"/>' +
    '<path d="M15 10.9V7.4a1.5 1.5 0 0 1 3 0v7.4a5.6 5.6 0 0 1-5.6 5.6h-1a4.6 4.6 0 0 1-3.6-1.8l-2.5-3.3a1.6 1.6 0 0 1 2.4-2.1L9 14.6"/>',
);

/** A home rune: the town portal. */
export const ICON_PORTAL = svg(
  '<path d="M4.4 11.2 12 4.6l7.6 6.6"/><path d="M6.4 12.6v6.2a1 1 0 0 0 1 1h9.2a1 1 0 0 0 1-1v-6.2"/>' +
    '<path d="M10.2 19.8v-4.4h3.6v4.4"/>',
);

/** Two stacked bars: pause. */
export const ICON_PAUSE = svg('<path d="M9.4 5.4v13.2M14.6 5.4v13.2"/>');

/** A helm over shoulders: the hero sheet. */
export const ICON_HERO = svg(
  '<path d="M7.2 11.2V8.6a4.8 4.8 0 0 1 9.6 0v2.6"/>' +
    '<path d="M7.2 11.2h9.6v2.2a4.8 4.8 0 0 1-9.6 0z"/>' +
    '<path d="M12 6.2v7.2"/><path d="M9.6 11.2h4.8"/>' +
    '<path d="M4.4 20.6a7.6 7.6 0 0 1 15.2 0"/>',
);

/** Four carved corner brackets: the universal "expand" mark. */
export const ICON_FULLSCREEN = svg(
  '<path d="M4.4 9.4V4.4h5"/><path d="M14.6 4.4h5v5"/>' +
    '<path d="M19.6 14.6v5h-5"/><path d="M9.4 19.6h-5v-5"/>',
);
