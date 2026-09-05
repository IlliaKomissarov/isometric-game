# Adaptive HUD layout (it.63–66)

How the game fits one HUD to every screen in the device matrix, and the
rules a change must keep.

## The spine: `src/core/OrientationManager.ts`

One computation, one source of truth. Every reflow (resize, rotation,
`visualViewport`, `matchMedia`) recomputes a `LayoutState` and publishes it
as CSS custom properties and body classes. Nothing else measures the window.

| Output | Meaning |
| --- | --- |
| `--app-w`, `--app-h`, `--stage-h`, `--pad-h` | The viewport, the canvas box, the portrait control pad |
| `--hud-scale` | The touch furniture's scale (stick, buttons) |
| `--tl-scale` | The status plate's scale (`plateScale`) |
| `--sb-size` | The system bar's target size, 48 or 44 px |
| `--hud-inset` | The ultrawide 16:9 clamp, 0 below 21:9 |
| `orient-*`, `tier-*`, `has-pad`, `short-screen`, `input-touch` | Discrete layout classes |
| `bar-row` / `bar-grid3` / `bar-grid2` | How the system bar folds |
| `stageZoom` (state only) | The camera's layout zoom bias |

Rules:

- **Numbers that CSS cannot derive are computed here.** `scale()` takes a
  number and CSS cannot divide a length by a length, so the plate scale and
  the bar form are decided in TypeScript. If a layout needs a ratio, add it
  to `LayoutState`; do not approximate it with `vw` maths in CSS.
- **The tier is judged on the short edge**, so it is rotation-stable. A
  phone is the same phone either way up.
- **The pad exists only for a touch phone in portrait** (short edge < 600).
  A tablet held upright floats its controls over a full-height canvas.
- **Body classes must not collide with existing component classes.** The
  bar forms are `bar-*` because the settings sheet already owns `.sb-row`;
  the first cut used `sb-row` and gave the body an 8px 12px padding, which
  showed up as a 25 px overflow on every device in the matrix.

## The corners

- Top-left `#hud-tl`: a flex column — status plate, buffs, party roster,
  stat line, depth, timer. Elements are adopted into it by `StatusFrame`
  and laid out, never pinned; the column cannot overlap itself at any
  scale. It scales as a whole by `--tl-scale`.
- Top-right `#hud-tr`: minimap over the system bar. The bar folds instead
  of hiding: six entries on every screen (inventory, talents, hero,
  bestiary, menu, fullscreen), a row on wide free edges, 3x2 on short or
  micro screens, 2x3 beside the pad. Hiding an entry is the it.65 bug.
- Bottom corners: the thumb stick (left) and the skill arc (right). With a
  pad, no thumb control may reach above `--stage-h`.
- The centre is the fight. No static HUD element may have its centre in
  the middle 60% of the screen, and none may touch the middle 40%.

## Panels: `src/ui/FitScaler.ts`

`scale = min(1, 0.92·w / naturalW, 0.90·h / naturalH)`, floored per panel;
below the floor the panel scrolls inside itself. `.tp-close` divides the
panel's `--fit-scale` back out so the close target stays 44 px real. Fits
are driven by the layout, resizes, openers and a 450 ms heartbeat — never
by observers (they fed back into their own writes on a hidden page).

## Verifying

```
await import('/src/dev/qa66.ts'); __qa66(true)
```

drives `layout.simulate()` over 33 devices × 2 orientations and asserts:
no document scroll, no overflow, 44 px targets (84 px attack), no
control/control, HUD/control or HUD/HUD overlap (round controls compared
centre-to-centre), the corridor rules, six bar entries, a legible plate,
and no thumb control above the pad. It must report `failed: 0`.

Measuring a transformed control in a hidden tab: CSS transitions never
advance there (`getAnimations()` shows one nameless entry stuck at t=0),
so inject `.tp-close { transition: none !important }` before reading a
box, or the 44 px close mark measures as its pre-fit size.

Screenshots of a tall simulated viewport on a short window: set
`document.body.style.zoom` for the capture only, never while measuring —
`getBoundingClientRect` returns zoomed coordinates.
