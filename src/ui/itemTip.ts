/**
 * @module ui/itemTip
 * The item card (it.76): one shared hover card for every item list — the
 * inventory, the shop, the stash. Name in rarity colour, the slot, and a
 * THIS / YOURS table against the piece worn in the same slot with signed
 * deltas and a verdict (UPGRADE, DOWNGRADE, TRADE-OFF, EQUAL). A bare main
 * hand compares against the class's own weapon, because that is what the
 * hero actually swings. Consumables keep their one-line description.
 *
 * Touch (it.76): a long press (380 ms) on a cell raises the card without
 * acting; the tap that follows is swallowed and the next touch anywhere
 * folds it.
 */

import { ARCHETYPES, type Player } from '@/entities/Player';
import { compareItems, soloRows, type CompareRow, type Verdict } from '@/items/compare';
import { ITEMS, RARITY_COLOR, statLine, type ItemDef } from '@/items/catalog';

const SLOT_LABEL: Record<string, string> = {
  head: 'Head', torso: 'Body', legs: 'Legs', mainHand: 'Main Hand', offHand: 'Off Hand', cloak: 'Back', ring: 'Ring', consumable: 'Consumable',
};

const VERDICT_TEXT: Record<Verdict, string> = { upgrade: '▲ Upgrade', downgrade: '▼ Downgrade', tradeoff: '◆ Trade-off', equal: '= Equal' };

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** What the hero fights with when the slot is bare: the class's own weapon (it.32). */
function classWeapon(player: Player): ItemDef {
  const cls = ARCHETYPES[player.archetype];
  return {
    id: 'bare_hands',
    name: `Bare ${cls.defaultWeapon === 'wand' ? 'arcana' : cls.defaultWeapon === 'bow' ? 'shot' : 'hands'}`,
    slot: 'mainHand',
    rarity: 'common',
    weaponKind: cls.defaultWeapon,
    minDamage: cls.baseDamage.min,
    maxDamage: cls.baseDamage.max,
    color: 0xffcf90,
  };
}

/** The piece the hero wears in `def`'s slot, or the class weapon for a bare main hand, or null. */
export function wornFor(player: Player, def: ItemDef): ItemDef | null {
  if (def.slot === 'consumable') return null;
  const id = player.getEquipped(def.slot);
  const worn = id ? ITEMS[id] : undefined;
  if (worn) return worn;
  return def.slot === 'mainHand' ? classWeapon(player) : null;
}

export interface CardOptions {
  /** The worn piece to compare against; `undefined` means "no comparison" (consumables). */
  worn?: ItemDef | null;
  /** The hovered item IS the worn piece: a single WORN column, no deltas. */
  self?: boolean;
  /** The footer line ("◆ worth 30 gold", "◆ Buy 45 gold"). */
  goldLine: string;
}

function rowsHtml(rows: CompareRow[], compare: boolean): string {
  return rows
    .map(
      (r) =>
        `<tr><th>${r.label}</th><td class="tip-a">${r.aText}</td>${
          compare ? `<td class="tip-b">${r.bText}</td><td class="tip-d ${r.lean}">${r.delta}</td>` : ''
        }</tr>`,
    )
    .join('');
}

/** The card's inner markup. */
export function itemCardHtml(def: ItemDef, opts: CardOptions): string {
  const head =
    `<div class="tip-name" style="color:${hex(RARITY_COLOR[def.rarity])}">${def.name}</div>` +
    `<div class="tip-slot">${cap(def.rarity)} · ${SLOT_LABEL[def.slot] ?? def.slot}${opts.self ? ' · <b>worn</b>' : ''}</div>`;
  let body: string;
  if (def.slot === 'consumable' || (opts.worn === undefined && !opts.self)) {
    body = `<div class="tip-stats">${statLine(def)}</div>`;
  } else if (opts.self) {
    const rows = soloRows(def);
    body = rows.length
      ? `<table class="tip-cmp tip-solo"><thead><tr><th></th><th>WORN</th></tr></thead><tbody>${rowsHtml(rows, false)}</tbody></table>`
      : `<div class="tip-stats">${statLine(def)}</div>`;
  } else {
    const worn = opts.worn ?? null;
    const cmp = compareItems(def, worn);
    const yours = worn
      ? `<span style="color:${hex(RARITY_COLOR[worn.rarity])}">${worn.name}</span>`
      : '<span class="tip-empty">empty slot</span>';
    body =
      `<table class="tip-cmp"><thead><tr><th></th><th>THIS</th><th>YOURS</th><th></th></tr></thead><tbody>${rowsHtml(cmp.rows, true)}</tbody></table>` +
      `<div class="tip-yours">vs ${yours}</div>` +
      `<div class="tip-verdict ${cmp.verdict}">${VERDICT_TEXT[cmp.verdict]}</div>`;
  }
  return head + body + `<div class="tip-gold">◆ ${opts.goldLine}</div>`;
}

let node: HTMLElement | null = null;

function el(): HTMLElement {
  if (!node) {
    node = document.createElement('div');
    node.id = 'item-tip';
    document.body.appendChild(node);
    // A touch anywhere folds a long-pressed card (it.76).
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && node?.classList.contains('show')) hideItemTip();
    }, { capture: true, passive: true });
  }
  return node;
}

/** Place `n` beside the pointer, never off the screen. */
export function placeCard(n: HTMLElement, x: number, y: number): void {
  const pad = 14;
  const rect = n.getBoundingClientRect();
  // The layout's viewport (`--app-w/--app-h`, it.66), so the card also
  // respects a simulated device box; the document is the fallback.
  const css = getComputedStyle(document.documentElement);
  const w = parseFloat(css.getPropertyValue('--app-w')) || document.documentElement.clientWidth;
  const h = parseFloat(css.getPropertyValue('--app-h')) || document.documentElement.clientHeight;
  n.style.left = `${Math.max(4, Math.min(x + pad, w - rect.width - 8))}px`;
  n.style.top = `${Math.max(4, Math.min(y + pad, h - rect.height - 8))}px`;
}

export function showItemTip(def: ItemDef, x: number, y: number, goldLine: string, worn?: ItemDef | null): void {
  const n = el();
  n.innerHTML = itemCardHtml(def, { goldLine, worn });
  n.classList.add('show');
  placeCard(n, x, y);
}

export function hideItemTip(): void {
  node?.classList.remove('show');
}

/**
 * Hover + long-press wiring for one cell (it.76). `show` receives the pointer
 * position; a long press on touch shows the card and swallows the click that
 * would have acted on the cell.
 */
export function attachItemCard(cell: HTMLElement, show: (x: number, y: number) => void, hide: () => void): void {
  // A tap emulates mouseenter; the card must not flash under a thumb.
  let touchedAt = -1e9;
  const mouse = (e: MouseEvent): void => {
    if (performance.now() - touchedAt > 1000) show(e.clientX, e.clientY);
  };
  cell.addEventListener('mouseenter', mouse);
  cell.addEventListener('mousemove', mouse);
  cell.addEventListener('mouseleave', hide);
  let timer = 0;
  let pressed = false;
  const cancel = (): void => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  cell.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchedAt = performance.now();
    pressed = false;
    cancel();
    const { clientX, clientY } = e;
    timer = window.setTimeout(() => {
      timer = 0;
      pressed = true;
      show(clientX, clientY);
    }, 380);
  }, { passive: true });
  cell.addEventListener('pointerup', cancel, { passive: true });
  cell.addEventListener('pointercancel', cancel, { passive: true });
  cell.addEventListener('pointerleave', cancel, { passive: true });
  cell.addEventListener(
    'click',
    (e) => {
      if (!pressed) return;
      pressed = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    { capture: true },
  );
}

/**
 * Attach cards to every `[data-tip]` row inside `root` (item id in the
 * attribute). `worn` resolves the piece to compare against; omit it for
 * lists that only describe.
 */
export function wireItemTips(
  root: HTMLElement,
  items: Record<string, ItemDef>,
  goldLine: (def: ItemDef) => string,
  worn?: (def: ItemDef) => ItemDef | null,
): void {
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((row) => {
    const def = items[row.dataset.tip ?? ''];
    if (!def) return;
    attachItemCard(row, (x, y) => showItemTip(def, x, y, goldLine(def), worn ? worn(def) : undefined), hideItemTip);
  });
}
