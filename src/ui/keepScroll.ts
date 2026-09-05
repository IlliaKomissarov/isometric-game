/**
 * @module ui/keepScroll
 * SCROLL THAT STAYS PUT (it.79). Every panel repaints itself with
 * `innerHTML` when the sim changes, and a repaint throws away the scroll
 * position of every element inside it — spend a skill point at the bottom
 * of the tree on a phone and the tree snapped back to the top. This wraps
 * a render: it notes every scrolled element (the panel itself and any
 * descendant with a scroll offset), keyed by a structural path that
 * survives the repaint, then puts the offsets back.
 */

interface Saved {
  path: number[];
  top: number;
  left: number;
}

function pathOf(root: HTMLElement, el: HTMLElement): number[] {
  const path: number[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) return path;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
    node = parent;
  }
  return path;
}

function resolve(root: HTMLElement, path: number[]): HTMLElement | null {
  let node: HTMLElement | null = root;
  for (const i of path) {
    node = (node?.children[i] as HTMLElement | undefined) ?? null;
    if (!node) return null;
  }
  return node;
}

/** Run `render` and restore every scroll offset inside `root` afterwards. */
export function keepScroll(root: HTMLElement, render: () => void): void {
  const saved: Saved[] = [];
  if (root.scrollTop || root.scrollLeft) saved.push({ path: [], top: root.scrollTop, left: root.scrollLeft });
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollTop || el.scrollLeft) saved.push({ path: pathOf(root, el), top: el.scrollTop, left: el.scrollLeft });
  }
  render();
  if (!saved.length) return;
  const apply = (): void => {
    for (const s of saved) {
      const el = resolve(root, s.path);
      if (!el) continue;
      el.scrollTop = s.top;
      el.scrollLeft = s.left;
    }
  };
  apply();
  // Icons and fonts may still be sizing the content: settle once more after layout.
  requestAnimationFrame(apply);
}
