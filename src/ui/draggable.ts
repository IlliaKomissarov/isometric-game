/**
 * @module ui/draggable
 * Universal draggable windows (it.41). Any panel whose header carries the
 * `drag-handle` class can be picked up by that header and dropped anywhere
 * on screen; the position is clamped to the viewport and remembered per
 * panel in localStorage so windows open where they were left.
 *
 * Listeners live on the PANEL (not the header) so a re-rendered header
 * (innerHTML panels) stays draggable. Buttons inside the header still
 * click — a drag only starts on non-interactive header content.
 */

const STORE = 'iso-arpg-ui-pos';

interface Pos {
  left: number;
  top: number;
}

function readAll(): Record<string, Pos> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Pos>;
  } catch {
    return {};
  }
}

function writePos(key: string, pos: Pos | null): void {
  try {
    const all = readAll();
    if (pos) all[key] = pos;
    else delete all[key];
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* Private mode / quota: positions simply don't persist. */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Pin a panel at an absolute viewport position (drops any centering transform). */
function pin(panel: HTMLElement, left: number, top: number): void {
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const l = clamp(left, 0, Math.max(0, window.innerWidth - w));
  const t = clamp(top, 0, Math.max(0, window.innerHeight - h));
  panel.style.left = `${Math.round(l)}px`;
  panel.style.top = `${Math.round(t)}px`;
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.transform = 'none';
  panel.style.margin = '0';
}

/**
 * Make `panel` draggable by its `.drag-handle`. Returns a disposer.
 * A remembered position is applied on the next frame the panel is shown.
 */
export function makeDraggable(panel: HTMLElement, key: string): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  let drag: { dx: number; dy: number; id: number } | null = null;

  const restore = (): void => {
    const pos = readAll()[key];
    if (!pos) return;
    if (panel.offsetWidth === 0) return; // Hidden: try again when it opens.
    pin(panel, pos.left, pos.top);
  };
  // Panels open by class toggle; watch for it so a stored spot applies once visible.
  const mo = new MutationObserver(() => {
    if (panel.offsetWidth > 0 && !panel.dataset.placed) {
      panel.dataset.placed = '1';
      restore();
    }
  });
  mo.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
  restore();

  panel.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      const handle = target.closest('.drag-handle');
      if (!handle || !panel.contains(handle)) return;
      if (target.closest('button, input, select, a, canvas')) return;
      const rect = panel.getBoundingClientRect();
      pin(panel, rect.left, rect.top);
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, id: e.pointerId };
      panel.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
      e.preventDefault();
    },
    { signal },
  );
  panel.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      pin(panel, e.clientX - drag.dx, e.clientY - drag.dy);
    },
    { signal },
  );
  const end = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    panel.classList.remove('dragging');
    writePos(key, { left: parseFloat(panel.style.left), top: parseFloat(panel.style.top) });
  };
  panel.addEventListener('pointerup', end, { signal });
  panel.addEventListener('pointercancel', end, { signal });
  window.addEventListener('resize', () => {
    if (panel.style.transform === 'none') pin(panel, parseFloat(panel.style.left), parseFloat(panel.style.top));
  }, { signal });

  return () => {
    abort.abort();
    mo.disconnect();
  };
}

/** Forget every remembered window position (settings "reset layout"). */
export function resetWindowPositions(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}
