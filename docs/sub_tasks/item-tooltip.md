# Sub-Task: Item Stat Tooltip

## Goal
A reusable DOM-overlay tooltip that renders an item's name, slot, and stat
lines in the dark-fantasy style (parchment text on near-black), positioned
beside the hovered element, clamped to the viewport.

## Files you may touch
- NEW: `src/ui/Tooltip.ts` (create the `src/ui/` directory)
- NEW: `src/ui/tooltip.css` (imported from the module)
- `docs/checklist.md`, `docs/development_log.md`

## Design constraints
- Pure presentation: reads an `ItemSnapshot` (see
  `src/network/Serialization.ts`) plus a display-stats object; performs ZERO
  game-state reads or writes. No EventBus events needed.
- DOM overlay (like the existing `#hud`), not Pixi — text quality and layout
  are better and it never interferes with the world render.
- API contract:
  ```ts
  showTooltip(anchor: {x: number; y: number}, item: ItemSnapshot, stats: Record<string, string>): void
  hideTooltip(): void
  ```
- Single reused DOM node (create once, toggle visibility) — no per-show
  allocation.
- Colors from the dark-fantasy palette: bg `#0d0c10ee`, border `#3a3444`,
  title `#c9b98a`, stats `#9a8f7a`.

## Acceptance
- Demo call wired behind a `?tooltipDemo` URL flag in `main.ts` is acceptable
  for verification, but must be removed or gated before merge. Typecheck clean.
