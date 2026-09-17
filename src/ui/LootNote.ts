/**
 * @module ui/LootNote
 * THE LOOT LINE (it.115): what the hero just took, said once, beside him.
 *
 * "TOOK  Iron Sword (sword)", in the item's rarity colour, rises over the
 * hero and fades in two and a half seconds; up to four lines stack when a
 * burst is swept up, the oldest leaving first. A smelted ore says what it
 * became. Main places the stack each frame (`placeLootNote`, the way it
 * rides the level-up banner) and hides it in cutscenes through `body.cine`.
 * It never takes the pointer, so it cannot block a tap on the floor.
 *
 * The prompt that comes BEFORE the pickup ("E · LOOT Iron Sword (sword)")
 * is `lootPromptHtml`, drawn into main's interact chip.
 */

import { RARITY_COLOR, kindWord, type ItemDef } from '@/items/catalog';

const CSS = `
#loot-note { position: fixed; left: 0; top: 0; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; gap: 2px; pointer-events: none; z-index: 13; }
#loot-note .ln-row { display: flex; align-items: baseline; gap: 5px; padding: 2px 8px; white-space: nowrap;
  font-family: 'Cinzel', 'Georgia', serif; font-size: 11px; letter-spacing: 0.06em; color: #f4ecd8;
  background: linear-gradient(90deg, rgba(8, 6, 10, 0) 0%, rgba(8, 6, 10, 0.78) 18%, rgba(8, 6, 10, 0.78) 82%, rgba(8, 6, 10, 0) 100%);
  text-shadow: 0 1px 2px #000; animation: ln-rise 2.6s ease-out forwards; }
#loot-note .ln-verb { font-size: 8.5px; letter-spacing: 0.2em; color: #c8a558; font-weight: 700; }
#loot-note .ln-name { font-weight: 700; }
#loot-note .ln-kind { font-family: 'Crimson Pro', 'Georgia', serif; font-style: italic; font-size: 11.5px; color: #b8ac98; letter-spacing: 0.02em; }
@keyframes ln-rise { 0% { opacity: 0; transform: translateY(6px); } 10% { opacity: 1; transform: translateY(0); } 75% { opacity: 1; } 100% { opacity: 0; transform: translateY(-10px); } }
body.cine #loot-note, body:not(.in-run) #loot-note { display: none; }
body.tier-micro #loot-note .ln-row, body.tier-compact #loot-note .ln-row { font-size: 10px; }
@media (prefers-reduced-motion: reduce) { #loot-note .ln-row { animation-name: ln-fade; } @keyframes ln-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } } }
`;

const MAX_ROWS = 4;
const ROW_MS = 2600;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const esc = (s: string): string => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch);

function root(): HTMLElement {
  let el = document.getElementById('loot-note');
  if (!el) {
    if (!document.getElementById('loot-note-css')) {
      const style = document.createElement('style');
      style.id = 'loot-note-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    el = document.createElement('div');
    el.id = 'loot-note';
    document.body.appendChild(el);
  }
  return el;
}

/** An item's name for a line: a stack says how many. */
function nameOf(def: ItemDef): string {
  return def.count && def.count > 1 ? `${def.name} ×${def.count}` : def.name;
}

/** Say what was taken (or `verb`-ed) - one line, gone in a few seconds. `after` is an optional plain tail ("→ 3 Iron Scraps"). */
export function noteLoot(def: ItemDef, verb = 'TOOK', after = ''): void {
  const el = root();
  const row = document.createElement('div');
  row.className = 'ln-row';
  row.innerHTML =
    `<span class="ln-verb">${esc(verb)}</span>` +
    `<span class="ln-name" style="color:${hex(RARITY_COLOR[def.rarity] ?? 0xf4ecd8)}">${esc(nameOf(def))}</span>` +
    `<span class="ln-kind">(${esc(kindWord(def))})</span>` +
    (after ? `<span class="ln-kind">${esc(after)}</span>` : '');
  el.appendChild(row);
  while (el.children.length > MAX_ROWS) el.firstElementChild?.remove();
  window.setTimeout(() => row.remove(), ROW_MS);
}

/** MAIN, EACH FRAME: the stack rides over the hero (canvas px, the camera's zoom). */
export function placeLootNote(canvasX: number, canvasY: number, zoom: number): void {
  const el = document.getElementById('loot-note');
  if (!el || !el.firstElementChild) return;
  el.style.left = `${Math.round(canvasX)}px`;
  el.style.top = `${Math.round(canvasY - 136 * zoom)}px`; // above the head buffs
}

/** Drop every line (a floor change, a death). */
export function clearLootNote(): void {
  const el = document.getElementById('loot-note');
  if (el) el.textContent = '';
}

/**
 * THE PROMPT (it.115): "E · LOOT  Iron Sword (sword)" for the nearest item
 * in reach - on a touch screen the key is the INTERACT hand.
 */
export function lootPromptHtml(def: ItemDef): string {
  const touch = document.body.classList.contains('input-touch');
  return (
    `<kbd>${touch ? '&#9995;' : 'E'}</kbd> LOOT ` +
    `<span class="ih-item" style="color:${hex(RARITY_COLOR[def.rarity] ?? 0xf4ecd8)}">${esc(nameOf(def))}</span>` +
    `<span class="ih-kind">(${esc(kindWord(def))})</span>`
  );
}
