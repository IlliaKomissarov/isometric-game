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

## Loot on the leader's word (it.77)

Drops are rolled from a seeded stream, so peers in step agree; peers that
drifted do not. The host sync collects every `item:dropped` and
`item:pickedUp` (with its uid) and ships them on the next sample as `l`
(`[uid, itemId, qx, qy]`) and `lp` (`uid`); a keyframe adds `lf` (`{n, i}`:
the next uid and the whole floor). The client lays what it lacks
(`LootSystem.place`, quiet - no chip, no glint), replaces an item that
differs in id or lies more than a quarter tile off, sweeps what the leader
no longer has (`remove`), and bumps its uid counter (`bumpUid`). Sample
period is 6 ticks. A health correction of two points or more on a visible
foe is shown as a damage number (`SyncWorld.hpText`).

Seat reclaim (it.77): a `hello` naming a seat whose holder's link answered
inside `RECLAIM_QUIET_MS` (6 s) takes a fresh seat instead; the lobby says
who knocked with whose number. Same-origin tabs share the remembered seat in
`iso-arpg-last-party`, which is how the four-tab QA found it.

Four-tab QA (it.77): create in tab H, join three tabs with the code
(click `[data-join]` in each; poll the host's `net.members` from a separate
short call - never a 20 s wait inside a batch), READY all, START, WARP to
depth I. Fingerprint every tab with the same snippet (foes as
`[id, x*32, y*32, hp, action]`, `loot.snapshot()`, heroes). Divergence
probes: `dealDamage` on H only, `loot.dropForced` on H only, `dropForced`
on a joiner only (swept at the keyframe), a foe warped on a joiner inside
the interest radius (pulled back), all four seats `ATTACK` one foe.

