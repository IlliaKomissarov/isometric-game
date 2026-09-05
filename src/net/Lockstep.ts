/**
 * @module net/Lockstep
 * DETERMINISTIC LOCKSTEP (it.59, fault-tolerant since it.60).
 *
 * Every peer runs the SAME simulation from the SAME seed; the only thing on
 * the wire is intent. Each fixed tick a peer drains its local `InputQueue`,
 * stamps the commands for tick `now + INPUT_DELAY`, and sends them to the
 * Party Leader. The leader gathers one entry per seat it is waiting on,
 * merges them in slot order into a FRAME, and broadcasts it. A tick executes
 * only when its frame is known.
 *
 * GRACE (it.60): the leader never freezes the party on one silent seat. A
 * seat whose inputs are late by more than LAG_MS is moved to `lagging`: its
 * lane is empty until its inputs land inside the live window again, when it
 * is re-included on its own. A seat that drops its channel keeps its hero
 * for the grace window; if the player re-dials in time they ask for the
 * frames they missed (`resync`) and catch up at up to 30 ticks a frame.
 *
 * HISTORY / REPLAY (it.60): the leader keeps every executed frame. A player
 * who comes back through the lobby (or a new seat joining mid-run) receives
 * the party's start and the whole frame history, replays it locally
 * (barriers resolve locally — the frames are already final), and is live
 * the moment it reaches the leader's tick. A JOIN command in the stream
 * seats a brand-new hero on every peer at the same tick.
 *
 * FLOOR CHANGES pass through a BARRIER: the tick that decides a warp closes
 * the gate; each peer reports `bar` once its new floor stands; the leader
 * answers `res`, everyone wipes any input queued past the barrier, re-seeds
 * the delay window, and steps out together. A peer that reaches a barrier
 * the leader already resumed (it was lagging) resumes locally.
 */

import type { InputCommand } from '@/core/InputQueue';
import type { HistoryPayload, NetMsg, PeerNet, ResyncPayload, SnapshotPayload } from './PeerNet';

/** A barrier this peer has held for this long asks the leader what happened. */
const BARRIER_ASK_MS = 8000;

/** Ticks of input delay (100 ms at 60 Hz) — hides typical WebRTC latency. */
export const INPUT_DELAY = 6;
/** How long the leader waits on one seat before playing on without it. */
const LAG_MS = 1500;
/** Ticks a catching-up peer may run per rendered frame. */
export const CATCH_UP_STEPS = 30;

export class Lockstep {
  /** Ticks whose merged commands are known. */
  private readonly frames = new Map<number, InputCommand[]>();
  /** Leader only: per-tick inputs still being gathered, per slot. */
  private readonly pending = new Map<number, Map<number, InputCommand[]>>();
  private readonly waitSince = new Map<number, number>();
  /** Seats the leader expects inputs from. */
  private waitingOn = new Set<number>();
  /** Seats temporarily played on without (late, reconnecting, catching up). */
  private readonly lagging = new Set<number>();
  private barrierTick: number | null = null;
  private readonly barrierReady = new Set<number>();
  /** Leader: commands to fold into the next frame it completes (LEAVE / JOIN). */
  private readonly injected: InputCommand[] = [];
  private stallSince = 0;
  private lastSubmitted = -1;
  private lastCompleted = INPUT_DELAY - 1;
  private solo = false;
  /** Leader: every executed non-empty frame, for late joiners and resyncs. */
  private readonly history: Array<[number, InputCommand[]]> = [];
  private readonly resumedTicks: number[] = [];
  /** The last tick this peer executed. */
  executed = -1;
  /** Client: replaying history up to this tick (inclusive); -1 when live. */
  private replayUpto = -1;
  /** Client: the highest barrier the leader has already resumed. */
  private resumedTick = -1;
  private readonly off: () => void;
  private lastLagCheck = 0;
  private barrierSince = 0;
  private lastAsk = 0;

  constructor(
    private readonly net: PeerNet,
    readonly localSlot: number,
    slots: number[],
  ) {
    this.waitingOn = new Set(slots);
    for (let k = 0; k < INPUT_DELAY; k++) this.frames.set(k, []);
    this.off = net.onMessage((msg, from) => this.onMessage(msg, from));
    // The frames the transport heard before this existed (it.73): a joiner
    // is built while the leader keeps broadcasting.
    if (!net.isHost) for (const m of net.recentFrames()) this.onMessage(m, 0);
    if (net.isHost) {
      net.historyProvider = () => this.historyPayload();
      net.resyncProvider = (from) => this.resyncPayload(from);
    } else {
      net.lastTickProvider = () => this.executed;
    }
  }

  get isLeader(): boolean {
    return this.net.isHost || this.solo;
  }

  /** The run continues alone: every future frame is the local queue. */
  goSolo(): void {
    this.solo = true;
    this.barrierTick = null;
    this.replayUpto = -1;
    this.waitingOn = new Set([this.localSlot]);
    this.lagging.clear();
  }

  destroy(): void {
    this.off();
    this.frames.clear();
    this.pending.clear();
  }

  // --- History / replay ---------------------------------------------------------

  /** Client: seed the frame table with a run in progress; live frames follow on the wire. */
  loadHistory(h: HistoryPayload): void {
    this.frames.clear();
    for (let k = 0; k <= h.upto; k++) this.frames.set(k, []);
    for (const [k, cmds] of h.frames) this.frames.set(k, cmds);
    this.replayUpto = h.upto;
    this.lastSubmitted = h.upto + INPUT_DELAY; // Nothing of ours is wanted before we are live.
  }

  /**
   * Client: continue from a world snapshot (it.73). The frames from the
   * snapshot's tick to the leader's present come inside it; live frames
   * follow on the wire (buffered by the transport until this exists).
   */
  loadSnapshot(s: SnapshotPayload): void {
    // The table is NOT cleared: the live frames that arrived while the world
    // was being built are already in it, and they are the ones the resync
    // inside the snapshot stops short of.
    this.executed = s.tick;
    this.replayUpto = -1;
    this.lastSubmitted = s.tick + INPUT_DELAY;
    this.applyResync(s.frames);
  }

  /** Leader: the frames since `from` (a snapshot carries them). */
  resyncFor(from: number): ResyncPayload {
    return this.resyncPayload(from);
  }

  /** Still replaying the past (or far behind the leader)? */
  get catchingUp(): boolean {
    return this.executed < this.replayUpto || this.backlog(this.executed + 1) > 12;
  }

  /** Replay progress 0..1 (1 once live). */
  get replayProgress(): number {
    if (this.replayUpto < 0) return 1;
    return Math.min(1, Math.max(0, (this.executed + 1) / (this.replayUpto + 1)));
  }

  /** Consecutive known frames from `k` (capped) — a backlog worth sprinting through. */
  backlog(k: number): number {
    let n = 0;
    while (n < 240 && this.frames.has(k + n)) n++;
    return n;
  }

  /** Frames the leader has completed but not yet executed — a joiner needs them too. */
  private completedTail(): Array<[number, InputCommand[]]> {
    const out: Array<[number, InputCommand[]]> = [];
    for (let k = this.executed + 1; k <= this.lastCompleted; k++) {
      const f = this.frames.get(k);
      if (f && f.length) out.push([k, f]);
    }
    return out;
  }

  private historyPayload(): HistoryPayload {
    return {
      seed: 0, // Filled by the run (it owns the seed / roster / stash).
      members: [],
      stash: { items: [], gold: 0 },
      upto: this.lastCompleted,
      frames: [...this.history.map(([k, c]): [number, InputCommand[]] => [k, c]), ...this.completedTail()],
    };
  }

  private resyncPayload(from: number): ResyncPayload {
    return {
      from,
      upto: this.lastCompleted,
      frames: [...this.history.filter(([k]) => k > from), ...this.completedTail().filter(([k]) => k > from)],
      resumed: this.resumedTicks.filter((k) => k > from),
    };
  }

  /** Client: the leader handed back the frames we missed while re-dialling. */
  private applyResync(p: ResyncPayload): void {
    for (let k = p.from + 1; k <= p.upto; k++) if (!this.frames.has(k)) this.frames.set(k, []);
    for (const [k, cmds] of p.frames) this.frames.set(k, cmds);
    for (const k of p.resumed) this.resumedTick = Math.max(this.resumedTick, k);
    this.lastSubmitted = Math.max(this.lastSubmitted, p.upto + INPUT_DELAY);
    if (this.barrierTick !== null && this.barrierTick <= this.resumedTick) this.localResume(this.barrierTick);
  }

  // --- Per-tick driver -------------------------------------------------------

  /**
   * May tick `k` execute now? (Gate for the GameLoop.) Also the clock for
   * the lag rule and the heartbeat: the loop keeps running in a hidden tab
   * (Worker clock) where setInterval is throttled to once a minute.
   */
  canStep(k: number): boolean {
    const now = performance.now();
    if (now - this.lastLagCheck > 250) {
      this.lastLagCheck = now;
      this.net.pulse();
      if (this.net.isHost) this.checkLag();
    }
    if (this.barrierTick !== null && k >= this.barrierTick) {
      // THE WATCHDOG (it.73): a joiner whose `res` was lost, or that reported
      // ready to a leader that had already moved on, used to hold its
      // loading screen forever. After a while it asks for the frames since
      // where it stands; the answer carries the resumed ticks.
      if (!this.net.isHost && !this.solo && now - this.barrierSince > BARRIER_ASK_MS && now - this.lastAsk > BARRIER_ASK_MS) {
        this.lastAsk = now;
        this.net.send({ t: 'rs', from: this.executed });
      }
      return this.noteStall(false);
    }
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
    return [...this.waitingOn].filter((s) => !this.lagging.has(s) && !got?.has(s));
  }

  /** Seats the leader is currently playing on without. */
  get laggingSlots(): number[] {
    return [...this.lagging];
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
    this.executed = k;
    if (this.net.isHost && out.length) this.history.push([k, out]);
    return out;
  }

  // --- Barrier ---------------------------------------------------------------

  /** The tick that decided a warp: nothing past it runs until every peer is rebuilt. */
  enterBarrier(k: number): void {
    if (this.solo) return;
    this.barrierTick = k;
    this.barrierReady.clear();
    this.barrierSince = performance.now();
  }

  get inBarrier(): boolean {
    return this.barrierTick !== null;
  }

  /** This peer's new floor stands. */
  markReady(): void {
    const k = this.barrierTick;
    if (k === null) return;
    if (this.solo) {
      this.resume(k);
      return;
    }
    if (this.net.isHost) {
      this.barrierReady.add(this.localSlot);
      this.checkBarrier();
      return;
    }
    // Replaying, or the leader already resumed this barrier while we lagged:
    // the frames past it are final — resume here, wipe nothing.
    if (k <= this.replayUpto || k <= this.resumedTick) {
      this.localResume(k);
      return;
    }
    this.net.send({ t: 'bar', k });
  }

  private localResume(k: number): void {
    this.barrierTick = null;
    this.barrierReady.clear();
    this.onResume?.(k);
  }

  private resume(k: number): void {
    for (const t of [...this.frames.keys()]) if (t >= k) this.frames.delete(t);
    for (const t of [...this.pending.keys()]) if (t >= k) this.pending.delete(t);
    for (let t = k; t < k + INPUT_DELAY; t++) this.frames.set(t, []);
    this.lastSubmitted = k + INPUT_DELAY - 1;
    this.lastCompleted = Math.max(this.lastCompleted, k + INPUT_DELAY - 1);
    this.barrierTick = null;
    this.barrierReady.clear();
    this.onResume?.(k);
  }

  /** Fired on every peer the moment the party steps onto the new floor together. */
  onResume: ((k: number) => void) | null = null;
  /** Leader: a seat fell behind / came back (for the HUD). */
  onLag: ((slot: number, lagging: boolean) => void) | null = null;

  // --- Membership --------------------------------------------------------------

  /** Leader: stop waiting on a dropped member; their hero leaves on the next frame. */
  dropMember(slot: number): void {
    if (!this.waitingOn.delete(slot)) return;
    this.lagging.delete(slot);
    this.injected.push({ type: 'LEAVE', playerId: slot });
    this.completePending();
    if (this.barrierTick !== null) this.checkBarrier();
  }

  /** Leader: a seat joins mid-run — it is played on without until its inputs land in the window. */
  addMember(slot: number, join: InputCommand | null): void {
    this.waitingOn.add(slot);
    this.lagging.add(slot);
    if (join) this.injected.push(join);
    this.completePending();
  }

  private completePending(): void {
    for (const k of [...this.pending.keys()].sort((a, b) => a - b)) this.tryComplete(k);
  }

  // --- Wire ------------------------------------------------------------------

  private record(k: number, slot: number, cmds: InputCommand[]): void {
    if (k <= this.lastCompleted) {
      // Too late — that frame already shipped. A seat played on without
      // always lands one round trip late; if it is close (two seconds) it
      // is back in the set and the next tick waits for it again.
      if (this.lagging.has(slot) && k > this.lastCompleted - 120) {
        this.lagging.delete(slot);
        this.onLag?.(slot, false);
      }
      return;
    }
    if (this.lagging.has(slot)) {
      this.lagging.delete(slot);
      this.onLag?.(slot, false);
    }
    let bucket = this.pending.get(k);
    if (!bucket) {
      bucket = new Map();
      this.pending.set(k, bucket);
      this.waitSince.set(k, performance.now());
    }
    bucket.set(slot, cmds);
    this.tryComplete(k);
  }

  /** Leader: a seat late on the oldest open tick is played on without. */
  private checkLag(): void {
    const ticks = [...this.pending.keys()].sort((a, b) => a - b);
    const k = ticks[0];
    if (k === undefined) return;
    const since = this.waitSince.get(k) ?? performance.now();
    if (performance.now() - since < LAG_MS) return;
    const bucket = this.pending.get(k)!;
    let changed = false;
    for (const s of this.waitingOn) {
      if (this.lagging.has(s) || bucket.has(s)) continue;
      this.lagging.add(s);
      this.onLag?.(s, true);
      changed = true;
    }
    if (changed) {
      this.completePending();
      if (this.barrierTick !== null) this.checkBarrier();
    }
  }

  private needed(): number[] {
    return [...this.waitingOn].filter((s) => !this.lagging.has(s)).sort((a, b) => a - b);
  }

  private tryComplete(k: number): void {
    const bucket = this.pending.get(k);
    if (!bucket) return;
    if (this.barrierTick !== null && k >= this.barrierTick) return; // Wiped on resume.
    if (k !== this.lastCompleted + 1 && k > this.lastCompleted + 1) {
      // Frames complete in order; an earlier tick is still open.
      if (this.pending.has(this.lastCompleted + 1)) return;
    }
    for (const s of this.needed()) if (!bucket.has(s)) return;
    const merged: Array<[number, InputCommand[]]> = [];
    const lanes = [...this.waitingOn].sort((a, b) => a - b);
    let injectedPlaced = false;
    for (const s of lanes) {
      let cmds = bucket.get(s) ?? [];
      if (s === this.localSlot && this.injected.length) {
        cmds = [...this.injected.splice(0), ...cmds];
        injectedPlaced = true;
      }
      merged.push([s, cmds]);
    }
    if (!injectedPlaced && this.injected.length) merged.unshift([this.localSlot, this.injected.splice(0)]);
    this.pending.delete(k);
    this.waitSince.delete(k);
    this.lastCompleted = Math.max(this.lastCompleted, k);
    this.frames.set(k, merged.flatMap(([, c]) => c));
    this.net.broadcast({ t: 'fr', k, c: merged });
    // The next tick may already be complete (a lagging seat just left the set).
    if (this.pending.has(k + 1)) this.tryComplete(k + 1);
  }

  private checkBarrier(): void {
    if (this.barrierTick === null) return;
    for (const s of this.needed()) if (!this.barrierReady.has(s)) return;
    const k = this.barrierTick;
    this.resumedTicks.push(k);
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
        if (!this.net.isHost && Number.isInteger(msg.k)) {
          const k = msg.k;
          this.resumedTick = Math.max(this.resumedTick, k);
          if (k > this.executed) {
            for (const t of [...this.frames.keys()]) if (t >= k) this.frames.delete(t);
            for (let t = k; t < k + INPUT_DELAY; t++) this.frames.set(t, []);
            this.lastSubmitted = Math.max(this.lastSubmitted, k + INPUT_DELAY - 1);
          }
          if (this.barrierTick === k) this.localResume(k);
        }
        break;
      case 'resync':
        if (!this.net.isHost) this.applyResync(msg.p);
        break;
      case 'gone':
        if (this.net.isHost) this.dropMember(msg.slot);
        break;
      default:
        break;
    }
  }
}
