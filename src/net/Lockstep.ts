/**
 * @module net/Lockstep
 * DETERMINISTIC LOCKSTEP (it.59): the co-op model this engine was built for.
 *
 * Every peer runs the SAME simulation from the SAME seed; the only thing on
 * the wire is intent. Each fixed tick a peer drains its local `InputQueue`,
 * stamps the commands for tick `now + INPUT_DELAY`, and sends them to the
 * Party Leader. The leader gathers one entry per online member, merges them
 * in slot order into a FRAME, and broadcasts it. A tick executes only when
 * its frame is known — otherwise the loop holds (the "waiting for party"
 * veil) instead of guessing. Identical frames × identical seed = identical
 * worlds on four machines, with no entity state ever serialised.
 *
 * FLOOR CHANGES are the one place the sim goes asynchronous (atlas streaming
 * + world build), so they pass through a BARRIER: the tick that decides a
 * warp closes the gate; each peer reports `bar` once its new floor stands;
 * the leader answers `res`, everyone wipes any input already queued past the
 * barrier, re-seeds the delay window with empty frames, and the party steps
 * out onto the new floor on the same tick.
 *
 * A member who drops is removed from the roster the leader waits on; a LEAVE
 * command is injected into the next frame so every sim despawns the hero on
 * the same tick. A client that loses the leader flips to SOLO: frames are
 * generated locally from its own inputs and the run continues alone.
 */

import type { InputCommand } from '@/core/InputQueue';
import type { NetMsg, PeerNet } from './PeerNet';

/** Ticks of input delay (100 ms at 60 Hz) — hides typical WebRTC latency. */
export const INPUT_DELAY = 6;

export class Lockstep {
  /** Ticks whose merged commands are known. */
  private readonly frames = new Map<number, InputCommand[]>();
  /** Leader only: per-tick inputs still being gathered, per slot. */
  private readonly pending = new Map<number, Map<number, InputCommand[]>>();
  /** Slots the leader waits on (online members). */
  private waitingOn = new Set<number>();
  private barrierTick: number | null = null;
  private readonly barrierReady = new Set<number>();
  /** Leader: commands to fold into the next frame it completes (LEAVEs). */
  private readonly injected: InputCommand[] = [];
  private stallSince = 0;
  private lastSubmitted = -1;
  private solo = false;
  private readonly off: () => void;

  constructor(
    private readonly net: PeerNet,
    readonly localSlot: number,
    slots: number[],
  ) {
    this.waitingOn = new Set(slots);
    for (let k = 0; k < INPUT_DELAY; k++) this.frames.set(k, []);
    this.off = net.onMessage((msg, from) => this.onMessage(msg, from));
  }

  get isLeader(): boolean {
    return this.net.isHost || this.solo;
  }

  /** The run continues alone: every future frame is the local queue. */
  goSolo(): void {
    this.solo = true;
    this.barrierTick = null;
    this.waitingOn = new Set([this.localSlot]);
  }

  destroy(): void {
    this.off();
    this.frames.clear();
    this.pending.clear();
  }

  // --- Per-tick driver -------------------------------------------------------

  /** May tick `k` execute now? (Gate for the GameLoop.) */
  canStep(k: number): boolean {
    if (this.barrierTick !== null && k >= this.barrierTick) return this.noteStall(false);
    if (this.solo) return this.noteStall(true);
    return this.noteStall(this.frames.has(k));
  }

  private noteStall(ok: boolean): boolean {
    if (ok) this.stallSince = 0;
    else if (this.stallSince === 0) this.stallSince = performance.now();
    return ok;
  }

  /** Milliseconds the sim has been held (0 while flowing). */
  get stalledMs(): number {
    return this.stallSince === 0 ? 0 : performance.now() - this.stallSince;
  }

  /** Who the leader is still waiting on (for the veil's text). */
  missingSlots(k: number): number[] {
    const got = this.pending.get(k);
    return [...this.waitingOn].filter((s) => !got?.has(s));
  }

  /**
   * Ship this tick's local commands (they execute at `k + INPUT_DELAY`) and
   * return the frame for tick `k`. Call exactly once per executed tick.
   */
  frame(k: number, local: InputCommand[]): InputCommand[] {
    const target = k + INPUT_DELAY;
    if (this.solo) {
      if (target > this.lastSubmitted) {
        this.lastSubmitted = target;
        this.frames.set(target, local.map((c) => ({ ...c, playerId: this.localSlot })));
      }
    } else if (target > this.lastSubmitted) {
      this.lastSubmitted = target;
      const stamped = local.map((c) => ({ ...c, playerId: this.localSlot }));
      if (this.net.isHost) this.record(target, this.localSlot, stamped);
      else this.net.send({ t: 'in', k: target, c: stamped });
    }
    const out = this.frames.get(k) ?? [];
    this.frames.delete(k);
    return out;
  }

  // --- Barrier ---------------------------------------------------------------

  /** The tick that decided a warp: nothing past it runs until every peer is rebuilt. */
  enterBarrier(k: number): void {
    if (this.solo) return;
    this.barrierTick = k;
    this.barrierReady.clear();
  }

  get inBarrier(): boolean {
    return this.barrierTick !== null;
  }

  /** This peer's new floor stands. */
  markReady(): void {
    if (this.barrierTick === null) return;
    if (this.solo) {
      this.resume(this.barrierTick);
      return;
    }
    this.net.send({ t: 'bar', k: this.barrierTick });
  }

  private resume(k: number): void {
    for (const t of [...this.frames.keys()]) if (t >= k) this.frames.delete(t);
    for (const t of [...this.pending.keys()]) if (t >= k) this.pending.delete(t);
    for (let t = k; t < k + INPUT_DELAY; t++) this.frames.set(t, []);
    this.lastSubmitted = k + INPUT_DELAY - 1;
    this.barrierTick = null;
    this.barrierReady.clear();
    this.onResume?.(k);
  }

  /** Fired on every peer the moment the party steps onto the new floor together. */
  onResume: ((k: number) => void) | null = null;

  // --- Membership --------------------------------------------------------------

  /** Leader: stop waiting on a dropped member; their hero leaves on the next frame. */
  dropMember(slot: number): void {
    if (!this.waitingOn.delete(slot)) return;
    this.injected.push({ type: 'LEAVE', playerId: slot });
    for (const k of [...this.pending.keys()].sort((a, b) => a - b)) this.tryComplete(k);
    if (this.barrierTick !== null) this.checkBarrier();
  }

  // --- Wire ------------------------------------------------------------------

  private record(k: number, slot: number, cmds: InputCommand[]): void {
    let bucket = this.pending.get(k);
    if (!bucket) {
      bucket = new Map();
      this.pending.set(k, bucket);
    }
    bucket.set(slot, cmds);
    this.tryComplete(k);
  }

  private tryComplete(k: number): void {
    const bucket = this.pending.get(k);
    if (!bucket) return;
    if (this.barrierTick !== null && k >= this.barrierTick) return; // Wiped on resume.
    for (const s of this.waitingOn) if (!bucket.has(s)) return;
    const merged: Array<[number, InputCommand[]]> = [];
    for (const s of [...this.waitingOn].sort((a, b) => a - b)) {
      const cmds = bucket.get(s) ?? [];
      // A dropped member's LEAVE rides in the leader's own lane, slot-ordered.
      merged.push([s, s === this.localSlot && this.injected.length ? [...this.injected.splice(0), ...cmds] : cmds]);
    }
    if (this.injected.length && !this.waitingOn.has(this.localSlot)) merged.unshift([this.localSlot, this.injected.splice(0)]);
    this.pending.delete(k);
    this.frames.set(k, merged.flatMap(([, c]) => c));
    this.net.broadcast({ t: 'fr', k, c: merged });
  }

  private checkBarrier(): void {
    if (this.barrierTick === null) return;
    for (const s of this.waitingOn) if (!this.barrierReady.has(s)) return;
    const k = this.barrierTick;
    this.net.broadcast({ t: 'res', k });
    this.resume(k);
  }

  private onMessage(msg: NetMsg, from: number): void {
    switch (msg.t) {
      case 'in':
        if (this.net.isHost && Array.isArray(msg.c) && Number.isInteger(msg.k)) this.record(msg.k, from, msg.c);
        break;
      case 'fr':
        if (!this.net.isHost && Array.isArray(msg.c) && Number.isInteger(msg.k)) {
          const merged: InputCommand[] = [];
          for (const entry of msg.c) {
            if (!Array.isArray(entry) || !Array.isArray(entry[1])) continue;
            for (const c of entry[1]) merged.push(c);
          }
          this.frames.set(msg.k, merged);
        }
        break;
      case 'bar':
        if (this.net.isHost && msg.k === this.barrierTick) {
          this.barrierReady.add(from);
          this.checkBarrier();
        }
        break;
      case 'res':
        if (!this.net.isHost) this.resume(msg.k);
        break;
      case 'gone':
        if (this.net.isHost) this.dropMember(msg.slot);
        break;
      default:
        break;
    }
  }
}
