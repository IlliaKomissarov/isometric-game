/**
 * @module core/workerTimer
 * A timeout that a hidden tab cannot throttle (it.90).
 *
 * Chrome slows a background page's timers to one a second, and after five
 * minutes hidden to one a MINUTE. Every floor transition waited on
 * `setTimeout` (the fade, the loading beat, the watchdog): an alt-tabbed
 * delver came back to a stalled fade, and the scripted playthrough in an
 * occluded tab tripped its own watchdog. A Web Worker's clock is not
 * throttled, so the wait runs there and the callback comes back by message.
 * Falls back to `setTimeout` where workers are refused.
 */

const SRC = 'self.onmessage = (e) => { const { id, ms } = e.data; setTimeout(() => self.postMessage(id), ms); };';

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, () => void>();

function clock(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const url = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (e: MessageEvent<number>) => {
      const fn = pending.get(e.data);
      if (!fn) return;
      pending.delete(e.data);
      fn();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Run `fn` after `ms` on the worker's clock; returns a cancel. */
export function unthrottledTimeout(fn: () => void, ms: number): () => void {
  const w = clock();
  if (!w) {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  }
  const id = ++seq;
  pending.set(id, fn);
  w.postMessage({ id, ms });
  return () => {
    pending.delete(id);
  };
}
