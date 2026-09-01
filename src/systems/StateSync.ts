/**
 * @module systems/StateSync
 * Multiplayer state-synchronization stub (lockstep command relay).
 *
 * FUTURE MODEL (4-player co-op):
 *  1. Local commands are stamped `executeTick = currentTick + INPUT_DELAY`
 *     and broadcast via INetworkTransport.
 *  2. Remote commands are buffered here and injected into the shared
 *     InputQueue exactly at their execute tick — every peer applies the same
 *     commands at the same tick against the same seeded world.
 *  3. Periodic GameSnapshot hashes detect drift; a diverged peer re-syncs
 *     from a fresh snapshot.
 *
 * Milestone 1 runs solo, so this class only maintains the buffering plumbing
 * — proving the simulation already flows through the deterministic pipe.
 */

import type { InputQueue } from '@/core/InputQueue';
import type { CommandEnvelope, INetworkTransport } from '@/network/Serialization';

/** Ticks of artificial latency applied to all commands in lockstep mode. */
export const INPUT_DELAY_TICKS = 3;

export class StateSyncSystem {
  private readonly pending: CommandEnvelope[] = [];
  private transport: INetworkTransport | null = null;

  constructor(private readonly inputQueue: InputQueue) {}

  /** Attach a real transport when the networking sub-task lands. */
  setTransport(transport: INetworkTransport): void {
    this.transport = transport;
    transport.onReceive((envelope) => this.pending.push(envelope));
  }

  /** Called once per fixed tick BEFORE input is drained. */
  update(currentTick: number): void {
    if (this.pending.length === 0) return;
    // Inject every remote command scheduled for this tick.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const envelope = this.pending[i];
      if (envelope.executeTick <= currentTick) {
        this.inputQueue.enqueue(envelope.command);
        this.pending.splice(i, 1);
      }
    }
  }

  get isOnline(): boolean {
    return this.transport !== null;
  }
}
