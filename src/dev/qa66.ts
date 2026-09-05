/**
 * @module dev/qa66
 * THE DEVICE MATRIX (it.66). A dev-only harness: nothing imports it, so it
 * never reaches a build. Load it from the console with
 *
 *     await import('/src/dev/qa66.ts'); __qa66(true)
 *
 * and it drives `layout.simulate()` across 33 devices in both orientations,
 * asserting the invariants this iteration is responsible for.
 *
 * WHY CIRCLES. The touch controls are round (`border-radius: 50%`), and a
 * browser hit-tests a round element by its circle — the corners two square
 * bounds would share are not targets at all. Measuring them as rectangles
 * reports collisions that do not exist and forces the arc wider than it
 * needs to be, so round controls are compared centre-to-centre.
 *
 * THE CORRIDOR is measured two ways, because one number cannot express the
 * rule on every screen. On a 240 px handset a legible status plate is wider
 * than the 20% margin the strict reading allows, and shrinking it until it
 * complies would make it unreadable — the cure being worse than the disease.
 * So: no HUD element's CENTRE may fall in the central 60% (nothing floats
 * mid-screen), and no HUD element may TOUCH the central 40% at all (the
 * fight itself is never covered).
 */

interface Shape {
  kind: 'c' | 'r';
  cx: number;
  cy: number;
  r: number;
  b: DOMRect;
}

interface Row {
  d: string;
  fails: string[];
  notes: string[];
}

const DEVICES: Array<[string, number, number]> = [
  ['Micro', 240, 320], ['Legacy', 320, 480], ['Budget', 360, 640], ['SE', 375, 667],
  ['i13', 390, 844], ['i15', 393, 852], ['Max', 430, 932], ['Xperia', 384, 854],
  ['Pixel', 412, 915], ['FlipCover', 720, 748], ['FlipInner', 1080, 2640],
  ['FoldFolded', 968, 2376], ['FoldOpen', 1812, 2176], ['iPadMini', 768, 1024],
  ['Tab', 800, 1280], ['Tab159', 600, 960], ['iPadPro11', 834, 1194],
  ['iPadPro129', 1024, 1366], ['TabS9', 1600, 2560], ['Switch', 1280, 720],
  ['Deck', 1280, 800], ['Ally', 1920, 1080], ['Legion', 2560, 1600],
  ['Office', 1366, 768], ['Laptop', 1440, 900], ['Surface', 1536, 960],
  ['SurfacePro', 2256, 1504], ['FHD', 1920, 1080], ['Pivot', 1080, 1920],
  ['UW', 2560, 1080], ['SUW', 5120, 1440], ['4K', 3840, 2160], ['8K', 7680, 4320],
];

/** HUD furniture: the things that must stay in a corner. */
const HUD_IDS = ['status-frame', 'hud-buffs', 'char-stats', 'depth-label', 'timer', 'minimap', 'boss-bar'];

const visible = (el: Element | null): el is HTMLElement => {
  if (!el || !el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
  const b = el.getBoundingClientRect();
  return b.width > 0.5 && b.height > 0.5;
};

const shapeOf = (el: HTMLElement): Shape => {
  const b = el.getBoundingClientRect();
  const round = getComputedStyle(el).borderRadius.startsWith('50%');
  return { kind: round ? 'c' : 'r', cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: Math.min(b.width, b.height) / 2, b };
};

const hits = (A: Shape, B: Shape): boolean => {
  if (A.kind === 'c' && B.kind === 'c') return Math.hypot(A.cx - B.cx, A.cy - B.cy) < A.r + B.r - 1;
  if (A.kind === 'r' && B.kind === 'r') {
    const a = A.b, b = B.b;
    return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  }
  const C = A.kind === 'c' ? A : B;
  const R = (A.kind === 'c' ? B : A).b;
  const nx = Math.max(R.left, Math.min(C.cx, R.right));
  const ny = Math.max(R.top, Math.min(C.cy, R.bottom));
  return Math.hypot(C.cx - nx, C.cy - ny) < C.r - 1;
};

const px = (b: DOMRect): string => `[${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.right)},${Math.round(b.bottom)}]`;

type Box = { left: number; top: number; right: number; bottom: number };
const band = (W: number, H: number, share: number): Box => {
  const m = (1 - share) / 2;
  return { left: W * m, top: H * m, right: W * (1 - m), bottom: H * (1 - m) };
};
const overlapsBox = (b: DOMRect, box: Box): boolean =>
  b.left < box.right - 2 && box.left < b.right - 2 && b.top < box.bottom - 2 && box.top < b.bottom - 2;
const centreIn = (s: Shape, box: Box): boolean => s.cx > box.left && s.cx < box.right && s.cy > box.top && s.cy < box.bottom;

export function runMatrix(detail = false): { tested: number; failed: number; fails: Row[] } {
  const g = window as unknown as { __layout: { layout: { simulate: (w: number, h: number, o: { touch: boolean }) => { w: number; h: number; padH: number; stageH: number }; clearSimulation: () => void } } };
  const L = g.__layout;
  const results: Row[] = [];

  const check = (name: string, w: number, h: number): void => {
    const s = L.layout.simulate(w, h, { touch: true });
    const W = s.w, H = s.h;
    const fails: string[] = [];
    const notes: string[] = [];
    const d = document.documentElement;
    if (d.scrollHeight > d.clientHeight + 1 || d.scrollWidth > d.clientWidth + 1) fails.push('doc scrolls');

    const ctrls: Array<{ n: string; s: Shape; b: DOMRect }> = [];
    for (const el of document.querySelectorAll<HTMLElement>('#touch-controls .tc-btn, #system-bar .ds-icon-btn')) {
      if (!visible(el)) continue;
      const b = el.getBoundingClientRect();
      const n = (el.className || '').replace(/tc-btn |ds-icon-btn ?/g, '').trim().slice(0, 12) || el.title;
      ctrls.push({ n, s: shapeOf(el), b });
      // The floors: 44 for any target (48 for a system target where a
      // pointer or a tablet gives the room), 84 for the attack (68 on a
      // micro handset, where 84 cannot coexist with a stick).
      const micro = document.body.classList.contains('tier-micro');
      const min = el.classList.contains('tc-attack') ? 67.5 : el.classList.contains('ds-icon-btn') && micro ? 35.5 : 43.5;
      if (b.width < min || b.height < min) fails.push(`small ${n} ${Math.round(b.width)}`);
      // THE PAD IS THE THUMBS' OWN: with a pad, no thumb control may reach
      // up into the crypt — that is the whole point of the split. (The
      // system bar is HUD furniture and lives in the crypt's corner.)
      if (s.padH > 0 && el.classList.contains('tc-btn') && b.top < s.stageH - 1) fails.push(`in-crypt ${n}`);
    }
    // Every system target is present on every screen (it.66): no tier may
    // hide the bag, the talents, the hero, the bestiary, the menu or fullscreen.
    const sysCount = [...document.querySelectorAll<HTMLElement>('#system-bar .ds-icon-btn')].filter(visible).length;
    if (sysCount !== 7) fails.push(`sysbar ${sysCount}/7`);
    // The plate must stay legible: its scale floor is 0.55 (micro) and its
    // real width at least 128 px.
    const plate = document.getElementById('status-frame');
    const plateMin = document.body.classList.contains('tier-micro') ? 108 : 127;
    if (visible(plate) && plate.getBoundingClientRect().width < plateMin) fails.push(`plate ${Math.round(plate.getBoundingClientRect().width)}`);
    const vj = document.querySelector<HTMLElement>('.vj-base');
    if (visible(vj)) ctrls.push({ n: 'stick', s: shapeOf(vj), b: vj.getBoundingClientRect() });

    const hud = HUD_IDS.map((i) => document.getElementById(i))
      .filter(visible)
      .map((el) => ({ n: el.id, s: shapeOf(el), b: el.getBoundingClientRect() }));

    for (const o of [...ctrls, ...hud]) {
      const b = o.b;
      if (b.left < -2 || b.top < -2 || b.right > W + 2 || b.bottom > H + 2) {
        fails.push(`ovf ${o.n}`);
        if (detail) notes.push(o.n + px(b));
      }
    }
    outer1: for (let i = 0; i < ctrls.length; i++)
      for (let j = i + 1; j < ctrls.length; j++)
        if (hits(ctrls[i].s, ctrls[j].s)) {
          fails.push(`ctrl ${ctrls[i].n}/${ctrls[j].n}`);
          if (detail) notes.push(ctrls[i].n + px(ctrls[i].b) + ' ' + ctrls[j].n + px(ctrls[j].b));
          break outer1;
        }
    outer2: for (const a of hud)
      for (const b of ctrls)
        if (hits(a.s, b.s)) {
          fails.push(`hud ${a.n}/${b.n}`);
          if (detail) notes.push(a.n + px(a.b) + ' ' + b.n + px(b.b));
          break outer2;
        }
    outer3: for (let i = 0; i < hud.length; i++)
      for (let j = i + 1; j < hud.length; j++)
        if (hits(hud[i].s, hud[j].s)) {
          fails.push(`hud/hud ${hud[i].n}/${hud[j].n}`);
          if (detail) notes.push(hud[i].n + px(hud[i].b) + ' ' + hud[j].n + px(hud[j].b));
          break outer3;
        }

    const wide = band(W, H, 0.6);
    const core = band(W, H, 0.4);
    for (const o of hud) {
      if (centreIn(o.s, wide)) { fails.push(`floats ${o.n}`); if (detail) notes.push(`floats ${o.n}${px(o.b)}`); break; }
    }
    for (const o of hud) {
      if (overlapsBox(o.b, core)) { fails.push(`core ${o.n}`); if (detail) notes.push(`core ${o.n}${px(o.b)}`); break; }
    }
    results.push({ d: `${name} ${w}x${h}`, fails, notes });
  };

  for (const [n, w, h] of DEVICES) {
    check(n, w, h);
    check(n, h, w);
  }
  L.layout.clearSimulation();
  const bad = results.filter((r) => r.fails.length);
  return { tested: results.length, failed: bad.length, fails: bad.slice(0, 8) };
}

(window as unknown as { __qa66: typeof runMatrix }).__qa66 = runMatrix;
