/**
 * @module ui/itemTip
 * One shared hover tooltip for every item list outside the inventory
 * (shop, stash, save panels): name in rarity color, slot, stats, and the
 * gold line the caller supplies ("Buy for 30 gold" / "Sells for 8 gold").
 */

import { RARITY_COLOR, statLine, type ItemDef } from '@/items/catalog';

let node: HTMLElement | null = null;

function el(): HTMLElement {
  if (!node) {
    node = document.createElement('div');
    node.id = 'item-tip';
    document.body.appendChild(node);
  }
  return node;
}

export function showItemTip(def: ItemDef, x: number, y: number, goldLine: string): void {
  const n = el();
  const color = `#${RARITY_COLOR[def.rarity].toString(16).padStart(6, '0')}`;
  n.innerHTML =
    `<div class="tip-name" style="color:${color}">${def.name}</div>` +
    `<div class="tip-slot">${def.rarity} · ${def.slot === 'consumable' ? 'consumable' : def.slot}</div>` +
    `<div class="tip-stats">${statLine(def)}</div>` +
    `<div class="tip-gold">◆ ${goldLine}</div>`;
  n.classList.add('show');
  const pad = 14;
  const rect = n.getBoundingClientRect();
  n.style.left = `${Math.min(x + pad, window.innerWidth - rect.width - 8)}px`;
  n.style.top = `${Math.min(y + pad, window.innerHeight - rect.height - 8)}px`;
}

export function hideItemTip(): void {
  node?.classList.remove('show');
}

/** Attach hover tips to every `[data-tip]` row inside `root` (item id in the attribute). */
export function wireItemTips(root: HTMLElement, items: Record<string, ItemDef>, goldLine: (def: ItemDef) => string): void {
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((row) => {
    const def = items[row.dataset.tip ?? ''];
    if (!def) return;
    row.addEventListener('mouseenter', (e) => showItemTip(def, (e as MouseEvent).clientX, (e as MouseEvent).clientY, goldLine(def)));
    row.addEventListener('mousemove', (e) => showItemTip(def, (e as MouseEvent).clientX, (e as MouseEvent).clientY, goldLine(def)));
    row.addEventListener('mouseleave', hideItemTip);
  });
}
