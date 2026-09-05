# Co-op state sync and snapshot joins (it.73)

The party runs a deterministic lockstep (`net/Lockstep.ts`, it.59/60): the
wire carries intent only, every peer executes the same frames. Iteration 73
adds two things on top, and a set of rules a change must keep.

## The authority: `net/StateSync.ts`

- The Party Leader samples every foe within 18 tiles of any hero and every
  hero, every 12 ticks, and broadcasts only the records whose encoding
  changed (`[id, x, y, hp, action, aiState]`, positions in 1/32 tile).
  Every 240 ticks (or on a client's `sf` request) a keyframe carries every
  near foe plus `a`, the ids of every foe alive on the floor.
- A client absorbs a packet once its own tick has reached the packet's:
  health is set, a foe the leader calls dead dies through
  `combat.dealDamage` (loot and bestiary follow the local path), a position
  error under 3 tiles glides shut at 35% per tick, a larger one snaps; a foe
  alive here but absent from a keyframe's alive list is killed (it died out
  of interest range). Heroes are corrected the same way.
- The host never applies corrections. `reset()` on both sides when a floor
  is raised (`lockstep.onResume`).

## Snapshot joins

- `PeerNet.snapshotProvider` (wired in `main.ts`) returns the world as it
  stands: seed, tick, floor, arena flag, floor memories, stash, seated
  members with current sheets, seat positions, every foe's record, ground
  loot with uids, the three RNG states (`Rng.state`), `idBase`, and the
  frames from the snapshot's tick (`lockstep.resyncFor`). `null` = a floor
  is being raised, the joiner is queued and retried on the heartbeat;
  `undefined` = no snapshot for this world (the Coliseum): history replays.
- A joiner rebuilds the floor from seed + memory, sets `state.nextId` to
  `idBase` before the enemy pool is built (the pool registers every foe it
  can hold at construction, so ids match the leader's), then `applySnapshot`
  seats everyone, re-lays the loot, restores the RNG streams, seeks the loop
  to the tick and loads the frames. `PeerNet.recentFrames()` holds the
  frames heard while the world was being built; a new `Lockstep` reads them
  first, and `loadSnapshot` never clears the table.
- A seat reclaim (`JoinOptions.rejoin`, from the lobby's remembered
  `iso-arpg-last-party` `{code, slot}`) keeps the seat, the hero and the
  entity: the host broadcasts the roster BEFORE the snapshot (the lobby
  looks its own seat up in it), and the joiner treats itself as already
  seated (no JOIN frame is coming).

## Rules

- Any new random stream that lives across the run must expose its state and
  join the snapshot, or a joiner's rolls diverge from the leader's.
- Any new entity kind registered at floor build must be registered in a
  deterministic order relative to the pool, or ids drift.
- Never `frames.clear()` on a live lockstep.
- Messages: `st` (host to all), `sf` and `rs` (client to host), `snap`
  chunks (host to one joiner). `PROTOCOL` is 3.

## QA recipe (three Chrome tabs, same origin)

Create in tab H (`__menu.coopLobby.open(cls)`, click `[data-create]`, READY),
join in tab J via `[data-rejoin]` (the code is shared through localStorage),
READY, START on H, `__game.queue.enqueue({type:'WARP', playerId:0, to:'floor', n:1})`
on H. Corrections: warp a foe on J and watch it return within a keyframe.
Far kill: `dealDamage` on H, the foe dies on J within a keyframe. Reclaim:
navigate J away, host shows `reconnecting`, REJOIN puts J back in its seat
in about 5 s. Keep every script under about 35 s of polling (the CDP limit
is 45 s) and never poll from a tab hidden for more than five minutes.
