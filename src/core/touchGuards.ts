/**
 * @module core/touchGuards
 * THE GLASS RULES (it.83): what a phone browser does with a finger that the
 * game did not ask for, and how each is refused.
 *
 *   - PINCH ZOOM. Mobile Safari ignores `user-scalable=no` and
 *     `maximum-scale` (since iOS 10) and zooms the whole page on any two-
 *     finger gesture — a thumb on the stick and a thumb on STRIKE is a
 *     pinch. The page stays zoomed until the player pinches back, and every
 *     fixed corner of the HUD is then off the glass: "the scaling is broken".
 *     Safari's own `gesturestart` / `gesturechange` are cancelled, and so is
 *     any `touchmove` with two or more fingers.
 *   - RUBBER-BANDING. A one-finger drag on something that cannot scroll
 *     bounces the whole document on iOS (and older Android), dragging the
 *     HUD with it. A move is allowed only when something between the finger
 *     and the body can actually scroll in that direction.
 *   - THE CALLOUT AND THE CONTEXT MENU. A long press on an item's icon is
 *     the game's inspect gesture; iOS answers it with the "Save Image" sheet
 *     and Android with a context menu. Both are cancelled on a touch layout
 *     (the CSS `-webkit-touch-callout: none` covers Safari's sheet as well).
 *
 * Every listener is passive-false where it must cancel, and every one is a
 * no-op on a mouse, so a desktop never feels them.
 */

const scrollableBetween = (start: EventTarget | null, dx: number, dy: number): boolean => {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const ox = cs.overflowX;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      // Only when the scroll can actually go that way; otherwise the bounce
      // escapes to the document.
      if (dy > 0 && el.scrollTop > 0) return true;
      if (dy < 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      if (dy === 0) return true;
    }
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
      if (dx > 0 && el.scrollLeft > 0) return true;
      if (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true;
      if (dx === 0) return true;
    }
    el = el.parentElement;
  }
  return false;
};

let startX = 0;
let startY = 0;

export function installTouchGuards(): void {
  const opts: AddEventListenerOptions = { passive: false, capture: true };
  // Safari's proprietary pinch events: the only reliable veto on iOS.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), opts);
  }
  document.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (e.touches.length > 1) {
        // Two fingers: a pinch or a two-thumb press — never a page zoom.
        if (e.cancelable) e.preventDefault();
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    opts,
  );
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (!e.cancelable) return;
      if (e.touches.length > 1) {
        e.preventDefault();
        return;
      }
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (!scrollableBetween(e.target, dx, dy)) e.preventDefault();
    },
    opts,
  );
  // A double tap on a button must not zoom (belt and braces beside
  // `touch-action: manipulation`), and a long press must not open a menu.
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (document.body.classList.contains('input-touch')) e.preventDefault();
    },
    { capture: true },
  );
  let lastTap = 0;
  document.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      const now = performance.now();
      if (now - lastTap < 320 && e.cancelable && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      lastTap = now;
    },
    opts,
  );
}
