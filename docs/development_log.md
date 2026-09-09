# Development Log

## 2026-09-09 (iteration 104) - Feet on the ground, and a field that holds its breath

Five reports, and four of them turned out to have a measurable cause underneath
that was worse than the symptom. This iteration is mostly those causes.

### The field holds its breath (`src/main.ts`)
A cutscene only ever took the COMMANDS away: `inputQueue.clear()`, and the sim
carried on underneath. So the letterboxed scene played over a battle that was
still being fought - guards charged, the company closed, the general shredded the
hero's plate through the general's own speech - and now that it.103 made a scene
WAIT for a keypress, a player could be killed off screen while reading a line.

While the bars are down, nothing about the world is stepped: the movement
systems, swings in flight, projectiles, wounds over time, every entity's own
state machine, the foes' separation pass, the squad, and the quest ticks. The
whole tick is skipped rather than parts of it, which also makes the freeze
exactly reproducible on every peer.

### Feet on the ground (`src/render/SpriteLibrary.ts`)
`spriteLib.footAnchor(name)`, and it is the fix for the "sinking and clipping".

A sliced frame keeps its ORIGINAL frame size (the trim is restored), and the
packs do not agree about how much empty air they leave under a body:
`captain_walk` leaves one pixel of 66, `guard_walk` leaves **114 of 320**. So
`anchor.set(0.5, 1)` - the obvious thing, and what the squad, the procession cast
and the procession walkers all did - hung a guard **seventy screen pixels above
his own shadow** while a captain stood correctly. Every enemy def in the game
works around this with a hand-tuned `anchorY` found by eye, one per sheet.

`footAnchor` computes it: the anchor that puts the painted bottom of the body on
the tile and its painted centre over the tile's centre. The squad, the cutscene
cast, the procession walkers and the town's own villagers all use it now.

### The allies were the enemy, in a different tint
`SQUAD_RANKS` opened with `guard_walk`, three times. Two things wrong with that:

1. It is **the lowest-resolution human sheet in the pack** - baked at half
   resolution, painted body 48 atlas pixels tall, drawn at 60 units. Next to
   `ranger_run` at 168 and `rogue_run` at 88, both baked at full resolution.
2. **`brigand` wears it.** `FARM_POOL` contains `brigand`, whose sprite is
   `guard_walk` - so on the one floor the squad exists, friend and foe were the
   same silhouette in two tints. The it.101 comment in that file claimed the
   opposite and was simply wrong.

The ranks are household knights, rangers of the eastern road and scouts of the
ward now - `knight_run`, `ranger_run`, `rogue_run`, all full-resolution, none
worn by anything hostile on this floor. The harness checks that directly: it
reads the live foes' sheets and asserts no guard shares one.

**And a man who is pinned gets lifted clear.** Sidestepping solves a hedge; it
does not solve a guard shouldered into the corner of a barn by two others, and
one vibrating against a wall for the whole battle is what "pathfinding blockage"
looks like. Three failed sidesteps and he is put on the nearest tile he can
actually stand on, searched outward in a fixed order.

### Tactical dispersion
The lanes are dealt in the frame the ADVANCE is in, not the muster's: `lane`
across the front, `depth` along it, rebuilt every tick against the current
heading, so the line turns with the march instead of carrying the muster's
north-east shape around the map. Eight men at 2.3 tiles hold a front sixteen
tiles wide.

And **two men to a body, no more.** Nearest-foe-per-man sent all eight at
whichever knot of the company they met first, and the fan the lanes had just
built collapsed into one scrum three tiles across. Every hostile takes at most
two claimants, in member order; a guard who finds nothing unclaimed in his sight
takes the next thing along, and only breaks the cap for a body already on top of
him. Measured through a battle: the widest pair goes 13 -> 15 -> 25 -> 31 tiles
as they spread over four fights at once.

### The farmlands did not have fire damage
**There is no environmental burn in the codebase.** `fieldfire` is a flame
sprite, a light and an ember hotspot; `farm.fires` is read by the layout and by
nothing else. Nothing on that floor has ever taken a point of health off the
hero for standing anywhere. So there was no burn tick to nerf, and I have not
invented one - a warning marker on a harmless thing is a lie in the UI.

What DOES take a low-level hero apart is the company, and it.103 made that far
more likely by moving the errand to right after the forest. Measured, before:
**a level-1 hero (150 HP, 3-7 damage a swing) against 22 bodies of 84-98 at
levels 3-4, and a mini-boss of 851.** Not a hard fight - an impossible one.

Every other zone scales off `deepestFloor`, which works because every other zone
is reached by going DOWN. The farmlands are not. The field now takes the higher
of the depth reached and the party's own level, the general is one band over the
field instead of two, and his shout reaches eight tiles instead of eleven with a
third off the shred and a longer cooldown - it was re-applying before it expired.
Measured, after: **14 bodies at levels 2-3 and a general of 626**, and a driven
run has the squad clearing the field down to the general alone, losing two men
doing it, with the hero standing still.

The fires did get the **footprint ring** the report asked for, as what it honestly
is: a flame sprite is tall and narrow, so from across a dark field you could see
that something was burning but not how much ground it stood on. A wide, low, dim
ring on the earth says where the fire is, and its embers now rise off that ring
rather than off one point, so the edge is legible while moving.

### The people stay (`src/town/Villagers.ts`, `src/town/Reclaim.ts`)
A procession's folk were left standing exactly where the bars lifted, for ever -
twelve people frozen mid-stride in a clearing is the first thing you see when a
homecoming ends. Every scene now hands its walkers to the district's own
`Villagers` on the way out: same spot, same body, same coat, and from the next
tick they path, wander, pause and talk like anybody else who lives there.

Two bugs had to be fixed under it before that worked at all:

- **The wander BFS could not reach a body outside its area.** The search box was
  the wander patch and nothing else, so somebody standing on the road could never
  find a way anywhere - it sat still for ever, asking four times a second. The box
  is the union of the patch and both ends of the walk now.
- **The un-cleared forest's wander patch is one tile at the origin, inside a
  wall** (it is only given a real patch when the forest is `safe`). Anyone handed
  to it had nowhere legal to walk to. `adopt` grows the patch to take in whoever
  arrives: the clearing they came home to IS their ground.

### Verified
`npm run build` clean, 0 TypeScript errors. `__qa75({ seed: 3, cls: 'mage' })`:
**406/406, no console errors**, with nine new checks - nothing on the field moving
or fighting through five seconds of a cutscene, no guard wearing a sheet the
company wears, every guard's anchor computed rather than 1, the line fanning past
six tiles with every man in his own lane, the field never more than a band over
the hero or their depth, and the forest's folk joining the clearing and walking it
under their own feet afterwards. Device matrix 74/74.

## 2026-09-09 (iteration 103) - The company flocks, the page is turned by hand

it.102 cut the squad loose and gave the cutscenes a voice. it.103 fixes how both
of them MOVE: the guards stop travelling as one glued body, the words stop
flashing past before they can be read, the fields end in a wood instead of a row,
and the muster is the thing that happens when you walk home from the woods.

### The company flocks (`src/systems/Squad.ts`)
it.102 moved every man straight at his goal and unpicked the overlaps
*afterwards*, with a positional shoulder pass. That is a collision fix, not a
movement rule: on screen it read as one mass that squeezed through gaps as a
single body and stacked four deep on whatever it reached.

- **Separation is steering now, not a correction.** Each man sums a repulsion off
  every neighbour inside `PERSONAL` (1.15 tiles) and blends it into his heading
  BEFORE he steps - hard when closing on a body (`SEPARATION_NEAR`), gentle out
  on the march (`SEPARATION_FAR`), so a line does not repel itself into a smear.
  The shoulder pass stays as a backstop for what steering cannot solve.
- **It is order-independent.** Positions are snapshotted before anyone moves, so
  the flock a man feels is the same whether he is first or last in the list. The
  old pass had the first guard steering around nobody and the last around seven
  already-moved bodies - which is exactly what produced "one mass with a tail".
- **On his mark but crowded, he shuffles.** Standing still used to switch
  separation off entirely, so the last half-tile of a converging charge still
  ended in a stack.
- **The ring round a body is dealt by the pack.** A man's place is his index
  among the men who came for THAT body, spread over a full circle and nudged by
  the golden angle, and the ring widens with the pack - six men surround a
  brigand instead of four arriving on the same shoulder.
- **No two of them walk at the same pace.** A multiplier per man off the floor
  seed, so a charge arrives ragged.
- `Squad.spacing()` reports the closest pair and the mean over all pairs, for
  the harness and for tuning. Measured mid-melee: closest 0.93, mean 2.47 over
  eight men.

### A belt of wood, drawn from the first frame (`src/scenes/Farmlands.ts`)
The border was one line of trees on the tiles that happened to touch open ground,
three in four. It is now **four rings**, found with a single BFS out of the
field: two solid rings of hedge and pine at the edge and heavy timber thinning
behind them - 739 trees where there were about 60, and the map ends in a wood.

And it is all on screen the moment the floor stands. The "pop-in" was never asset
loading (every tree single is resident from boot) - it was FOG: the belt faded in
ring by ring as the hero walked at it. The fields are open country, so the floor
is `revealAll`ed on arrival. The torch's own sight radius is deliberately left
short of the map (22): the hero still only *sees* what is lit, it is the shape of
the land that is known. Widening sight instead was tried and rejected - it put
the general's health bar on screen from halfway across the field.

### The page is turned by hand (`src/town/Reclaim.ts`, `src/ui/CineDialogue.ts`)
Spoken lines had a 3.4 s timer. A line of dialogue in a language you are reading
for the first time does not fit in 3.4 s, and there was no way to hold it.

- A beat with a name on it now sets `awaiting`, and **no further beat is shown
  and the scene will not end** until the player advances it. Space, Enter, E, or
  a tap anywhere on the letterbox - the listeners live and die with the scene.
- The corner box shows `SPACE CONTINUE` / `TAP TO CONTINUE` under the line, read
  at say-time so a phone plugged into a keyboard gets the right one.
- **Everything else keeps running while it waits** - the walk, the camera, the
  light. A procession that freezes mid-step reads as a hang, not as a pause.
- The harness had to learn to read: `readScene()` drives a frame and presses
  Space when a line is waiting, and the checks assert how many pages it turned.

### The muster is the forest's reward
Up to it.102 the city would not ask until the eastern quarter was ALSO settled,
and then only if the hero happened to walk onto the training ground. That put an
unrelated errand between clearing the woods and the city's next word, and the one
scene that explains why the fields matter could sit unseen for an hour.

**It fires on coming home.** Walk back through the gate with the woods behind you
and the camera goes to the yard. The muster itself is bigger to match: eleven of
the watch drawn up under the colours (was four) and twenty-eight of the ward
pressed in on three sides (was fifteen), with sixteen more still coming up the
road.

The "has this played" flag **moved into the quest ledger** (`quests.rally`).
It was a run-scoped variable, which meant a save reloaded in town with the errand
unclaimed came home again - and played the whole rally a second time.

**The post at the yard now has two jobs**, and the officer hands the second one
back: once the city has asked for a sword he holds the training ground, so his
"the fields are ours" word carries a THE YARD choice that opens the training
sign's own offer. Without it the muster would have orphaned the tutorial.

### The homecomings track the group
- **The camera follows the group, not the leader.** It was pinned to whichever
  walker was furthest along, so it jumped sideways every time two of them swapped
  places. It now eases toward the centroid of everyone on the road (biased a
  third toward the head, so it leads rather than trails).
- **The spotlight is anchored to the group and opens out with it** - a column
  strung along the road is lit by a wider pool than one still bunched at the gate.
  Everyone is lit the whole way in, not just the person in front.
- **Staggered waypoints.** Each walker's lateral and forward offset is now dealt
  per LEG, not once for the route, so a column that funnels through one waypoint
  comes out of it spread instead of single file through one tile.

### What the fight looks like now
- **The guards' blows are visible.** A guard's swing left nothing on screen but a
  damage number, so a squad fighting looked like a squad standing next to bodies
  that bled. Each blow throws the same cold-steel arc and spark the hero's does,
  off the guard's own shoulder into the body he is swinging at.
- **A man going down, and a man getting up**, both throw something the eye
  catches from across the field: a blood burst and a gore hit; a blue ring and a
  cold puff.
- **A ring under whoever is speaking** in a cutscene - gold for the city, red for
  the company. The box says who is talking; this says where they are, on a field
  of thirty bodies, without another line of text.
- **`Enemy.platesOff`**: `body.cine` takes every DOM layer off the screen, but a
  foe's name, level and life are PIXI text on its own container - so a brigand
  standing where the camera happened to look wore "THORNED BRIGAND · Lv 1" across
  the letterbox in every cutscene since it.84. Raised with the bars, dropped when
  they lift, and reset on every floor build.

### Verified
`npm run build` clean, 0 TypeScript errors. `__qa75({ seed: 3, cls: 'mage' })`:
**397/397, no console errors**, including twelve new checks - the muster called by
coming home from 34 tiles away, six spoken lines each waited on and advanced, the
company's word waiting in red with a name on it, the belt of wood at 739 trees
and three rings deep with none of it still fogged, the flock holding 0.93 between
its closest pair and a 2.47 mean in a melee, and both jobs of the post at the
yard. Device matrix 74/74.

## 2026-09-09 (iteration 102) - An army of its own, and a field that changes

it.101 made the farmlands legible. it.102 makes them ACT: the squad stops being
an escort and becomes a company with its own objective, the fields are entered
from the corner the road actually comes down on, every word spoken over a
cutscene has a name and a face attached to it, and the land itself changes the
moment it is taken instead of waiting for the hero to walk home and back.

### The compass, re-cornered (`src/scenes/Farmlands.ts`)
The city road now lands at the field's NORTH-EAST CORNER and bends down onto the
land in three legs, rather than running straight in through the middle of the
east verge. The company is dug in west and south-west, so the whole battle is
fought on the long diagonal - the widest line the map has - and the cart track
was re-laid to follow it, from the road head down and across to the general's
ground. The muster forms up under the corner; the signpost home stands at the
head of the road, above and outside the muster.

**One locked gate, and it is on the west edge.** The north road is gone. The
fields have exactly ONE way the hero can walk up to and be told no: the western
road, the one the company came up and barricaded behind them. It carries the
gateway arch banked down to half brightness, and both its plate and its prompt
say BARRICADED - so nothing on this floor is a signpost that says "not open yet"
about a road that is, in fact, open. The `farmway` prop kind (the it.101 "open"
western road, which said OPEN on its plate and "nothing walks it yet" in its
note - two contradictory things about the same arch) is deleted outright.

**Chests in both states.** Eight of them, scattered the length of the diagonal,
in the burning field as well as the quiet one. A field worth fighting across is
worth searching while you fight across it.

### The company (`src/systems/Squad.ts`)
In it.101 the formation was anchored to the HERO. The squad was a ring that
marched wherever the player walked and only ever fought what the player walked
into; it read as a bodyguard, not as the city's army. Now:

- **The line is its own.** The squad keeps a front (`lx`,`ly`) and advances it on
  an OBJECTIVE - the ground the enemy holds - at a march pace, by itself. Under
  contact it presses at a quarter pace rather than stopping, so the men who are
  actually swinging are never walked out from under. `step()` takes the hero only
  as a RALLY point, used after the field is won.
- **Every man picks his own fight**, inside his own sight, not inside a radius of
  the player.
- **Every man walks his own road.** Each has an A* path of his own, recut on his
  own stagger (`REPATH_TICKS` + id), so a barn between him and his quarry is
  walked round instead of leaned on.
- **Every man carries his own life on his head**: a blue segmented bar, the exact
  mirror of the red one every hostile wears (same 26x4 plate, same quarter
  notches, same `hudScale` so it holds screen size at any zoom). The officer's is
  gold and always full - nothing puts him down.
- **The ranks are different men.** Eight kits across four eight-direction sheets -
  the watch in steel, bronze and blue, household knights in mail, rangers of the
  eastern road, a scout of the ward - dealt from a shuffled bag off the FLOOR
  SEED, so every peer turns out the same men and nothing here touches the shared
  combat RNG. The floor's preload was widened to pull those sheets in; without
  that the bag could only ever deal sheets some other system happened to need,
  which is why the it.101 watch was guards and knights and nothing else.

**And the enemy splits.** `ALLY_AGGRO` went 9 -> 14, and a hostile's choice
between the hero and the nearest guard is now weighted by `allyBias(id)`: two ids
in three treat a guard as nearer than he is, the rest still come for the hero.
The weight is a pure function of the body's own id - no state, identical on every
peer - and `CombatSystem.enemyStrike` takes the same weight through a new
`AllyHooks.prefer`, so the blow lands on whoever the body actually ran at.

### Everything said over a cutscene now has a face (`src/ui/CineDialogue.ts`)
Up to it.101 a scene's words were floating world text: gold, small, gone in a
second and a half, and anonymous - a crowd scene was six unattributed shouts, and
on a phone they were not readable at all. `#cine-speak` is a portrait box pinned
in the LOWER-LEFT corner above the letterbox: the speaker's face cropped to the
head, their name, who they are, and the line at panel size. It reads in the
city's gold or, for the company, in red. It is the one head-up element `body.cine`
deliberately leaves on screen.

A named beat no longer ALSO prints the floating word - stacking the same sentence
in full-width gold caps across the middle of the frame put it straight over the
scene's own title. What stays over the body is a flare of light, which is all the
floating text was doing there anyway: pointing. Unattributed beats keep the old
gold shout.

- **THE MUSTER** is six named speakers: three of the ward's own people pleading,
  SERJEANT BRAY holding the crowd back, and CAPTAIN ORDWAY answering last.
- **THE GENERAL'S ORDERS** name GENERAL VARRICK and read in the company's red.
- **THE FIELD TAKEN** is Ordway and the folk walking back onto their own acres.

`#controls` (the COMMANDS cheat-sheet) was the one HUD panel `body.cine` had
never been told about, and it sat over the bottom bar through every cutscene in
the game. It is in the list now.

### The field changes under their feet
The it.101 reward said the land was the city's while the land was still on fire:
the burnt map stood, smoking and empty, until the hero walked home and came back
out. The floor is now rebuilt IN PLACE the moment the errand closes, on the spot
the hero is standing, behind the same fade the stairs use - fires out, corn whole,
villagers on the land, chests in the yards, the fire tint off the page and the
town's bed back under it.

### Fire, embers and drums
- **The firelight breathes.** One compositor animation on `#vignette` under
  `body.afire` - the warm wash swells and falls on a slow uneven cycle instead of
  sitting still. Nothing per frame in script, and off entirely under
  `prefers-reduced-motion`.
- **The motes are embers.** Over a burning field the same 64 mote sprites are
  dyed live coal (four tints, dealt per mote), climb faster, carry their own
  light rather than only what the scene lends them, pop as they burn out, and
  62% of them respawn on the fires themselves instead of 35%.
- **The fields fight to their own drums.** A new `battle` music bed with six
  marching and clashing tracks, kept apart from the wardens' arena shelf. A
  burning field is the only army-against-army fight in the game and it was
  running on the forest's wandering playlist.

### The homecomings (`src/town/Reclaim.ts`, `src/town/Villagers.ts`)
- The FOREST and the EASTERN QUARTER processions were still eight copies of one
  `folk_walk` peasant in one coat, walking through whatever stood on their route.
  Both now deal from the town's civilian sheets and slide along walls, like the
  farmlands' has since it.101.
- **Nobody stands inside anybody.** A shoulder pass over the walkers, and the
  same pass added to `Villagers` - which had never had one, so two of the folk
  who took the same corner, or who were set down together on a small reclaimed
  patch (a forest clearing, a taken field), stood inside one another and read as
  one body with a rendering fault.
- **Spotlights that travel.** `Lighting.addSource` bakes into the tile map at
  build time, so a column walking the length of a road was lit only where main
  had laid a lamp before the scene started. Two additive halos now ride the
  scene: one over the mouth of the road they come out of, one that follows the
  head of the column the whole way in.

### Verified
`npm run build` clean, 0 TypeScript errors. Driven live in the browser end to
end: the muster with named portraits, the general's orders in red, the squad
advancing on the objective and drawing blood with the hero standing still (front
46.6 -> 43.2 toward the general, three of the company down, two guards bloodied),
the blue bars over the ranks, the field taken and transformed in place with the
250 gold paid and Ordway's word on the taken ground. Device matrix 74/74.
`__qa75({ seed: 3, cls: 'mage' })`: **384/384, no console errors**, with eight
new checks for this iteration (the corner arrival, the muster ground under it,
the one shut gateway and its plate, no other signpost on the floor saying a way
is shut, chests over the burning field, the ranks drawn from more than one
sheet, each man's own life, the squad going in with the hero standing still, the
line advancing on the objective, and the field becoming the quiet one without
the hero going anywhere).

**A flake worth writing down.** Twice in five sessions the depth-I command block
(`click-attack`, `pickup`, `skill 1`, `a draught`) failed *together* - four
queued commands that did nothing - and passed on a re-run at the same seed. It
is in a block it.102 does not touch, and it only appears when the machine is
loaded (two dev servers and a build running beside a hidden tab). Left recorded
rather than papered over: four command checks failing as a group points at
something clearing the input queue, and it is worth a look next iteration.

### Three fixes that came out of driving it
1. `#controls` was never in the `body.cine` hide list, so the COMMANDS
   cheat-sheet sat over the bottom letterbox bar in every cutscene in the game.
2. A named beat was printing its line twice - full-width gold caps over the
   scene's own title. The word went to the corner and a flare of light stayed
   over the speaker.
3. `cit_carter_walk` crops to a hooded head that reads as a black square at
   58 px; the porter's sheet stands in for the carter in the corner box, which
   is the only place a civilian's face is ever seen that large.

## 2026-09-09 (iteration 101) - The farmlands, fought properly

it.100 built the campaign. it.101 is the pass that makes it read like one: the
compass is fixed, the way home works, the guards actually fight, and nothing of
the HUD is left standing in front of a cutscene.

### The two bugs underneath it all
`isBossFloor` is a plain `floor % 5 === 0`, and THE FARMLANDS are floor 105. The
fields were therefore being dressed as a warden's depth: a blood-red seal in the
middle of the corn with a PENTAGRAM turning on it, and - far worse - the floor's
STAIR replaced by that seal, which is why there was no way back to town from the
fields at all. Both the sigil and the broken exit were the same line of code.
Nothing past the town gate is a depth floor now, and none of them may take a
depth floor's furniture.

### The compass (`src/scenes/Farmlands.ts`)
The marsh gateway stands on the WEST side of the city, so the road out of town
runs west - which means the hero and the squad arrive on the field's EAST edge
and fight westward into it. Everything follows from that: the muster ground and
the road home are east, the company and its general hold the west, and past them
THE WESTERN ROAD stands open, lit and unbarred, pointing at country the campaign
has not reached yet. The north road is the one that is still barricaded.

The field itself is no longer a rectangle. It is the union of five overlapping
lobes with a wobbled verge, 64x48, and every tile on its border carries a tree -
so the map is outlined in wood instead of ending at an edge. It draws no wall
cubes at all (`wallsFromProps`), because an organic border touches open ground
on every side and the scene's grey blocks were standing up in the corn wherever
the hedge did not happen to cover one. Three steadings stand on the land - the
home farm by the city road, one in the middle field, and the western one the
company came through - each with a farmhouse, an outbuilding and a fenced yard.

### The guards who came with you (`src/systems/Squad.ts`)
In it.100 the squad held a line around the spot it was set down and the enemy
ignored it, which read as two battles happening beside each other. Now:

- the formation is anchored to the HERO, so the line marches with the assault;
- a guard breaks off at anything inside the leash and runs it down, taking his
  own place on a ring round the body (dealt by id on the golden angle) so a
  squad arrives as a melee instead of as one sprite on one tile;
- guards shoulder each other apart, and a guard wedged against a hedge for a
  third of a second picks a side and walks round it;
- HOSTILES FIGHT BACK. `EnemyAIDeps.getPlayerPos` hands each body one quarry;
  on the fields that answer is now the nearest GUARD when a guard is closer than
  the hero. There is still no faction field anywhere and the hero's own target
  picking still only ever sees enemies, so friendly fire remains impossible by
  construction - only the answer to "who is in front of me" changed;
- a guard can be hurt and can be put down, and gets up again after seven
  seconds. The officer takes none: a field with no officer left on it would have
  nobody to end the scene;
- the ranks wear four different plates and the officer is a head taller in white
  under the city's colours, so the leader is picked out of a melee at a glance.

### The theatre
- THE MUSTER is now a rally: the watch drawn up on the yard, fifteen townsfolk
  standing round them and twelve more still coming up the road, every one of
  them out of a different sheet. The CITIZENS do the asking - five of them, in
  turn - and CAPTAIN ORDWAY answers last, under the colours, which is what puts
  him at the centre of the frame when the dialogue opens on him a beat later.
- THE GENERAL'S ORDERS: arriving on the fields crosses the camera to the far
  end of the burning rows, where the company's general orders the crop and the
  farmers put to the torch. Once, on arrival, while the field is contested.
- THE GENERAL wears the wardens' own health bar - name, level and numbers at the
  top of the screen - but it waits until the hero sights him for real, so it is
  not pinned across the whole march west.
- A CLEAN FRAME. While a cutscene runs the page wears `cine` and every head-up
  layer is hidden in ONE stylesheet rule instead of each panel remembering to
  hide itself. The world's own name plates go with them, and the folk stop
  talking - a word about the weather floating over a letterboxed rally is
  exactly the bleed-through the bars are for. The bars themselves are deeper.
- A PROCESSION IS A CROWD. Walkers are dealt from the town's civilian sheets
  with a coat apiece, each keeps a FIXED place in the column (the goal used to
  be recomputed from the walker's own live position, which is what made the
  column wobble and swap), and each one now tests the ground in front of it and
  slides along what it cannot cross instead of walking through hedges and carts.

### Also
- The refugee at the eastern barricade called Coleslaw "she". He is a man.

## 2026-09-09 (iteration 100) - The farmlands campaign

The city's third errand, and its first pitched battle. It unlocks on its own once
the woods and the eastern quarter are both settled.

### The muster (the training ground)
Walking onto the training yard calls a rally: the letterbox comes down, the folk
gather, and CAPTAIN ORDWAY of the city watch explains that a free company has come
up the marsh path, taken the fields and started burning the crop - not to hold it,
just so the city cannot have it. Taking the errand opens the marsh gateway south
of the market plaza, which until then is a road with the boards still being laid.

### The fields (`src/scenes/Farmlands.ts`, floor 105, mode `farm`)
A 52x40 outdoor floor in the town's own idiom, so it sits beside the city rather
than beside the crypt: grass headlands, six ploughed strips, a cart track down the
middle, and scorched earth across the eastern half while the company holds it.

- **The art** is the town's existing prop set - fences, carts, casks, crates, a
  well, stalls, spiked barricades, trees - plus four pieces cut for this floor:
  scorched ground (four variants the town theme picks between), standing corn in
  three heights, the blackened stubble the fire leaves, and live coals. All from
  the Ancient Isometric Tileset's own ground and nature art.
- **The fire** is twenty-five burning stands in the corn, each a flame loop with
  its own light and an ambience hotspot, so embers rise off the fires without a
  single extra sprite. The mist field is re-tinted and thickened into smoke, and a
  warm gradient sits over the whole screen - one CSS rule on the existing vignette,
  so a phone pays nothing for it and it comes off the moment the field is won.

### The squad (`src/systems/Squad.ts`)
Six of the city's guards and their officer. A squad member is deliberately NOT an
`Enemy` with a flag flipped: hostiles chase exactly one quarry (the hero, passed
into `Enemy.update`), so an ally is invisible to them by construction. No faction
check is needed anywhere, friendly fire is impossible because the hero's target
picking only ever sees enemies, and a guard cannot be killed - which is the point,
since a wiped squad would make the field unwinnable.

They run at the nearest hostile inside their leash, swing on a cooldown, and deal
their blows through `CombatSystem.dealDamage` credited to the hero, so experience,
loot and the difficulty floor behave exactly as if the hero had swung. It all runs
on the fixed sim tick, so a co-op party stays in step. Every friendly wears a cool
halo at the feet and a blue chevron over the head - DOM, so it stays crisp at any
zoom and legible on a phone.

### The company and its general
Hostile humans only. The rank and file are `mercenary`, on the one eight-direction
man-at-arms rig in the packs that was NOT already the city's own guard - because an
enemy that shares a silhouette with your squad is a bug, not a style. The
`general` is the same body a head taller in darker colours, with 460 life.

While he stands and the hero is within eleven tiles, he shreds their plate and
takes their legs every five seconds and says so overhead. Statuses proper are
enemy-only (`StatusSystem.inflict` takes an `Enemy`), so ARMOUR SHRED is a bespoke
pair of fields on `Player` in the shape `slowTicks` has always had, felt inside
`get armor()` and surfaced in the buff HUD as a debuff.

### Taking it, and keeping it
The last of them down brings the letterbox in again: the officer's thanks, the folk
walking back onto the land, two hundred and fifty gold from the city purse. After
that the fields are a lit, quiet safe zone - fires out, corn whole, eight of the
city's people working the rows, three chests in the yards, and both roads on still
barricaded, because the marsh beyond them is not the city's yet.

### Also
- The forest liberation's lighting, fixed in it.99, was re-verified end to end:
  the entry, the middle of the route and the far end all read full brightness for
  the length of the scene.
- TROOPS REMAINING counts the company on the HUD, with the same screen-edge
  chevrons the forest uses - which already widen their margin on a touch screen.

## 2026-09-08 (iteration 99) - A scene that carries its own light, and a town full of strangers

### The liberation scene was lit from the wrong place
The it.98 lamps did nothing, and the reason was not the lamps. Fog is keyed by
tile and `updateRender` only re-tints tiles in `visibleSet` - and `visibleSet` is
computed from the HERO. During a cutscene the camera leaves the hero entirely, so
everything it looked at sat at the flat explored shadow, unlit by anything,
including the sources the lamps had added. The people walked in over dead ground.

Three changes, and now the scene carries its own light:
- `Lighting.setSceneLight(on)` opens the sight radius to at least 22 and pushes
  full brightness out to at least 14 for the length of the scene, then gives the
  floor its own radii back.
- While `cineFocus` is set, the render pass drives `updateVisibility` from the
  CAMERA each time it crosses a tile, so the ground the procession walks over is
  VISIBLE and therefore re-tinted every frame.
- `lightTheWayIn` now hangs a warm lamp every five tiles along the WHOLE route
  rather than over the first stretch only.

Both processions - the town's reclaiming and the forest's homecoming - use it,
and the light is released with the letterbox.

### The taproom keeps its regulars; the town gets its own people
The four bodies that walk in circles read as drinkers moving between tables
indoors and as aimless milling outdoors, so they are now the taproom's alone
(`TAVERN_FOLK`). Every open district - both town wards, the eastern quarter and
the cleared forest - walks `STREET_FOLK` instead: five civilians composited at
bake time from the Spell of Mastery layered pack (CC-BY 4.0, "NancyGold / Spell
of Mastery"), the same pack Sarah came from. A bearded farmer, a porter, a robed
monk, a goodwife and a maid, each a different stack of body kit, footwear, legs
or skirt, chest, belt, sleeves and hair - so no two share a silhouette, and the
streets have women on them for the first time.

Two more come from the Kenney isometric pack's `Characters/Male` (CC0), which is
not eight characters but ONE man in eight facings with a ten-frame stride: a
bare-armed labourer in a rust tunic, and the same body re-dyed cold blue-grey for
a carter. That is the only genuine eight-direction civilian in the packs, and its
facing order was read off a contact sheet of its own idle frames before baking:
file D1 is the right profile, D3 the full front, D5 the left profile, D7 the full
back, which gives the canonical map directly. Seven bodies walk the streets.

`Villagers` gained a `sheets` option, so which bodies walk a place is now the
caller's decision rather than a module constant.

**The direction trick.** The pack draws two facings - south in rows 0-2, north in
rows 3-5, with the four-frame walk cycle on row 1 and row 4. The engine wants
eight canonical rows, `[E, NE, N, NW, W, SW, S, SE]`, so each is filled from
whichever facing it shows and mirrored where it leans the other way: walking away
reads from the back, walking across the view reads from the front. The rows come
out canonical, so no `DIR_ROW_FIX` entry is needed.

## 2026-09-08 (iteration 98) - Names, a crowd, and a town that remembers

### The cellar
- The free-standing arched stone cubes are gone. They read as a low archway you
  could not walk under, standing in the middle of the floor; columns, casks and
  crates hold those spots now. The three ROUND STONE ARCHES in the wall runs stay
  - they are the passages between the three chambers.
- **SARAH** is the woman at the deep end, and she is not down there while anything
  else is. She is built with the floor but taken out of the object layer and
  stripped of her word until the last monster falls; `revealCellarGirl` puts both
  back the moment the vault goes quiet, one beat before the camera turns to her.
  Hiding her by `visible` alone did not hold - the ambience rewrites that from the
  fog every frame, and the culler owns `renderable` - so she is detached instead.

### The people
- **COLESLAW** keeps the Gilded Stag. He is a man on the peasant sheet
  (`folk_walk`), anchored at the sole like the sentry rather than at the villager
  coat's padding, and every line and prompt is written for him.
- **SIR HAM** holds the eastern road; his name is on the gate prompt and on both
  of his dialogues.
- **THE STREETS ARE NOT ONE MAN.** Four bodies walk the town instead of one -
  `folk_walk`, `villager_walk`, `merchant_walk`, `poacher_walk`, dealt round so no
  street is all one figure - each carrying its own painted height, anchor, frame
  count and scale (a sheet is not interchangeable with another), plus a coat colour
  multiplied into the scene's light. Every one of them is already registered in
  `SpriteLibrary.DIR_ROW_FIX`, so they all face the way they walk, and the three new
  sheets were added to the hub, inn and forest atlas rosters.

### The map remembers
- Fog of war now survives a zone change. `captureFloor` writes a fog-only entry for
  the town-shaped floors (the town, the forest, the quarry, the taproom, the vault),
  which are rebuilt from their layout and the quest ledger every visit and so can
  keep nothing else; the crypt keeps its full FloorMemory as before. Every floor
  restores whatever bitset it left behind.
- The capture happens inside `swapWorld`, before the outgoing world is torn apart,
  so even a rebuild of the SAME floor keeps its light - which is how the taproom no
  longer forgets itself when its back door is unbolted.
- No save version bump: `floors` round-trips unknown keys, and an old save simply
  starts those zones unexplored.

### Two smaller things
- **The road home.** Out of the woods the party now steps back onto the eastern
  road beside the gateway they left by, instead of the middle of the old quarter
  half a town away. `goHome` takes the gate to arrive at.
- **The way in is lit.** A procession walks its people in over ground the hero has
  usually never stood on - unlit, often unexplored, so they arrived as silhouettes.
  `lightTheWayIn` opens the fog along the first stretch of the route and hangs a
  warm lamp over it for the length of the scene. Both the town's reclaiming and the
  forest's homecoming use it.

## 2026-09-08 (iteration 97) - The cellar under the Gilded Stag, and walls that hold still

### No more flicker, no more clipping (`town/TownProps.ts`)
Walking a wall in the taproom made the run strobe and the hero clip through it.
Two separate causes, both now fixed the way the engine's own wall cubes do it:

- **Sorting.** A wall piece was keyed on its NEAR corner with no nudge, so its
  depth tied with the hero's every other tile and the two panels either side of
  them sorted opposite ways. The key is now `depthKey(x, y + 1) + 4`, which sits
  strictly between the tiles behind the piece and the tiles in front of it for a
  run along either axis. No ties, and the hero is always drawn over the wall they
  are standing in front of.
- **Lighting.** Fog is keyed by tile, and a WALL tile only wins line of sight
  when the hero stands nearly level with it - so a panel lit from its own tile lit
  a three-tile window that slid along with the hero and left the rest of the run
  dark. Every wall-mounted piece (the panel, a painting, a torch and its glow) is
  now lit from the floor tile it FACES, through a shared `litTile` helper.

### THE CELLAR (`src/scenes/Cellar.ts`, floor 104, mode and theme `cellar`)
A 34x26 vault under the taproom, and a second errand from its keeper.

- **The art**, baked by `scratchpad/assets97.py` into 39 atlas entries, all from
  packs already in the repo: the Ancient Isometric Tileset's near-black `wall_5`
  runs, its `wall_3` brick for the internal walls, **real round stone archways**
  from `doorway_3`, the 128-cube arch blocks from `arch/small` as vault piers,
  columns from `blocks/pillar3` and `pillar6`, the altar slab, loose blocks, a
  cobweb, the stair head, damp flagstone and packed earth floors (quadrant-sliced
  and parity-picked, as the taproom's are), and Dungeon Pry's water and blood
  stains. The taproom's own casks, crates and bottle shelves are reused - they
  are the stock the errand is about.
- **The shape.** Three chambers: the stock room along the north, and two deep
  chambers below a cross wall, joined by three stone arches. 581 floor tiles,
  every one reachable, no pockets. Three chests, off the paths.
- **The dark.** Unlike the taproom this floor takes real fog (`sightRadius: 8`,
  `fullRadius: 3`), so the chambers open a few tiles at a time - and the woman at
  the deep end is not seen until the hero reaches her.
- **The monsters** come from `CELLAR_POOL` - spiders, the risen, a shambler. Not
  one man among them.

### The errand, end to end
1. With the quarter's errand paid, the keeper offers a drink, admits every bottle
   she has is in the cellar, and asks the hero to go down. The back door in the
   taproom's north-west wall is `inn_door_w_shut` until then, and says so.
2. Taking it flips `quests.cellar` to `active` and rebuilds the taproom in place
   with the leaf swung open, so the bolt slides back in front of the player.
3. The last monster down brings the letterbox in, opens the fog on her alcove and
   holds the camera there (`ProcessionScene` gained an optional `hold`).
4. NELL speaks - the hero says nothing - and presses a hundred gold and a health
   draught into their hand, per hero of the party. `quests.cellar` becomes `done`.
5. She thanks the hero whenever she is asked, and once the hero goes back up the
   stair she is standing by the bar for good. The keeper names her and thanks the
   hero a second time.

Her sprite is composited at bake time from the Spell of Mastery layered pack
(CC-BY 4.0, "NancyGold / Spell of Mastery"): the female body kit under a long
skirt, bodice, sash, sleeves and loose hair, with the pack's own idle bob. It is
the only genuine female civilian art in the repo - the Flare "Heroine" sheets
turned out to be off-hand WEAPON layers with no body on them.

The keeper is MARGO, as she has been since it.91; the errand is written for her
rather than for a new character.

## 2026-09-08 (iteration 96) - The Gilded Stag, built of tileset pieces

Every earlier inn was drawn by the engine or painted from the reference sheet;
this one is assembled from real isometric art and nothing else.

### The art (`scratchpad/assets96.py` -> 50 atlas entries)
- The **Ancient Isometric Tileset** (`test-models/3rd town part/new/Isometric tileset`)
  is the room: `interior_1` plaster-and-wainscot walls, the `doorway_1` arch and
  its swinging door leaf, the `doorway_3` stone arch as the hearth, the `clutter`
  furniture (short tables, two chairs, a stool, a cupboard, crates, casks, pots,
  plates, box goods, paintings, posters), and the four-frame `burn` and `torch`
  loops.
- The **Dungeon Pry placeables** give the pieces that set has not baked yet:
  the alchemy shelf of bottles, the bookshelf, two barrels, the long table, two
  bordered carpets, the flasks, and the chest that is the warded stash.
- **Scale.** The tileset's own reference characters stand 110 px on a 256 px
  tile; our hero is 56 px on a 64 px tile - exactly twice. So every piece of
  that set is baked at **0.5**, which makes one wall piece span TWO game tiles
  and one source floor diamond cover a **2x2 block**. The floor is therefore
  sliced into four quadrants (`inn_boards_0..3`, `inn_stone_0..3`) that the
  scene picks by tile parity `(gx & 1) + 2 * (gy & 1)`, so the planks run on
  unbroken - the fix for the "broken block floors".
- **No seams.** Each quadrant has its colour bled outward three passes and then
  an exact diamond alpha mask stamped on it, so no transparent fringe survives
  to draw a grid over the boards.
- The bed is the project's own `bed01.jpg` render, keyed off its studio grey and
  graded from lacquer red to stained walnut with linen bedding. Nothing in the
  inn is drawn procedurally.

### The room (`src/scenes/Inn.ts`, floor 103, 28x24)
- Wall pieces stand on the far edges by the tileset's own convention: the
  image's bottom-left meets the 2x2 block's bounding-box bottom-left
  (`case 'innwall'` in `TownProps`). `wall_n` runs along +x, `wall_w` along +y.
- The hall: boards throughout, flagstone behind the bar and on the hearth's
  apron; a seven-piece bar counter along the north-east wall with the keeper
  behind it, bottle shelves, a bookcase, kegs and crates at his back and four
  stools before it; a stone hearth in the north-west wall with a live fire, two
  chairs and a rug; five table clusters, two carpets, a cupboard, a cask, crates,
  pots and a long table; three paintings and twelve wall torches, each a light.
- Partitions ghost like a cottage roof (they are pushed to `occluders`), so the
  hero is never lost behind one.
- `TownMap.wallsFromProps` tells `SceneManager` to draw no wall cubes here: the
  inn's walls are the tileset's own pieces.

### THE RENTED ROOM
- The layout is a pure function of `quests.east`. **Locked** (anything before
  `done`): the room's tiles are `TILE_WALL`, so nothing is drawn and nothing is
  lit - the doorway carries `inn_door_shut` and the space beyond it is black.
  **Unlocked**: the floor is carved, the door piece becomes `inn_door_open`, the
  gap at (23,13) opens, and the room is dressed with the bed, the warded chest,
  a rug, a cupboard, a crate, two pictures, flasks and four torches.
- The reward step rebuilds the inn in place (`withFade` -> `buildWorld(INN_FLOOR)`)
  so the key turns in front of the player rather than on the next load.
- **The warded chest is the town stash.** It is the same `stash` interactable the
  town keeps, so what is left in it comes out of any stash point, and in co-op
  every hero of the party reaches the same shelves.
- Both states audit with zero unreachable floor tiles.

### Fixed on the way
- The it.95 rewrite had deleted the *gate* innkeeper prop case along with the old
  inn block, which broke the whole Eastern Quarter errand. Restored, with the
  `chest` case beside it; `qa75` caught it.

## 2026-09-08 (iteration 95) - The inn built of pieces, no popping, the rotunda gone

- THE GILDED STAG, rebuilt from the engine's own pieces after the painted backdrop was rejected: plaster-and-timber wall blocks (`inn_wall_tex` baked, `AssetManager.buildInnWall` -> `wall_inn`, the `inn` theme's suffix; lighter shade, no mortar seams, plaster tint in lamplight), boards underfoot, a timber door set in the south wall (`inn_door` from the Medieval Building pack, drawn in front of its block), a stone arch on the partition, the bar along the north wall (counters, bottle shelves, kegs, the keeper behind), a hearth in the west wall with chairs and a rug, six round tables with stools and two long tables with chairs, bookcases and display cases along the walls, candle stands, crates and kegs in the corners, a carpet from the door to the bar, eleven sconces; the rented room through the arch with the bed, chest, bench, table, chair, rug and bookcase. The 30x24 map audits with no pocket.
- NO POPPING: the culler's margins grew to the widest sprite (480 px) and the tallest (600 px) so a building or a pine at the screen's edge is drawn before its anchor enters the view.
- THE ROTUNDA is gone; the square's centre is open cobble.

## 2026-09-08 (iteration 94) - The painted hall, and keys on the word

- THE GILDED STAG is the artwork now (`first-isometric-tavern...webp`, given as the reference): keyed off its dark surround and scaled to our grid (228 px a diamond -> 64), it is one `backdrop` prop under the room (`TownMap.backdrop` makes the scene draw no tiles); the walkable floor is authored over it tile by tile (`HALL` in `scenes/Inn.ts`, from the room's outline and a colour pass, the counter and the six tables shut); the bar counter is cut from the picture (`barfront`, sorted at the counter's south edge) so the keeper stands behind it; the painted hearth burns with the campfire's flame; five `sconce` lights and six `tablelight` candles throw real light. The rented corner sits by the hearth under the loft stair. Culling exempts painted pieces (`noCull`).
- The project already holds Remos' Isometric Medieval Tavern (CC-BY 4.0) under `test-models/tavern` - the exterior renders the quarter's inn is built from; the search found no freer interior at this quality than the reference itself.
- KEYS ON THE WORD: the dialogue's choices walk with the arrows (W/S, Tab too), light up, and Enter or Space takes the lit one; the mouse lights what it hovers.

## 2026-09-08 (iteration 93) - Express fixes: the inn's room, the hill road, walk-through clutter, the rotunda, the errand paid in the forest

- THE INN'S ROOM: the bed is a 1x2 footprint with the big render (`bed_big`, 150 px) and the hero lies at its middle, drawn above it (`Player.syncRender` lifts the sleeper's zIndex); an arched `doorway` (`inn_doorway`) on the partition's gap and over the street door; bookcases along the north wall, the hearth moved into the west wall with chairs before it, the sword case, a rug, a chair and a box in the room.
- THE HILL ROAD: the north-east lane carved at 1.7 half-width up to the gateway, both verges lined with pines and oaks (a perpendicular walk along the polyline at 2.6 and 3.3 tiles).
- WALK THROUGH: `CLUTTER_KINDS` grew - heaps, wall stubs, boulders, benches, tables, crates, kegs, chairs, candle stands and doorways never block a tile (the map's `block` and `tryBlock` honour the set).
- THE ROTUNDA: a decal, sorted at its centre, never an occluder - walked into, in front of its far columns and behind its near ones.
- THE FOREST ERRAND is paid in the clearing: after the homecoming the gatekeeper's thanks and the hundred gold arrive where the hero stands (the folk stay, `keepWalkers`); the road home is the signpost, when wanted.

## 2026-09-08 (iteration 92) - The Gilded Stag inside, the forest's homecoming, the streets walked, chests in every district

### Words
- Every dialogue rewritten plain: the gatekeeper, the refugee, the innkeeper
  (all four states), the sign at the yard, the gateways' notes. Short lines,
  no theatre; the gold still in parentheses.
- Ambient chatter is everyday talk now: `TOWN_WORDS` ("Nice weather today.",
  "Greetings.", "So much work to do."), `VENDOR_WORDS`, `GUARD_WORDS`,
  `REFUGEE_WORDS`, `RECLAIMED_WORDS`, and `TAVERN_WORDS` for the inn.

### The Gilded Stag inside (`src/scenes/Inn.ts`, floor 103, mode `inn`)
- The inn is a floor of its own: a 24x20 stone-walled hall with boards
  underfoot (`KIND_PLANK` = 4, four `town_plank_*` diamonds drawn by hand),
  the bar along the north wall (`inntable` counters, `shelf` cases, kegs)
  with the keeper behind it (`barkeep` -> the `innkeeper` interactable), a
  `hearth` in the west wall (the campfire's flame, a wide warm light), long
  tables and chairs from the library pack (`inn_table_a..d`, `inn_chair`),
  candle stands (`candle`, lit), a `carpet` from the door to the bar, and
  the corner room past a doorway in the east partition: the bed, the chest
  (the stash), the bench (the forge). Five patrons stroll the hall with a
  word. `SceneManager` gained the `inn` theme: the crypt's stone walls,
  the town's painted floors. Lit end to end (`fullRadius` 30).
- The town's tavern2 is solid now; its door tile is the `inn` interactable
  (barred with a word while the looters hold the quarter). `goInn` /
  `leaveInn` fade in and out (`INN_FLOOR` 103, `modeFor`, `animsForFloor`,
  the zone name THE GILDED STAG). The errand's reward is paid at the bar
  (`applyEastStep('reward')` on the inn's floor); the town's keeper prop is
  gone once the quarter is cleared (she is behind her own bar).
- THE BED, eased: E from across the room walks the hero to the bedside
  first (`pendingRest` + `walkToInteractable`), the lying-down runs a
  second with an ease-out, pale motes rise while the hero sleeps, and the
  rising plays the fall back over half a second (`Player.wakeClock`).

### The forest's homecoming
- `ReclaimScene` became `ProcessionScene` (`src/town/Reclaim.ts`): carts
  optional, `at`/`from`/`route`/`titles`/`walkers` hooks. The forest runs
  it bare when the last beast falls: THE DARK FOREST · the road is open,
  then THE PEOPLE RETURN as seven of the folk walk in from the town road
  through the clearings; then the road home and the gatekeeper's thanks,
  as before. `forestReturnTicks` 0 holds the tick while the scene plays.

### Marks, streets, roofs, chests, the map
- OVERHEAD MARKS: `#foe-over` - a bobbing red chevron over every quest
  target in sight (looters, the forest's beasts), a pool of twenty-four;
  the edge chevrons stay for the ones off screen, and two in one direction
  share one.
- THE STREETS: `Villagers` path-find (`findPath`, a bounded breadth-first
  walk with corners cut) to targets that are street tiles three times in
  four (`VillagerOptions.roads/mapWidth`), over wander rooms that now span
  whole districts; no more standing in a corner because a table was in the
  way. `positions()` feeds the roof cutaway: a building or a trunk in
  front of any villager ghosts, as it does for the hero and the foes.
- THE EASTERN QUARTER: a fourth gateway, THE HILL ROAD, ends the
  north-east lane; the north-west lane ends at a well and a bench; no bare
  cliff cube by open ground (trees 80 %, brush the rest, boulders on the
  gate's flank); heaps shrink to their tile; the fallen and their pools are
  ground paint; interactable ids start at 10001 so a chest and a stall
  never share an id.
- LOOTABLE CHESTS: `layout.chests` - nine spots over the three districts
  and three in the forest's clearings, `ChestSystem.spawnAt(..., minor)`
  dropping `rollMinorItem` (a draught, a scrap, now and then a plain
  piece). Opened ones are remembered by the save (`quests.chests` as
  `floor:x,y;...`) and never come back. Clicks reach town chests
  (`pickChest` falls through), the E-prompt shows OPEN when the chest is
  nearer than the stall.

### QA
- qa75: the forest's homecoming driven over the fake clock; the inn walked
  into and out of; the reward at the bar; the bedside walk; the district
  chest opened and remembered. `driveRender` hoisted to module scope.

## 2026-09-07 (iteration 91) - The Eastern Quarter: the barricade, the looters, the reclaiming, the inn

### The map grew east (`src/town/TownMap.ts`)
- `TOWN_W` 60 -> 116. A third blob (centre 87,40; `radiusAt3`, dented
  toward the gate) carves the largest district of the three (~2 800 open
  tiles against the old quarter's ~2 000); the old quarter is clipped at
  x 58 where its border wall used to stand. `districts` gains THE EASTERN
  QUARTER (x >= `EAST_X` 60, first match). The east road leaves the portal
  yard, crosses the woods, and meets the barricade at `EAST_GATE_X` 61;
  past it the gate avenue, the burnt square (the fountain ring), three
  roads to three shut gateways (THE NORTH ROAD, THE RIVER GATE, THE SOUTH
  FIELDS) and the lanes of the ruined rows.
- `buildTownLayout({ east })` takes an `EastState` (`sealed` | `open` |
  `cleared`) and returns `layout.east: EastQuarter`: the gate tiles and
  the `gap`, the approach and the inside, the innkeeper's tile (at the
  gate, or behind the counter once cleared), the refugees' huddle and the
  square's wander room, twenty `banditPosts` rolled from the map's seed
  (no two within four strides, out of the inn), the inn's footprint, door,
  bed, chest and bench. Sealed and open builds place the carts (`gatebar`,
  the open build leaves the gap); the cleared build places banners, buries
  the fallen and puts the keeper in the inn.
- The self-heal flood and `auditTownLayout` seed from both sides of the
  barricade, so the sealed quarter is healed like the rest.
- New prop kinds: `ruin` (occluders, ashen), `heap`, `ruinwall`, the
  clutter `rubble` / `slab` / `debris` / `corpse` / `embers` (never a
  blocked tile), `tavern2`, `innkeeper`, `bed`, `gatebar`, `smithy`,
  `barracks`. `house_h` is the tall half-timber house (4x4, a door column
  two deep). A `corpse` is a looter's or militiaman's death frame lying over
  a pool - paint, never a body. No tree stands on the gate's east flank
  (`gateFlank`), where it would draw over the carts.
- Assets baked from `3rd town part` (`assets91.py`): the inn (the 30000
  corner render), twelve ruin shells, the ring, two columns, five heaps,
  eight wall stubs, seven rubble piles, eight slabs, four debris clusters,
  three pixel cottages, the tall house, the smithy, the barracks, the bed
  (the `bed01.jpg` render keyed off its grey ground). The mossy renders are
  warmed to burnt stone.

### The errand (`src/main.ts`)
- `quests.east`: `new` -> `open` (the errand taken) -> `cleared` (the last
  looter down) -> `done` (paid); `quests.looters` counts the dead for a
  rebuild. Steps that change the party's state travel as a `QUEST` command
  (`{ id: 'east', step: 'accept' | 'reward' }`) so every peer applies them
  on the same tick; the cleared step follows from the kill count, which is
  deterministic already.
- E at the barricade (the innkeeper's tiles are the carts' too): a refugee's
  word, then MARGO's - two hundred gold (200), a bow and a sword. Accept:
  the gap tile is floor, the cart slides to the verge (`GateFx.pullAside`),
  twenty looters spawn at their posts (`bandit` = the poacher's body in
  rags, ranged; `brigand` = the halberdier in stolen mail; level 5, two
  champions), the plate reads THE EAST GATE.
- The HUD tally reads LOOTERS REMAINING · X / 20 anywhere in town while
  the errand is open; the minimap marks every looter as a red pip before
  the fog lifts (`MapMarker.always`); `#foe-pointers` puts a chevron with
  the distance in strides on the screen's edge toward the nearest three
  off-screen targets - the forest's beasts too, while that errand runs.
- The last looter falls: `ReclaimScene` (`src/town/Reclaim.ts`) - a
  letterboxed, render-only cutscene: the camera crosses to the gate
  (`cineFocus` eased in the render loop), the carts tremble and topple in
  dust, the grid opens, THE PEOPLE RETURN, eight of the folk walk the road
  through the gap to the square under drifting gold light, the bars lift.
  Then a fade rebuilds the town cleared: carts gone for good, banners on the
  road, ten folk on the square, the keeper behind her counter.
- E at the counter: the reward - 200 gold, `hunters_bow` and `soldier_blade`
  at rare or better, to every hero of the party - and the corner room.
- THE GILDED STAG: a 6x5 footprint whose rim is wall and whose hall is
  floor, the door in the south face; the roof ghosts when the hero is
  inside (the cottage rule). The room's chest is the town stash, its bench
  the camp forge (`Interactable.room`, the keeper's until paid).
- THE BED: a `REST` command. `Player.lieDown` carries the body onto the
  bed's tile (`restFrom` remembers the floor), `syncKnight` plays the death
  sheet as the lying-down and holds its last frame; a bed mends a percent
  of life and resource every six ticks. Any order to move, strike or pick
  up `rise`s first. E on the bed toggles.

### Ambient chatter (`src/town/Villagers.ts`)
- Every peaceful head speaks a word now and then: a tiny bubble (Pixi
  Text at 9 px in a dark rounded plate with a tail) fades in over the head,
  holds 2.2 s and fades out, the next 6-18 s later. Banks: `TOWN_WORDS`
  for the folk, `VENDOR_WORDS`, `GUARD_WORDS`, `REFUGEE_WORDS` at the
  barricade, `RECLAIMED_WORDS` on the square. `VillagerOptions` also
  dresses the keeper (`keeperAnim: 'villager_walk'`, a warm tint).

### QA
- qa75 grew the Eastern Quarter block (36 checks): the map, the sealed
  gate, the posts, the dialogues, the open gap, twenty men and no beast,
  the tally and the pointers, the room refused, the reclaiming driven over
  a fake clock, the rebuilt town, the reward, the bed, the chest, the save,
  the words. The tab may be occluded: page timers there are frozen, so the
  harness is started with `window.setTimeout` pointed at the worker clock
  and the cutscene is driven by `driveRender` (performance.now stubbed).

## 2026-09-07 (iteration 90) - The training ground: dummies that take a blow, a sign, a tutorial that points

### The yard and its dummies
- The Market Ward's training yard (west of the Bowyer) had three dummy
  props. They are BODIES now: `ENEMY_TYPES.dummy` / `dummyB` (`passive`,
  `single: 'dummy_a' | 'dummy_b'`, hp 400, no blow of their own), spawned
  by the hub build on the prop tiles (the prop keeps the tile solid, draws
  nothing). `Enemy.updateDummy` roots the body on its home tile (no shove,
  no knockback), lets it flinch, and heals it 4 % a tick once 90 ticks have
  passed since the last blow. `applyRig` grew a single-texture path
  (`rigScale` from `singleHeight`), and the marker render keeps that scale.
  The damaged handler throws wood chips and a knock instead of blood; the
  bestiary hides passive kinds; `dealDamage` never culls a dummy and the
  tourist's 1-hit rule skips it.
- A sign (`trainpost`, the `signpost` single) at the yard's head is the
  `training` interactable: E opens a dialogue that offers THE TRAINING
  GROUND; BEGIN starts the tutorial. `layout.training = { post, mark }`.
- `tryBlock` pushed every placed prop TWICE (the second `block` after the
  route check): every tryBlock prop was drawn over itself and its plate and
  interactable doubled. The re-claim is a grid loop now; the town has 1601
  props instead of ~1900 and the sign's interactable is one.

### The tutorial (`src/tutorial/TutorialSystem.ts`)
- Data-driven: `tutorialSteps` (three chapters, sixteen beats), each a
  title, a line or two (a desktop and a touch reading), a target (a CSS
  selector or a world point), a moving demo (keycaps that press themselves,
  a stick, a tap ripple, a mouse, the hero's idle frames), `enter`/`exit`
  (a panel opens itself and closes when the step ends), and either a `done`
  condition met by doing (walk 4 tiles, land 3 blows, cast, quaff, interact)
  or a NEXT button. The engine is `TutorialSystem` with `TutorialHooks` as
  its whole view of the game.
- The overlay: `#tut-spot` (a rounded frame whose 9999 px box-shadow dims
  everything else, pulsing gold, gliding between targets), `#tut-arrow`
  (a bobbing chevron between the card and the target, rotated to point at
  it), `#tut-card` (step counter, title, text, demo, progress, BACK / NEXT
  or SKIP STEP, a cross; rises on every step; glows green when the deed is
  done and advances 0.9 s later), `#tut-chapter` (a 1.5 s title flash).
  The card seats itself below, above, beside, or - for a panel as big as
  the screen - low and centred, always inside the LAYOUT viewport
  (`screenLayout.state.w/h`, so the phone simulator is honoured).
- Feeds from main: `noteCommand` from the local hero's command stream
  (SKILL, USE_QUICK, PICKUP_NEAREST), `noteDamage` from `entity:damaged`
  (only the dummies count), `update(dt)` each render frame. `start()` warps
  the party to the yard's mark. Finishing sets `iso-arpg-tutorial-done`.
- `shouldAutoStart()` + `AUTO_ONBOARD` (false): the one switch a mandatory
  first-time onboarding needs - main already calls it after the town
  builds. `__game.tutor` for QA.
- Trap found: `Camera.worldToCanvas` answers in CSS pixels of the canvas
  box, not backing pixels - scaling by `canvas.width` put the first
  spotlight on a barrel.

### Verified (seed 42)
- `qa75` (warrior, deep): 269 pass, 0 fail, 0 errors, 125 s; `qa66` 74/74
  inside it; `npm run build` clean; no console errors. New checks: three
  rooted dummies that take a blow, flinch and heal, and shrug off the
  tourist's blade; the sign and its offer; the tutorial end to end (the
  yard placement, the hero on the welcome card, the card inside the screen,
  walking four tiles, three blows on a dummy with the spotlight and arrow
  up, the damage readout, a cast, a quaff, the pack / hero / talents /
  forge / journal opening and closing on cue, the plate, an interaction,
  the gate, the remembered finish).
- Seen by eye: desktop cards below, above and beside their targets; the
  phone landscape and portrait boxes (915x412, 412x915) with the cards
  inside the simulated viewport; the book step seating its card low.
- One harness run froze mid-quarry with the tab's automation group gone -
  Chrome discarded the tab; the same path ran clean by hand and on the
  rerun.

### Mobile pass (same day)
- Touch targets: the card's buttons and cross are 46 px on touch (44 was
  measured at 43 mid-entrance, the card rises from scale 0.98); micro
  screens (240x320, 320x240) drop the demo box and tighten the card.
- `qa75` gained THE TUTORIAL ON EVERY PHONE: eleven simulated boxes
  (915x412, 412x915, 932x430, 430x932, 640x360, 360x640, 240x320, 320x240,
  1024x768, 768x1024, 1280x800), all sixteen cards placed inside each box
  (the card's own left/top/size, not a mid-transition rect) with every
  button at least 44 px. The sweep is slow in a hidden tab (timers throttle
  to a second): start it detached and poll.
- The run's timers moved to a worker clock (`core/workerTimer.ts`,
  `unthrottledTimeout`): `later()` - the fade beats, the loading step, the
  20 s watchdog, boss sequences and banners - no longer waits on the page's
  `setTimeout`. A hidden tab throttles that to one a second, and after five
  minutes to one a MINUTE: an alt-tabbed delver came back to a stalled
  fade, and two harness runs tripped the watchdog in the quarry (the arena
  built, then nothing moved while `transitioning` waited on a throttled
  timer). Workers keep their clock.
- Verified after the pass: `qa75` 280 pass, 0 fail, 0 errors (39 s with
  the worker clock on a fresh tab, 127 s once the page's own `wait()` was
  throttled); the eleven-device tutorial sweep green; `qa66` 74/74; build
  clean; no console errors. The tree-fade check now renders over real
  milliseconds (a tight loop hands `frameDt` nothing).

## 2026-09-06 (iteration 89) - The dark's measure, the spawn ward, the new bundle in every zone

### The dark's measure (`src/core/Difficulty.ts`)
- Five settings in one table the simulation reads (`difficulty.current`),
  chosen on the class screen (THE DARK'S MEASURE row, remembered in
  `iso-arpg-difficulty`), kept by the save (`SaveGame.difficulty`, shown on
  CONTINUE and the slot panel), sent with a party's start, history and
  snapshot (a party runs the leader's; hardcore becomes hard there - one
  life is a solo vow). Exposed as `__game.difficulty`.
- The maths, applied in `Combat.dealDamage` before armor: a blow on a hero
  = rolled × heroTaken × foeDamage (the foe multiplier only when a foe
  struck; a hero's reflected steel is not a foe's blow). Foe life at spawn
  and per boss phase × foeHp (`Enemy.spawn`); sight = AGGRO_RADIUS × aggro;
  chase speed × foeSpeed; the recovery between swings ÷ foeRate (the
  telegraph keeps its length so a harder foe swings sooner, not faster).

  | Mode | Blows on you | Foe life | Sight · pace · cadence | Rule |
  | --- | --- | --- | --- | --- |
  | Tourist | 10 % × 50 % = 5 % | 100 % | 100 % | every hero blow ≥ ceil(hpMax ÷ N): common 1, champion 2, warden 4 (per phase) |
  | Easy | 100 % × 70 % = 70 % | 80 % | 90 · 100 · 90 | — |
  | Medium | 100 % | 100 % | 100 | — |
  | Hard | 125 % × 120 % = 150 % | 140 % | 135 · 110 · 115 | — |
  | Hardcore | 115 % × 115 % = 132 % | 125 % | 125 · 105 · 110 | one life |

- Tourist's rule (`hitsToKill`) skips pure damage (statuses) and reflected
  blows; wardens are `Enemy.isWarden` (the four wardens, the Hollow King's
  forms, the hydra); champions are the affixed. The minimum-1 rule keeps
  every landed blow at least a scratch, so "almost zero" is 1-2 points.
- HARDCORE: when the death animation ends the slot is wiped BEFORE the sheet
  shows (`saves.remove(slot)`, `hardcoreOver` gates `saveNow` and the
  pagehide save), the sheet says THE END with no rising and no other class,
  `RunHandle.stash()` returns nothing so a restart starts clean, and the
  Hope-is-Lost lament plays.

### The spawn ward
- `Player.wardTicks` (sim state, counted down in `beginTick`) is set to
  `SPAWN_WARD_TICKS` (300 = five seconds) by `respawnPlayer` and the co-op
  `reviveSeat`. `dealDamage` returns before anything while it stands and
  emits `entity:warded` (a WARDED note at most every 20 ticks). The halo
  turns pale blue and breathes fast, the buff bar carries a ✧ Spawn Ward
  with its clock, `WARDED · 5 s` rises with the delver, a shimmer sounds.

### The new bundle
- `public/assets/audio` grew: the Wizards II album (27 zips, unpacked to
  `Wizards 2/tracks/*.mp3` by a script), three dungeon suites
  (`dungeon_forest/tomb/castle.mp3`), `Secret Underground Cave.mp3`, the
  `SPX_samples` (Metal_Clank, Barrel_Break, Barrel_Roll,
  Footsteps_Departing, Success), `Ambience_Inside_the_Dungeon_01`, and
  `Hope is Lost.wav` (24-bit 48 kHz stereo, 28 MB - downmixed by numpy to
  `hope-is-lost-22k.wav`, 16-bit 22 kHz mono, 4.3 MB; the source and the
  98 MB ambience WAV are not shipped, the MP3 twins are).
- MUSIC: `MusicState` gained `forest`, `mines`, `death`, `gameover`; four
  playlists (`PLAYLISTS`): town (the title theme + four calm album tracks +
  the two rites), dungeon (mystery, tomb, doom, dark rites, drone, enigma,
  beast, castle, grimoire, mysteries), forest (the forest suite, the grove,
  the unknown paths, the witching hour), mines (the cave, the omen, the lab,
  the arcane lights). The quarry arena drums to Wizards' Warfront
  (`BOSS_TRACKS[102]`). The death sheet plays The Tragic Spell; the
  one-life end plays Hope is Lost; rising restores the bed that played.
- AMBIENCE: one bed element retargeted per zone - the dungeon recording
  under the crypt (0.55), the cave under the quarry (0.5), silence under the
  forest, a murmur under the death sheet. Stingers now also speak in the
  quarry (barrels roll, iron clanks, wood gives - on the ambient bus, one at
  a time inside the quiet window) and the forest.
- SFX: `keyTaken` (iron then the gem), `questDone` (the fanfare),
  `gateIron` (iron then the gate's groan), `depart` (footsteps down the
  road, when the forest falls quiet), `barrelBreak` (the hoard bursts),
  `dialogueOpen/Close` (the book), `ward` (the shimmer).
- NO OVERLAPS: `claimVoice` caps every bank at 4 live takes and the mix at
  24 (`playVariant`, `playBuffer`, `playSlice`); a full bank drops the take
  instead of stacking it - and returns true so no synth fallback stacks
  either. The 60 ms per-name throttle, the single stinger window and the
  one-bed crossfade stand as before.

### Verified (seed 42)
- `qa75` (warrior, deep): 244 pass, 0 fail, 0 errors, 99 s; `qa66` 74/74
  inside it; `npm run build` clean; no console errors. New checks: tourist
  5 % blows and 1 / 2 hits, hard 150 % blows and 140 % life, easy 80 %
  life, the five-second ward (300 ticks, a blow breaks on it, the buff, the
  fade), the sheet naming the measure, the journal's table, and - last of
  all - hardcore: THE END, no rising, the slot wiped, nothing writes it
  again, the lament, the run ending at the menu. All 29 new audio paths
  answer HEAD with an audio type.
- The class screen with its new row overflowed a 639 px viewport: the fit
  scaled about the centre and cut the buttons. `#class-select.show` is
  `justify-content: safe center` and `.cs-fit` scales from its top now (the
  rule must sit after the 8a block that pins the origin). `fit.schedule()`
  runs again once the row is in the DOM.
- Not shipped: `Hope is Lost.wav` (28 MB source), the 98 MB ambience WAV,
  the SPX WAV twins, the Unreal sample project, the album zips and the
  MIDI files (ignored); the MP3s and the 22 kHz downmix are.

## 2026-09-06 (iteration 88) - The key held high, ghost trees, the quarry arena, clutter out of the way, the keeper's face, the tally

### A key is taken
- A quest item is not a coin. `Ambience.playRise` (render-only) lifts the
  key's icon out of the hero's hands, turning on its axis inside a gold
  halo, and fades it above the head; sparks, a glint, a four-tick hold, a
  camera kick, the bell and the chime, `QUARRY KEY I · TAKEN` over the head
  and the banner `QUEST ITEM · QUARRY KEY I` at the top (`#reward-note`).
  Wired in `item:pickupArrived` for any item with `use.key`.

### A tree is a ghost
- The forest's fade left a trunk at 0.38, and a wolf behind it was a
  rumour. `Occluder.tree` marks pines, oaks, dead trees and the big trees;
  a tree with any visible body behind it settles at 0.12 now (cottages keep
  0.38, the inside-a-door ghost keeps 0.2).

### The quarry arena
- The hydra used to stand in the mines' deepest hall. The hall carries a
  SEAL now, like the wardens' floors (`sealRoom` = `minesPlan.bossRoom`);
  a step onto it seals the party into THE QUARRY ARENA - `buildWorld(102,
  'arena')`: the arena map in the quarry's stone, the hydra (vampiric, at
  the quarry's level + 3) with a pit guard from `MINES_POOL` at the
  quarry's level, the loot at the quarry's item level (a plain arena at
  floor 102 would have rolled level-203 drops). When the last combatant
  falls the teleporter rises at the heart: `THE QUARRY IS QUIET · THE WAY
  HOME OPENS`, and a step onto it goes home (the arena knows it is the
  quarry's by `floor === MINES_FLOOR`; without that it would have offered
  the crown, since 102 >= MAX_DEPTH).
- The clear is remembered in `floors[1102]` (memKey of 102 + arena); the
  hall then builds without a seal, `arenaCleared` true from the first tick,
  the teleporter home standing where the seal was. `tickMines` lost its
  keeper-fell block. The quarry keeps its untouchable stair at (1,1): the
  seal is the threshold, never the stair (a stair at the seal would have
  run the endgame - the stair-contact handler ends the run at
  `floor >= MAX_DEPTH`).
- `devTravel(102, true)` and `animsForFloor(102, 'arena')` know the
  quarry's arena.

### Clutter out of the way
- `CLUTTER_KINDS` (TownMap): grass clumps, jars, pots, boxes, bins, potion
  decals, wall signs, the small wooden crates and the wood piles are drawn
  on their tile and the tile stays open - in the town (`block`, `tryBlock`),
  the forest (`block`) and the quarry (`tryProp`). Rocks, barrels, benches,
  carts and crates keep their tiles: they are waist-high or taller.

### The keeper's face and plainer words
- `DialogueSpec.portrait`: a canvas beside the lines. The keeper's is his
  own idle frame extracted through Pixi, cropped to the head by its alpha
  bounds (`portraitFromTexture`), 96 px, cached.
- The lines are shorter and plainer, and the pay is on the page: "The
  guild pays a hundred gold (100) when it's done." When the purse is
  handed over the banner reads `REWARD RECEIVED · 100 GOLD`.

### Enemies remaining
- `World.foesAtStart` counts what a floor woke with; in the forest the
  corner column carries `ENEMIES REMAINING · X / Y` (`#quest-hud`, under
  the plate, scaling with `--tl-scale`), refreshed each frame and hidden
  everywhere else. `qa66` measures it (`HUD_IDS`).

### Verified (seed 42)
- `qa75` (warrior, deep): 221 pass, 0 fail, 0 errors, 78 s; `qa66`: 74/74;
  `npm run build` clean. New checks: the taken key's rise and banner, the
  seal opening the quarry arena at the quarry's level, the keeper's fall
  raising the way home, the remembered clear (no seal, the teleporter
  standing), clutter open in town / forest / quarry, a pine at 0.12 with a
  wolf behind it, the tally on the HUD, the face and the (100) on the page,
  the reward note.
- Harness traps: the tile south of a quarry key is a wall as often as not -
  stand ON the key before a PICKUP_NEAREST; grass clumps are decals that a
  thicket or a belt may cover, so a clutter check names the placed kinds;
  after a quarry clear `floors[1102]` holds it, so the it.87 key checks
  take the first key still on the floor. The boss banner names the quarry's
  keeper (`THE KEEPER FALLS`).

## 2026-09-06 (iteration 87) - The forest errand, the spoken word, the new teleporter, the key's beacon, the seal

### The gatekeeper and the forest errand
- `ui/Dialogue.ts`: one panel for anyone with something to say - a name, a
  role, lines, up to three choices, a promise for the answer; 1/2/3 and
  Escape on a keyboard, thumb-sized buttons on a phone, contain-fit.
- THE GATEKEEPER (a sentry in the guard's mail, `Villagers.keeperAt`) stands
  beside the eastern gateway. E at the road opens his word: the road is
  shut until the hero takes the errand (`quests.forest`: new → active →
  done, saved in `SaveGame.quests`). Taking it walks the party east. In the
  forest, the sim counts living beasts every tick (`tickForestQuest`); when
  the last falls a line rises, and 110 ticks later the party is home beside
  the keeper, every hero a hundred gold richer, the thanks on the table.
- A cleared forest builds safe (`buildForestLayout(seed, true)`): no packs,
  six folk in the second clearing, two sentries in the gate yard.
- The keeper's first post (51,70) put him BEHIND the pine at 53,71 - the
  town's occluders fade for bodies that move, not for a sentry who stands.
  He stands in the gate yard now (50,74), in the open south-west of the
  light; the road's prompt reads E · THE GATEKEEPER · THE EASTERN ROAD and
  his own tile counts as the gate's, so E beside him is E at the road. The
  party comes home to the road tile a stride from him. The dialogue head's
  role line keeps clear of the close cross (it ran under it).

### The bar on a 932x430 phone
- The device matrix had one red row since it.86: on a touch landscape 420
  to 480 px tall the two-column bar (it.86) ran into the thumb cluster's top
  face (the journal at y 241-285, the fourth skill from 264). Under 480 px
  the manager folds the bar to four across, two down (`barForm` grid4), and
  the it.86 two-column rule applies only to the row form (`.bar-row`). 74
  configs green.

### The new teleporter
- `assets/test-models/teleport` is a 3D teleporter (a blend and its maps).
  Its stone disc (diffuse × ambient occlusion, cut to the outer ring) and
  its rune ring bake to `portal_pad` and `portal_rune`, squashed 2:1 for
  the floor. The rune bake must keep the model's alpha PREMULTIPLIED: the
  first cut saved it opaque, and under additive blending the whole disc
  read as a solid blue fill instead of glowing glyph lines. Every teleporter draws them now: the arenas' victory pad, the
  coliseum's exit, the quarry's way home (`spawnTeleporterAt`) and the
  return rift at the town's portal stone.

### The key and the gates
- A quarry key on the floor is a quarter of its icon (not two fifths) and
  lies low; a BEACON in the top layer - a soft light column and the key's
  own additive silhouette - shows it through any wall in front, breathing,
  and only where the fog has lifted (`LootSystem.updateBeacons`).
- Every gate knows its corridor's way (`MineDoor.axis`); the gate sprite is
  a wall piece running along x (its door faces south-west), so a corridor
  running along x gets it mirrored (`TownProp.flip`) and one along y takes
  it as is - the bars stand across the passage instead of along it. The
  first cut had the condition backwards; verified on both gate kinds in the
  browser (seed 42: the x-corridor gate at 77,30 and the y-corridor pair at
  98,50).

### The seal, not the room
- On the wardens' floors the whole chamber seized the hero at its door.
  Now the seal at the room's heart is the way in (within a stride of it);
  the room says so once at the door.

### Every body behind a tree
- The cutaway fades a tree in front of ANY visible body now - the local
  hero, the party, every foe in sight - not only the camera's hero.

### Verified in the browser (seed 42)
- The gatekeeper's word at the road, the errand taken, the forest, every
  beast down, the way home, the thanks and the hundred gold, the safe
  forest with folk and sentries; the dialogue inside a 915x412 and a
  412x915 simulated phone with 44 px cross and 57 px choices.
- A quarry key by its south wall at a quarter scale with its beacon lit
  once the fog lifts; the x-corridor gate at 77,30; the new teleporter's
  disc and rune ring at the quarry keeper's hall.
- A wolf parked behind a pine at 37,10: the pine settles at alpha 0.38.
- Depth V: ninety ticks inside the warden's chamber at its west edge stay
  on the floor; a step onto the seal enters the arena.
- `qa75` (seed 42, warrior, deep): 210 pass, 0 fail, 0 errors, 67 s with the
  tab kept visible; `qa66`: 74/74; `npm run build` clean.
- Chrome trap: a tab whose viewport had shrunk to 216x158 (DevTools) makes
  every zoom capture time out and the matrix report boss-bar overflows -
  open a fresh tab, and run the matrix in town, never in an arena with the
  boss bar up.

## 2026-09-06 (iteration 86) - The shortcut bar stands upright on every screen

- The bar was a column only on a desktop without touch (it.80); a touch
  laptop, a tablet and a wide phone got a horizontal row of eight under the
  chart. Now the right edge carries an upright stack everywhere the height
  allows: one column of eight on any layout without touch, on a touch
  landscape 800 px or taller (`tall-screen`, a new layout class), and on
  standard and tablet portrait phones; two columns of four on a touch
  landscape under 800 px (the thumb cluster owns the bottom-right corner,
  and the matrix caught eight in a column reaching into it on 720-748 px
  screens); the 2x4 grid stays on compact and micro portrait handsets and
  on a landscape phone with its browser bars showing, where eight 44 px
  targets do not fit the edge.

## 2026-09-06 (iteration 85) - The dark forest, the quarry mines, the iron gates, the CRT, the roads kept open

### The opening zoom and the tube
- The camera starts at 1.5 (`DEFAULT_ZOOM`, Camera.ts): half again closer.
  The wheel still ranges ZOOM_MIN..ZOOM_MAX.
- `render/CrtFilter.ts`: a Pixi v8 GLSL filter - scanlines on the output's
  pixel rows, a mild barrel curve with a dark bezel, colour fringing toward
  the edges, a soft phosphor glow, a vignette and a slow flicker - toggled
  in SETTINGS · VISUALS (`visuals.crt`, off by default), applied beside the
  colour grade on the stage. The DOM HUD stays crisp. LESSON: the fragment
  must declare `precision highp float;` - Pixi gives fragments mediump and
  the default filter vertex declares `uInputSize` highp, and a uniform at
  two precisions fails to LINK ("Could not initialize shader").

### The roads kept open
- `street()` marks road tiles; `offRoad()` finds the verge beside a street
  tile; every torch and lamp goes through `placeLamp` (verge or nothing);
  `tryBlock` refuses road tiles; the forest belt and the lawn fill never
  take a road tile (the park ellipse had repainted part of the east road
  as grass, and trees grew in it); and a final pass moves lights, columns
  and banners off streets and removes stores, benches, carts, trees and
  rocks that landed in one. The harness lists any clutter on a road tile.

### The dark forest (floor 101, mode `forest`)
- `scenes/Forest.ts`: a 56×40 outdoor map in the town's idiom (grass and
  dirt paint, cliff cubes, trees as solid props), one winding road from
  the road-to-town signpost on the west edge to the quarry mouth on the
  east, four clearings (the spawner's "rooms") with felled camps, torches
  on the verges, the woods everywhere else, and a flood fill that turns
  every tile the road cannot reach into forest. Dressed by
  `placeTownProps` through `bareLayout()` (a TownLayout with every town
  landmark parked off the map). Wolves, poachers, spiders and orcs at the
  hero's depth (deepest + 1). Sight 16, full light 4.
- THE EASTERN ROAD in the ward is an open gateway now (`dest: 'forest'`):
  E walks the party east. In the forest, E at the signpost warps home; E
  at the quarry mouth goes down.

### The quarry mines (floor 102, mode `mines`)
- One floor, 104×88 - about 4.7 crypts of floor - from the crypt generator
  with pillars, a stone theme, the pit's dressing (supports, kegs, crates,
  rocks, jars, torches) placed only where it seals nothing, hearths, chests
  and gold as any depth, fog of war as any depth. No stair: the hidden one
  sits on a wall tile (the arrival tile touched the stair and raised the
  endgame - fixed).
- `scenes/Mines.ts` - THE LOCKED GATES: the way from the entrance to the
  deepest hall is walked once (BFS); along it, corridor cross-sections
  (one to three tiles across the way) whose removal cuts the hall off
  become iron gates - TILE_DOOR (solid, opaque, `gate_closed`), up to
  three spread along the way. THE KEYS: each gate's key lies in a side
  room reachable without passing that gate (the near component with the
  gate shut), scored away from the way - a corner of a dead-end room -
  as a ground item (`quarry_key_1..3`, new icons). A living hero within
  1.6 tiles of a shut gate carrying its key opens every bar of it (pure
  sim: `tickMines`); without the key the gate says so over its bars.
- THE KEEPER: a vampiric Crimson Hydra at the hero's depth + 3 in the
  deepest hall, on the boss bar. When it falls the teleporter rises where
  it stood and takes the party home (the arena's victory-portal logic,
  branched for the mines).
- THE MARKS on the minimap (`MinimapUI.setMarkers`): a key, a gate (red
  shut, green open), the keeper and the way home - each drawn ONLY once
  its tile has been explored (`lighting.getState > 0`), never before.
- Memory (`FloorMemory.doorsOpened / keysTaken`): gates stand open and
  taken keys stay gone across a reload; the keeper's fall is
  `arenaCleared`, and the teleporter stands from the first tick after.
- `modeFor(floor)` decides hub / coliseum / forest / mines / normal on
  load, on the portal back and on travel; the level select, the deepest
  depth and the records ignore floors past twenty.

## 2026-09-06 (iteration 84) - The Market Ward, plates on approach, the zone chip

### Plates on approach
- A foe's name, level and life bar showed only after the first blow. They
  now show whenever a hero is within seven tiles (`PLATE_RANGE` in
  Enemy.ts), stay while the foe is wounded, and hide again when the hero
  walks away. The plate reads "Risen Blade · Lv 2" above the bar; a
  champion keeps its title above and the level alone on the plate.

### The Market Ward
- The town is two districts on one 60×98 map: the old quarter (y < 52)
  and the Market Ward below the ward gate, each a noise-carved clearing
  with its own forest belt, joined by the south road through the woods.
  The gate is two banner columns and two sentries on a cobbled apron.
- The ward: a market plaza around the seated king (the statue from the
  new pack), benches, a cart, the JEWELER (rings and amulets), the SCRIBE
  (recipe scrolls and a scholar's brews) and the BOWYER (bows, wands,
  staves, polearms) - three counters the old quarter does not have, each
  a `Vendor` with its own restock table in `Town.ts` (`tableFor`). The
  GUILDHALL (the timber-frame house from the pack, shadow cut away, 4×4
  solid) with THE BOUNTY BOARD before it - a functional placeholder
  (`ui/NoticeBoard.ts`): opens on E, four postings that say plainly the
  ledger is not open yet, closes on its cross, E and Escape, fits every
  screen. A training yard (barricades, dummies, a rack), a park (the hjm
  trees, benches), three cottages, standing braziers as street light,
  waving banners, jars, boxes, barrels. Two GATEWAYS to zones not built
  yet (the marsh path south, the eastern road east): pillars, the
  teleporter light, a plate, and a note on E ("not open yet") through a
  new repeatable `tutorial.say`.
- The old quarter dressed deeper: benches at the well, a cart on the
  square, lamps on the high street, a monument at the lower plaza, big
  trees in the lawns, stores by the stalls - every one placed by
  `tryBlock`, which refuses a prop that would seal a route or land on
  paint. Nine folk wander the square, eight the ward.
- Collision: every standing thing claims its footprint before the scene
  builds (`block`), the gateways' tiles are blocked, the audit checks the
  new vendors, the board, the gateways and the plaza, and the harness
  walks a 4-connected path from the spawn to the plaza.
- The assets came from `public/assets/test-models/new town part`
  (untracked): `Normal/sprite0.png` (the hall), `isometric-parts` (the
  statues, barricades, dummies, jars, boxes, tables), `v3` benches,
  `hjm-cart_parked` (one view cut from the turntable), `hjm-more_trees`,
  `Barrel pro`, `hjm-potion_bottles`, `ISO/Standing/Loop` (the brazier,
  16 frames), the castle sprites (the banner, 10 frames) and
  `teleporter_effect` (25 of 100 frames). `assets84.py` bakes them into
  atlas singles and one-row anims with painted boxes.

### The zone chip
- `#zone-label` under the chart in the top-right stack: the district
  ("THE OLD QUARTER" / "THE MARKET WARD") from `layout.districts` by the
  hero's tile, "DEPTH III · THE CRYPT" below, "THE COLISEUM" in the
  arena. Sized by tier, ellipsis past the chart's width, scaled with the
  HUD on a phone, in the matrix's HUD list.

### Lessons
- The hub's fog of war reveals on `player:tileChanged` (36-tile sight):
  a teleported hero sees nothing until `lighting.updateVisibility` runs.
  The harness and the screenshots call it.
- The hub preloads a fixed anim list (`main.ts`, `animsFor('hub')`): a
  new town anim must be added there or `hasAnim` is false and the prop
  is silently skipped.

## 2026-09-06 (iteration 83) - The journal everywhere, the command sheet's corner, the catalogue, the craft ledger, the glass

### The journal on every road
- H in the command sheet's list; a JOURNAL button on the pause sheet
  (Escape, or the pause button on a phone) beside SETTINGS - the phone's H,
  next to the book on the bar and the JOURNAL buttons in the inventory,
  forge and shop.

### The command sheet
- It lived bottom-right, under the desktop's system-bar column and the
  town-portal button: expanded, it covered the skull and the fullscreen
  button and clipped the portal. It moves to the bottom-left (the one
  corner a desktop leaves empty), never grows past the screen (it scrolls
  inside `--app-h`), and the co-op chat steps above it while it is open.

### The journal, audited and deepened
- Three claims were wrong against the code and are fixed: a strike lands
  80% of the time (the book said 85), Strength gives 3 life a point (it
  said 2, the it.82 balance), and only armor lines scale with the level's
  power (regrowth is a share of life). Every chapter is generated from the
  engine's own tables; CRAFTING now carries a worked example that calls
  the forge's own cost functions (`reinforceCost`, `goldOnlyCost`,
  `rerollCost`, `enchantCost`, `forgeCost`, `salvageYield`) on a rare
  level-12 blade, and the harness reads the price out of the page and
  compares it with the function.
- ARSENAL is THE CATALOGUE: every base the crypt drops or the forge makes
  - 37 shapes in three tiers with each tier's own line, the three staves,
  the 22 uniques with both innates, every plate and jewel by slot with its
  band, armor and built-in bonus - with a find box (name, family, effect)
  and a badge on what the forge knows at the deepest depth reached. The
  old chapter listed shapes only, with a family pace that ignored the
  combat pace and the recovery trim; the pace shown now is the profile's.
- STATUSES carries the wound table (share, span, bites) and each mark's
  time from `DOT_TABLE` / `MARK_TICKS` (exported now). RECIPES, CRAFTING,
  BELT and TRADE carry numbered how-to steps; TRADE covers the stash (24
  pieces, gold); COMBAT covers dodge, stagger thresholds, knockback, XP;
  chapters link to each other.

### The craft ledger (tests)
- A new qa75 block spends to the coin: salvage against `salvageYield`,
  transmute ×2, forge (its price and the deepest level, uncommon or
  better), refine (essence + 20%, the other lines untouched), reinforce +1
  in materials and +2 in gold alone (`goldOnlyCost`), enchant (the
  recipe's essence and dust + 30%), sell at a quarter, buyback at the
  same, buy at the full worth, the restock after a warden, the stash's
  gold both ways, and the catalogue's count and search.

### The glass (iPhone 13 Pro, Safari and Telegram's browser)
- `src/core/touchGuards.ts`: mobile Safari ignores `user-scalable=no` and
  zooms the page on any two-finger gesture (a thumb on the stick and a
  thumb on STRIKE is a pinch), and the page stays zoomed with every HUD
  corner off the glass. Safari's `gesturestart/change/end` are cancelled,
  every multi-touch `touchmove` is cancelled, a one-finger move is allowed
  only when something between the finger and the body can scroll that
  way (no rubber-banding), the context menu and the double-tap zoom are
  refused on a touch layout.
- CSS: `-webkit-text-size-adjust: 100%` (Safari boosts text in
  landscape), `-webkit-touch-callout: none` on images and buttons (the
  long-press inspect gesture opened iOS's Save Image sheet), no drag
  ghosts, 16 px inputs on touch (Safari zooms into smaller ones), the
  body pinned (`position: fixed`) on a touch layout, `100dvh` as the
  fallback for `--app-h` before the layout writes it, and every `100vh`
  in a window's max-height replaced by `var(--app-h)` (on iOS 100vh is the
  toolbar-hidden height, so a window sized by it ran under the toolbar).
- Head: `apple-mobile-web-app-capable`, black-translucent status bar,
  `interactive-widget=resizes-content`, `theme-color`, no phone-number
  detection.
- The system bar's row width says eight entries (the journal joined in
  it.82; the plate's room was computed for seven).

## 2026-09-05 (iteration 82) - The inventory restyled, the cross that died, the journal, status icons, the balance pass

### The cross
- The inventory wired its close cross only when toggled; every repaint
  while the window was open (a pickup, a belt change, a material) replaced
  the heading and left a dead button. The cross is rewired on every paint
  now, and the harness clicks the cross of every window after a repaint.

### The inventory
- One restyle for every screen (`8a6` in index.html): an obsidian plate
  with a gold rule, the hero on a lit dais with a ground shadow, obsidian
  tiles with rarity edges and a hover lift, the pack a framed field, the
  belt and the pouch on their own strip, a JOURNAL button in the heading.
  Cell size is one variable (`--inv-cell`) stepped by tier: 56 px on a
  desk or tablet, a clamp on a portrait phone, 40 px on a landscape phone.
- Landscape: the pack column is one wrapper (`.inv-pack-col`: heading,
  filter bar, field) with `contain: size`, so it takes the height the
  doll's column gives and scrolls the field inside it; the column is never
  narrower than six cells plus its scrollbar (the sheet is shrink-to-fit
  from its centre and used to settle on the 200 px minimum and overflow
  sideways). A landscape phone keeps a 300 px doll column, draws the hero
  at thumb size, drops the slot names and the belt note, and the pack
  heading keeps clear of the close medallion. A short desk (the sheet sits
  under the minimap) gets a 110 px dais instead of 150.

### The journal
- The codex is THE JOURNAL now: items · effects · recipes · crafting, on
  H, the book on the bar (labelled Journal), a JOURNAL button in the
  inventory, the forge and the shop, and a first-time hint on the first
  pickup. RECIPES (every enchantment), CRAFTING (every rule) and a CRAFT
  LOG (every forge result this run, newest first, on the run clock).

### Status icons
- Every status and trait has an icon from the pack. The card leads each
  effect line with the icon and a plain sentence ("Applies Chill to
  enemies (30% of hits).") before the numbers and the mechanics. Above a
  foe's head the same icons sit on dark plates while the status runs,
  rebuilt only when the set changes.

### Balance
- Bulwark lines were three plates: a T5 bulwark at iLvl 60 gave 1,490
  armor against a 536-armor plate. Flat armor lines are now 0.6–3 × power
  (a third to a half of a body piece). Regrowth is a share of max life a
  second (0.3–1.8%), not a flat number × power (4 × 93 = 372 life a second
  at iLvl 60). Strength's life is flat (3 a point), never × power (22 × 2
  × 93 = 4,092 life from one band). The rest of the tables held.

## 2026-09-05 (iteration 81) - The codex, the borders, the filters, the marks on the foe, the labelled gauges

### The codex (`ui/Codex.ts`)
- A book on the system bar (and H) with ten chapters generated from the
  same tables the engine reads: ITEMS (instances, item level, the 1.08
  curve, the rarity table, every affix with its five tiers, the
  attribute conversions, uniques, materials), ARSENAL (every family's
  timing, every tier's band, every shape with its role and its three
  innates), STATUSES (full mechanics and how each shows on a foe), TRAITS,
  ENCHANTS (every recipe: effect, words, where found, cost; LEARNED
  marked), FORGE (salvage by rarity, transmutation, forging, refining, the
  reinforcement table with what each level needs and what a failure
  does), BELT (every draught with its cooldown), TRADE (the economy),
  COMBAT (to-hit, damage, the armor formula, the curves, the wardens'
  rules) and LEGEND (the borders and the filters).
- Every effect, enchantment, draught, material and weapon shape carries
  its own words (`desc`) - the card shows the mechanics under each effect
  line and the item's description under its numbers.

### Borders and filters
- Special pieces wear a second edge everywhere they are drawn: ember for
  a status proc, sea-green for a trait, rose for an enchantment, gold for
  a legendary unique - and a corner gem in the inventory.
- `ui/itemFilter.ts`: seven filter chips (ALL, ARMS, ARMOR, JEWELS,
  DRAUGHTS, SCROLLS, SPECIAL) and six orders (as found, level, rarity,
  type, name, value) on the inventory pack, both merchant columns, both
  stash columns and every forge list, remembered per panel. Rows keep
  their original index so every command still names the right item. TIDY
  (`SORT_PACK`, a command) reorders the pack itself deterministically.

### The marks on the foe
- A status now shows three ways: its name floats up on the first
  application, a strip plays (blood, a tinted burst, a frost splash, a
  ring for the arc, a whirl for the stun), and a row of coloured gems
  sits above the foe's head while it runs, with the body tinted 40%
  toward the status's colour under the lighting.

### One icon family
- Every classic relic, draught and ring moved to the Raven pack, so the
  inventory is one style throughout; 250 icons referenced, 36 more copied.

### The gauges
- HP, MANA / STAMINA and XP are labelled on the plate, with a glyph each.

### Verified
- Labels "HP", "MANA", "XP"; the codex button; the inventory's borders
  (ench, proc, trait, unique) and gems; the chips and the level order;
  every icon a Raven single. Codex chapters render and fit. Statuses show
  their marks on depth III. Device matrix and the scripted playthrough
  below.

## 2026-09-05 (iteration 80) - The arsenal: weapons that do things, the belt, the recipe book

### Weapon identity (`items/registry.ts`, `items/effects.ts`)
- Sixty percent of the arsenal had been the same weapon behind another
  icon. Now every SHAPE has a role - damage, swing speed, crit, reach - and
  every TIER of a shape (steel 1-38, gilded 25-70, crystal 55-100) carries
  a different innate: a status PROC on hit or a granted TRAIT. Thirty-seven
  shapes (the rapier, the kris, the twinblade, the hatchet, the greataxe,
  the warpick, the glaive, the sickle, the recurve, the orb rod joined),
  three tiers, three staves and twenty-two uniques with two innates each.
- Statuses (`systems/Status.ts`): bleed (60% of the hit over 4 s), poison
  (80% over 6 s), burn (50% over 3 s), chill (55% speed for 3 s), shock
  (45% of the hit arcs to the nearest other foe in 3 tiles), stun (0.8 s).
  Wardens shrug off stuns and chills. Damage over time is a PURE wound
  through `dealDamage` (no armor, no echo, no cull), credited to the hero,
  so kills, reaping and the bestiary follow. The class synergies and
  Poison Blade route through the same engine.
- Traits: reaping (4% life a kill), siphon (3 resource a hit), cleave (a
  second foe in reach for half), impact (+80% knockback), swiftness (+8%
  speed), guardian (+12% armor), fortune (+25% gold), seeker (drop luck
  x1.25), berserk (+18% under 40% life), precision (crits 2.4x). Read by
  the player getters and the combat system; the seeker's luck rides the
  floor's loot each tick.
- The hero's hand: +2% weapon damage a level (a level-30 arm swings 58%
  harder), on top of the item level curve. The card and the shop show
  every weapon's level; the cell wears it in the corner with its +N.

### Enchantments
- Twelve recipes (`items/effects.ts`): flame, venom, frost, storm,
  sanguine, crushing, reaping, siphon, cleaving, swiftness, keen, gilded.
  A recipe SCROLL drops from depth II on (one gear drop in twenty-five,
  gated by depth) and the alchemist sells one now and then; reading it
  learns the recipe (saved). The forge's ENCHANT tab lays a learned recipe
  on any weapon for its essence, dust and 30% of the weapon's worth; the
  id carries `E<key>`, the name takes the adjective ("Flaming ..."), the
  card lists the line. A new enchantment replaces the old.
- REINFORCE gained PAY IN GOLD: the materials' worth at 2.5x, on top of
  the gold - resources at camp, or gold at the forge.
- The RECIPES tab is the forge's book: the reinforcement odds by level,
  every transmutation, salvage by rarity, the blueprint count, and every
  enchantment with its effect, cost and where to find it.

### The belt
- Q and R hold whichever draught the hero chooses (the inventory's belt
  has a picker beside each key listing every draught in the pack;
  `SET_BELT` is a command). The hotbar shows Q and R with the count and
  the cooldown; the thumb cluster's two draught buttons wear the same
  faces. Healing draughts share a five-second cooldown, resource draughts
  two, brews one; a refused quaff says why over the hero.
- New draughts: Rejuvenation, Greater Healing, Greater Mana, Haste (8 s),
  Stone (8 s of 40% reduction), Might (10 s of +25%). A quaff has a sound;
  a brew has its own cue and a floating name.

### The camp and the desktop
- The forge prop is the town's own WEAPON RACK beside the fire (no
  generated art); the Raven anvil is gone.
- On a desktop the system bar is a column hugging the right edge under
  the chart; the inventory rises to meet the chart; the portal rite steps
  right of the six-slot bar.

### Verified
- Town: the rack; the desktop column (seven buttons at x 1480-1528 under
  a chart ending at 1528); the belt picker listing four draughts; a
  rejuvenation on Q healing 60 -> 113, the cooldown refusing the second
  quaff and allowing it after 300 ticks; level badges "4", "60+2", "8".
  A recipe read, Flaming Edge laid on a saber (name and line), a gold-only
  reinforcement spending gold and no scraps. Depth III: bleed 122 -> 116
  over 70 ticks, chill 180 ticks at 55%, shock arcing 18 of a 40 hit,
  stun 48 ticks, poison 90 -> 81; a 50% poison unique procs on the strike
  path. The phone box shows the draught faces. Save v4 carries the belt
  and the recipes. Device matrix 74/74.

## 2026-09-05 (iteration 79) - Sheets that keep their heading, scroll that stays put, settings above the title

### The bugs
- SETTINGS from the title could not be closed: the sheet opened at z 40
  (the it.71 windows rule) under the title menu at z 85, so every click on
  its CLOSE landed on the menu behind it - the first test click started a
  run by hitting CONTINUE. `#settings-panel.open` now sits at z 96.
- On a phone, a sheet taller than the screen scrolls as a whole, and its
  heading - with the close cross - scrolled away. Every sheet's heading is
  `position: sticky` now (inventory, skill tree, character, bestiary,
  depths, settings, the three town panels, the ledger, the Forbidden
  Arts), with shadow copies painting the strip above and the padding
  columns beside it so nothing scrolls through the gaps. Settings and
  Depths gained a close cross in the heading (their only close sat at the
  bottom of the sheet).
- Spending a skill point on a phone snapped the tree back to the top:
  every panel repaints with `innerHTML` on a sim change, which discards
  every scroll offset inside it. `ui/keepScroll.ts` wraps the repaint of
  ten panels: it notes every scrolled element by a structural path,
  repaints, and restores the offsets (once more after layout).

### Verified (landscape phone box 915x412, touch)
- Ten sheets opened, scrolled to the bottom, close cross inside the sheet
  and hit-testable in all ten (five of them scroll as a whole: inventory,
  character, armorer, forge, Forbidden Arts). The skill tree's column
  region kept its 900 px offset across a spend. Settings on the title:
  z 96, CLOSE hit-tests, closes. Device matrix 74/74.

## 2026-09-05 (iteration 78) - Items reborn: the Raven registry, instances and affixes, the camp forge, the economy

### The Raven registry (`src/items/registry.ts`)
- The local pack `public/assets/test-models/new items` is 2,192 unnamed
  painted icons in three sizes. Sorted by eye (contact sheets), it holds
  weapon sets in steel (1441-1520), gilded (1521-1600) and crystal
  (1601-1680), a hundred and twenty unique weapons (1681-1800), staves,
  and every armor class (helms, plates, robes, boots, shields, cloaks,
  rings, amulets), plus ores, dust, gems and scrolls. 160 of them now wear
  the game's bases: 75 ordinary weapons (25 shapes x 3 tiers), 3 staves,
  22 uniques, 46 armor pieces, 10 jewels and 5 materials, each served as
  the atlas single `wicon_raven<n>` (the manifest grew from 104 to 265).
  There are no 3D meshes in the pack; the game is 2D sprites.

### Instances (`src/items/instance.ts`, `affixes.ts`)
- An item id can now encode an instance
  (`steel_blade@L12R2U3Astr2.crt1`): base, item level, rarity,
  reinforcement, affixes. Every id-shaped thing in the game (pack, doll,
  stash, ground, saves, co-op messages) kept its type; `itemDef(id)`
  derives the definition, memoised.
- `stat = base x 1.08^(iLvl-1) x rarityMult x (1 + 0.05 x upgrade)`.
  Rarities: common 1.0 (0 affixes, 60%), uncommon 1.25 (1, 25%), rare 1.6
  (2, 10%), epic 2.1 (3, 4%), legendary 2.8 (4 + a unique effect, 0.9%),
  mythic 3.8 (5 + a passive skill, 0.1%).
- Nine affixes in three pools: Strength / Agility / Intelligence
  (prefixes; points convert - 1 STR = +1% damage +2 HP, 1 AGI = +0.6% attack
  speed +0.3% dodge, 1 INT = +0.8% cooldown reduction +2 resource), Crit /
  Attack Speed / Cooldown Reduction, Armor / Resistance / Health Regrowth
  (suffixes). Five tiers, one per twenty levels with spread. The engine
  reads them through `Player.passiveBonus` (new keys), the weapon profile
  (crit, swing speed), the skills (cooldowns), the damage path (resist),
  and a per-tick regrowth.
- Legendary uniques: lifesteal, cull, thorns, echo (chosen per base).
  Mythics grant a passive skill while worn.
- Item level tracks depth: two per floor (depth 20 = 39; the cap of 100
  leaves room). Foes climb the SAME curve now (`levelHpScale` is
  `1.08^(ilvl-1)`, damage scales with it too), the hero's max HP compounds
  5% a level, and armor became a share: `armor / (armor + 6 x
  attackerTier)`, so every number on both sides grows together.

### The camp forge (`systems/Crafting.ts`, `ui/CampCrafting.ts`)
- An anvil two strides west of the campfire (the Raven anvil, ember-lit,
  its own plate and E-prompt). Five tabs: SALVAGE, FORGE, TRANSMUTE,
  REFINE, REINFORCE. Every operation is a command drained in the tick and
  rolled from the run's `craft` stream (in the snapshot too), so a party
  shares the sparks. Materials live in a pouch on the hero (saved, v4),
  never in a pack slot; the inventory shows the pouch under the belt.
- Reinforcement +1..+15 at +5% each: 100% to +3, 80/70/60/50 to +7,
  40/35/30/25/20 to +12, 15/10/5 with a catalyst to +15; a failure at +8
  or above costs one level, never the item. Costs grow with the square of
  the level and 35% of the value - the gold sink.

### The merchants (`systems/Town.ts`, `ui/Shop.ts`)
- Value `(iLvl x 15) x rarityMult x (1 + 0.15 x upgrade)`; buy at 100%,
  sell at 25%; BUYBACK tab keeps the last fifteen sold across restocks;
  the tables restock every thirty in-game minutes or on a warden's fall,
  rolled at the deepest depth's level, with material packs for sale. The
  header counts down. Gold piles scale by half the power curve.

### Verified
- Town: the forge node and prompt; salvage, transmute (5 -> 1), three sure
  reinforcements (+3, 6-15 on an iLvl-3 rare blade), a refine that rewrote
  one line, a forge that made an uncommon longsword; the armorer's rolled
  stock with the clock. Depth III: ten drops from twelve kills, all Raven
  icons, materials to the pouch, the epic's card with its three lines.
  Depth X: foes 120-256 HP hitting 20-56, a level-2 hero in iLvl-19 rare
  gear at 39-70 per swing - four hits either way. Save v4 round-trips the
  instances and the pouch. Device matrix 74/74. Phone box: the forge
  panel fits at 0.97.

## 2026-09-05 (iteration 77) - Loot on the leader's word, a living seat, the lobby's breath, the ground card

### Multiplayer
- THE LOOT RIDES THE SYNC. A drop is rolled from a seeded stream, so peers
  in step lay the same item under the same uid - and peers that drifted do
  not: a foe that died a stride apart on two screens, or a stream advanced
  by a divergent roll, left different items on different floors. Every
  drop and every pickup on the leader's floor now rides the next state
  sample (`l` / `lp`), and every keyframe carries the whole floor (`lf`):
  a peer lays what it lacks, replaces what differs (item or more than a
  quarter tile of position), sweeps what the leader no longer has, and
  never hands out a uid the leader has used. `LootSystem.place / remove /
  bumpUid`; `item:pickedUp` names the uid.
- TEN SAMPLES A SECOND. The leader samples every six ticks instead of
  twelve; the packets are deltas, so a still floor still costs nothing.
- A VISIBLE HEALTH CORRECTION SHOWS ITS NUMBER. When the leader's reading
  takes two or more points off a foe the player can see, the difference
  floats up as a damage number, so the pool every hero hits reads the same
  on every screen.
- NEVER OVER A LIVING SEAT. The leader handed a seat to anyone who named
  it, even while its holder was alive and answering heartbeats - a stale
  claim (or a second tab of the same browser, which shares the remembered
  seat number) evicted a live player. A claim on a seat whose link answered
  inside six seconds takes a fresh seat instead, with a lobby line saying
  so. A reloading tab's old link closes first, so a true return still lands
  in its own seat.

### The lobby's portraits
- The rogue and the mage shook on the co-op class screen. Every idle frame
  was trimmed to its own pixels and re-centred in the portrait, so a body
  whose silhouette grew a pixel jumped across the frame; the lobby also
  stepped frames on a 7 fps counter. One union box for all frames now (the
  feet stay planted, the scale is fixed) and the lobby breathes on
  `uiIdleFrame` like the inventory and the status plate.

### The ground card
- The cursor resting on a fallen item raises the item card (THIS beside
  YOURS, the verdict, "on the ground - click to claim"). Mouse only; the
  card folds when the cursor leaves the item or the floor changes.

### Verified (four tabs, one machine, the public broker)
- Four seats filled; the seat-guard line fired when the third joiner
  carried the first's seat number. Depth I: 13 foes, four heroes, identical
  positions and health on all four tabs. A leader-only kill: dead on every
  peer within a sample. Two leader-only drops: laid on every peer under the
  same uids. A peer-only item: swept at the keyframe. A peer whose loot
  stream was advanced rolled a different item under the leader's uid: the
  leader's item replaced it. Three heroes striking one foe through the
  stream: one shared pool, one death, one drop, on every tab.
- Portraits: the bottom edge of every frame's silhouette is identical for
  all four classes (only the true breathing motion remains).

## 2026-09-05 (iteration 76) - The item card: THIS beside YOURS

### What shipped
- `items/compare.ts`: pure arithmetic laying an item beside the piece worn
  in its slot - damage (range shown, average for the delta), swings per
  second from the family timing, reach, crit, stagger, armor (worn plus
  bonus), max HP, damage %, dodge, regen. Rows appear when either side has
  a value; a verdict counts the leans: UPGRADE, DOWNGRADE, TRADE-OFF, EQUAL.
- `ui/itemTip.ts` builds the card for every list: the inventory pack (worn
  piece on the doll shows its own numbers under a WORN column), the shop's
  wares and the sell list, the stash both ways. A bare main hand compares
  against the class's own weapon, because that is what the hero swings.
  Consumables keep their one-line description.
- Touch: a long press (380 ms) raises the card without acting; the tap that
  follows is swallowed; the next touch anywhere folds it. A plain tap still
  equips. The footer says "tap" on touch and "click" on a mouse.
- The card sits above every window now (z 62). It had been UNDER the
  inventory (z 20 versus the windows' 40 since it.71) - hovering a cell near
  the panel's edge showed a card half-hidden behind the glass.
- The card clamps to the layout's viewport (`--app-w/--app-h`) rather than
  the document, so it also stays inside a simulated device box.

### Verified
- Soldier Blade over Rusty Sword: +4 damage, UPGRADE. Flanged Mace: +1.5
  damage, -0.2/s, -2% crit, stagger gained, TRADE-OFF. Ring of Embers over
  an empty slot. Dark Mail over Leather Jerkin: +2 armor. The shop card on
  the armorer's mace. The phone box (412x915): the card inside the box, a
  long press shows it without equipping, a tap equips. Device matrix 74/74.

## 2026-09-05 (iteration 75) - The long QA session, the README with screenshots, the word

### The QA harness (`src/dev/qa75.ts`)
- A scripted playthrough over the public debug handles: a fresh hero in
  town, every window opened / fitted / closed, the chart, the shop and the
  stash, a click-attack on the nearest foe, kills and XP and loot and a
  pickup, a skill cast and a draught, depths II-IV, the depth V arena and
  its warden, the town portal both ways, a save and a reload, a death and a
  rising, the coliseum in and out, every settings toggle, and the device
  matrix in that state. The deep set adds equip / unequip, sell / buyback,
  a gold pile, the thumb stick, and the title's credits, exit, lobby and
  class screens plus CONTINUE. Every console error and unhandled rejection
  is a finding.
- Ten sessions (seeds 1-10, all four classes, six of them deep): the first
  session found nine failures; after the fixes below, sessions 2-4 and 7,
  9, 10 were clean and the rest exposed two more. 73-91 checks each.

### Bugs found and fixed
- The desktop inventory hung 46 px from the top with a ceiling of the
  whole viewport: it ran 34 px off a 639 px window and covered the system
  bar's first three buttons. It hangs under the bar and scrolls now.
- The thumb stick's base spawned under the last touch and STAYED there —
  after a rotation it could sit off the screen or over another control
  (fifteen device configurations failed with the base off-screen). It
  returns to the zone's centre on release.
- The class screen on a short window: a flex column that centres a child
  taller than itself clips the child's TOP — the heading vanished on a
  639 px laptop window. `margin: auto` centres when there is room and
  scrolls from the top when there is not.
- Per-frame DOM writes (the run clock, the interact hint's markup, the
  boss bar's readout, the hotbar's cooldown text) ran sixty times a second
  with the same value; they write only on a change now.

### Observations that were not bugs
- A warp queued during a fade's tail is dropped by design (`transitioning`);
  the harness waits the fade out. The death sheet ignores a click inside
  350 ms of appearing (the ghost-click shield); the harness waits. Depth V
  proper has no warden — the warden is in the arena behind the sealed
  chamber.

### The word
- Every reference to the trademarked genre name in code, docs and the README is gone; the
  combat-model note is `docs/skills/action-combat-model.md`.

### The README
- Rewritten with seven fresh screenshots (`docs/screenshots/`): the
  title, the class screen, the town, a depth III fight, the inventory, the
  co-op lobby, and a portrait phone. Badges, a gallery, a two-column
  controls table, the stack, the architecture, the harnesses.

### Measured
- Idle depth III (35 foes): tick 0.21 ms. In combat: tick 0.62 ms
  (foe AI 0.12, combat 0.09, separation 0.03, pathing 0.003), frame 2.8 ms
  (renderer 1.4, ambience 0.36, foe sync 0.28, lighting 0.24).

## 2026-09-05 (iteration 74) - The audit: a camera leak, a spatial hash, culling, mipmaps, the grade, the documents

### What the audit found
- Type safety was already clean (0 `any` in `src/`); run-scoped UIs already
  used `AbortController`s; projectiles, damage numbers and burst particles
  were already pooled; the resolution cap and the fixed-step loop were in
  place. The real findings were narrower:
- `Camera` added a `wheel` listener to the canvas in its constructor and
  never removed it. A camera is built per floor, so every floor change kept
  the previous camera — and through its closure the previous viewport and
  scene graph — alive. `Camera.destroy()` now removes it; `destroyWorld`
  calls it.
- `EnemyPool.separate` copied the active set and tested every pair every
  tick. It hashes foes into one-tile cells now and resolves each pair once.
- Every world sprite reached the batcher every frame. `render/Culling.ts`
  marks sprites outside the screen (plus a margin) `renderable = false`,
  writing only on a change so Pixi's cached instruction set survives, and
  never touches entities or `visible` (the lighting's flag). Measured on
  depth II: 1,173 world sprites, 48% culled, `renderer.render` 0.14 → 0.08
  ms; the walk costs 0.12 ms, so it is CPU-neutral on a desktop and a GPU
  saving on phones.
- Filtered atlases shimmered under the phone's 0.82x stage zoom: `linear`
  sources get mipmaps; pixel-art stays `nearest`.
- Unhandled rejections vanished: global handlers log with an `[unhandled]`
  prefix.

### Visual
- A colour grade (`ColorMatrixFilter`: contrast +8%, saturation −6%) over
  everything Pixi draws, off at the scaler's low rung, with a Settings
  toggle. Shadow maps, PBR and anisotropy do not apply to a 2D sprite
  renderer; bloom was not applied because the additive layer shares its
  container with the damage numbers.

### Build and documents
- Rollup vendor chunks (`pixi`, `peer`). A root `README.md` (features,
  stack, architecture, setup, controls) and `STATE_ARTIFACT.md` (scorecard,
  component matrix, audit log, known issues, roadmap).

## 2026-09-05 (iteration 73) - Co-op: the leader is the authority, snapshot joins, seat reclaim

### What was there
- Deterministic lockstep over PeerJS (it.59), with grace/rejoin, history
  replay for late joiners and a warp barrier (it.60). Mid-run joining
  already existed as a replay of every frame since the start, which on a
  long delve meant a minute behind a CATCHING UP veil, and a desync (any
  fork of the two simulations) had no cure but the next floor.

### Host-authoritative state (`net/StateSync.ts`)
- The Party Leader samples foes near the party and every hero five times a
  second and sends only what changed; keyframes every four seconds carry
  the floor's alive list. Peers glide their copies to the leader's
  positions, set health, kill what the leader killed (through the combat
  system) and bury foes that died out of interest range. Measured: a foe
  warped 3 tiles and wounded on a joiner returned to the leader's position
  and health within one keyframe; a kill 29 tiles from the party reached
  the joiner in 2 s; an idle party costs about 100 B/s.

### Snapshot joins
- A joiner gets the world as it stands (2.6 KB on depth I) and is live in
  3-5 s at the leader's tick, with the same entity ids, positions, health,
  loot and RNG positions. Three bugs found live: the enemy pool registers
  its foes at construction (the id base is captured there now); the lobby's
  handler swallowed the frames broadcast while the joiner built its world
  (the transport keeps the last thirty seconds and a new lockstep reads
  them); `loadSnapshot` cleared those frames (it no longer clears).
- A player who drops comes back to the SAME seat: the lobby remembers
  `{code, slot}`, REJOIN LAST PARTY is one tap, the host hands the seat back
  whether its old link has fallen silent or not, and the roster goes out
  before the snapshot so the lobby finds its seat. Verified: tab reloaded
  on depth I, host showed RECONNECTING, rejoin seated slot 1 again in 5 s,
  no duplicate seat, leader not lagging.

### Transitions
- A barrier held over 8 s asks the leader for the frames and resumed ticks
  since where the peer stands (`rs`); a joiner arriving while a floor is
  being raised is queued and served on the next heartbeat; the thumb
  controls are blocked during a transition. Three peers went depth I to
  depth II to town together in about 2 s each, positions identical.

### Performance
- Delta packets, interest radius, a 30 s frame ring, a VFX sprite pool
  (damage numbers and projectiles were already pooled).
- `PROTOCOL` 3. `npm run build` clean; no console errors in any tab.

## 2026-09-05 (iteration 72) - The previews breathe

- The status plate's portrait, the inventory paperdoll and the class cards
  each stepped their idle frames on a fixed timer, forward, wrapping: the
  mage's and the rogue's four uneven frames flashed at 6-8 fps. All three
  now read `uiIdleFrame` — the world's time-based, ping-ponged idle at
  two-thirds pace (a 4-frame idle is a ~4.5 s breath, 0 1 2 3 2 1) — and
  repaint only when the frame changes.
- Verified: 1.33 frame changes per second in the UI against 2.17 in the
  world; portrait and paperdoll render for a rogue; zero console errors.

## 2026-09-05 (iteration 71) - Windows above the thumbs

- The inventory was z-index 10 under the touch layer at 24. On a phone the
  pad and the stick zone sat over the lower half of every window and
  swallowed its taps and its scroll: the controls were "blocked", so they
  did nothing — and neither did the window. Windows now stack at 40, and
  while any window or sheet is open the touch layer is `visibility: hidden`
  (a `body:has(...)` rule over the same list `blocked()` uses), so nothing
  can intercept. Scrollers carry `touch-action: pan-y`; the pack's list is
  sized to the screen in both orientations.
- Verified at 412x780: the touch layer hides while the inventory is open,
  the pack grid is the element under the finger, the cross closes; matrix
  74/74; zero console errors.

## 2026-09-05 (iteration 70) - A cross you cannot miss

- The Forbidden Arts' close mark was the it.62 gold medallion — a thin X
  that vanished into the frame on a phone. On touch screens every window's
  close mark is now a solid disc with a bold cross and a bronze ring; the
  cheat sheet also carries a full-width CLOSE button at its foot, and ESC
  (the bar's Menu) closes it instead of pausing over it.
- Verified at 412x780 with touch: cross tap closes, CLOSE closes, ESC
  closes without pausing; zero console errors.

## 2026-09-05 (iteration 69) - Cheat close mark, the browser-bars landscape, vibration

- The Forbidden Arts has a close mark in its head (a phone has no F1);
  the button wiring routes `data-close` to `toggle()`.
- A landscape phone with the address and navigation bars showing is
  ~330 px tall. `tiny-height` (landscape, h < 360): the chart sits BESIDE
  the folded bar instead of above it, the run clock steps aside, and the
  plate's width limit counts both. Four such viewports joined the matrix
  (915x330, 844x320, 667x300, 640x290).
- The ultrawide 16:9 clamp fired on that 2.8:1 phone box and pushed the
  HUD 164 px in from the edges; it now needs a real wide screen (w >= 1600).
- Fullscreen on the first touch: a touch on the controls is the user
  gesture the browser demands, so the first one asks for fullscreen (once
  per page; never again after the player leaves fullscreen by the bar).
- `core/Haptics.ts`: rate-limited vibration patterns — tap, hurt (scaled
  by the blow), crit, kill, boss kill, cast, drink, level-up, death — wired
  at the damage, swing, death, level and cast sites; a Vibration toggle on
  the settings sheet (`visuals.haptics`). Render-side only.
- Verified: matrix 74/74; cheat close mark closes; vibrate calls captured
  (hurt 25 ms, level-up pattern, kill 22 ms); clean build; zero errors.

## 2026-09-05 (iteration 68) - The layout viewport, a touch override, readable menus that reflow

### The root cause behind "zoomed in and cut", "no controls", "tiny menus"
- `OrientationManager` read `visualViewport`, which tracks PINCH ZOOM. A
  phone zoomed out reported 1463x662 for a 412 px screen: the layout dressed
  for a tablet — row bar, desktop map, no pad — and a phone zoomed in
  reported a few hundred px and cut the screen. Fixed elements are laid out
  against the LAYOUT viewport, so that is what the HUD now reads
  (`documentElement.clientWidth/Height`).
- Touch detection had no fallback; a browser in "desktop site" mode reports
  no touch. Detection now also counts `hover: none`, `ontouchstart` and a
  mobile UA, the FIRST TOUCH SEEN on the page flips it on for good, and the
  settings sheet has a Virtual Controls switch: AUTO / ALWAYS / NEVER,
  persisted (`iso-arpg-controls`).
- The class screen's standard tier (400-600 px phones) kept the 240 px
  desktop card: two of them overflowed the 430 px design width and were cut
  at the edges. Every phone tier takes the compact card.

### Menus that reflow instead of shrinking
- Contain-fit floors are legibility floors now (0.75-0.85); past them a
  window REFLOWS and SCROLLS. Modals carry `overflow: auto`.
- Landscape phone: the title menu is two columns (crest left, stack right)
  at full size; the pause and death sheets are two columns of 44 px buttons;
  the class screen shows the four cards in one row; the bestiary caps its
  columns to the screen.
- Portrait: the bestiary shows the creature's page first, the list beneath.

### Also
- The Forbidden Arts is the seventh bar entry (F1); the bar folds row /
  4x2 / 2x4; a 240 px handset takes 36 px targets.
- A new hero leaves town with its class's first skill on slot 1 (the free
  point spent on it) — the hotbar is never four locks on the first screen.

### Verified
- Matrix 66/66; class screen inside the viewport at 412x780 (0.96) and
  915x412 (1.0); title menu 762x324 at 915x412; pause sheet 640x278 at
  scale 1; first skill `whirlwind` on slot 1 with its icon on the thumb
  target; seven bar entries; settings switch renders and persists; clean
  build; zero console errors.

## 2026-09-05 (iteration 67) - The OnePlus 8T bug folder: menu tap, chart, cheats, skill faces, ergonomics, idle fade

### What the five screenshots showed (`public/assets/bugs`)
- Landscape: the draughts rode the top of the RIGHT cluster, 300 px up the
  screen on the fighting hand; the skill targets were bare numerals with no
  icon and no cooldown; the map was hidden entirely (the short-screen rule).
- Portrait: the round map clipped its own corners and read as a blob at
  80 px; the bestiary opened in two columns with the page squeezed to one
  word per line; the close mark sat on top of "0 / 22 KNOWN".
- The boot label "FORGING THE DEPTHS" ran off the left edge of a 412 px
  screen: 22 px at 0.4em tracking is 400 px, and a flex item wider than its
  box sits at the left.
- "Menu" restarted the run. Reproduced in the simulator: the bar opened the
  pause sheet on pointerdown, and the SAME tap's `click` (which fires after
  pointerup, at the same spot) landed on whichever sheet button had just
  appeared under the finger.

### What shipped
- `SystemBar` acts on pointerup and one macrotask later, after the browser
  has dispatched the tap's click to the bar button; `RunMenus` ignores
  clicks for 350 ms after a sheet appears (the ghost-click shield).
- Forbidden Arts: a pause-sheet entry (`cheats` hook) opens the cheat menu
  on a phone; the cheat menu, level select and the open chart now block the
  thumb controls.
- The chart: `Minimap` is a framed 4:3 rectangle (`object-fit: contain`,
  sized by `OrientationManager.mapW/mapH` per tier, 112 px on short
  landscape screens, hidden only on micro) and a tap swells it to the middle
  of the screen with a veil, a plaque and a close mark; the veil, the mark,
  ESC or M fold it. ESC over the chart no longer also pauses.
- Skill faces: the four thumb targets carry the hotbar's icons, a conic
  cooldown veil unwinding clockwise, the seconds left (tenths under 10 s), a
  lock when unlearned and a grey face when the resource is short
  (`touchControls.setSkills` / `setCooldown`, fed from the hotbar builder).
- Ergonomics: the draughts ride above the stick in every layout, and the
  floating stick zone is the lower-left quadrant (34% x 40% of the stage,
  capped 300x220) so the idle hand owns its corner and the right cluster is
  the arc alone.
- Idle fade: 2.6 s without a touch thins the cluster to 42% (62% in the
  pad) over 1.4 s; the next touch restores it in 100 ms. A held stick or
  button never fades.
- Bestiary stacks in portrait (the old rule named `.bs-cols`; the panel's
  grid is `.bs-body`); the list is capped at 34vh so the page shows beneath;
  panel heads leave the close mark 44 px.

### Traps
- `vh` / `vw` in HUD rules ignore the simulated viewport (and a phone's
  address bar); use `--app-w` / `--app-h`.
- The plate's width limit must consider the chart, which is wider than the
  folded bar beneath it in portrait.

## 2026-09-05 (iteration 66) - Ultra-adaptive HUD: the corner plate, the folding system bar, the globes retired

### The audit
- Landscape on a touch device put the health and resource globes, the XP
  strip and the stat line at the LOWER CENTRE of the screen — the it.63
  answer to "both lower corners are thumbs". That is the central clutter
  the report describes: four elements at three anchors, all in the fight.
- The it.66 draft found uncommitted in the tree had the right shape (a
  status plate top-left, an action bar top-right, an arc of skills) but had
  never been verified: the plate scaled with `hudScale * 0.86` and landed at
  0.5 on a landscape phone — 4.5 px type; the bar hid two of its four
  entries on every short screen, which is the it.65 regression exactly; the
  desktop's command sheet was hidden in-run; the hotbar strip ran under the
  thumb stick; and ~400 lines of CSS still positioned globes that were no
  longer in the DOM.

### What shipped
- `ui/StatusFrame.ts`: one obsidian plate — living portrait, level lozenge,
  HP / resource / XP gauges with a slow ghost trail behind each fill, the
  purse — and `#hud-tl`, a flex column that adopts the buffs, the co-op
  roster, the stat line, the depth plaque and the timer. Laid out, never
  pinned: the corner cannot overlap itself at any scale.
- `ui/SystemBar.ts`: six SVG icon targets (inventory, talents, hero,
  bestiary, menu, fullscreen) under the minimap. They dispatch the desktop
  keys, so there is one path into every panel. The bar FOLDS instead of
  hiding: `bar-row` on a wide free edge, `bar-grid3` (3x2) on short and
  micro screens, `bar-grid2` (2x3) beside the portrait pad. Six entries on
  all 66 device configurations.
- `core/OrientationManager.ts` now publishes `plateScale` (`--tl-scale`,
  floor 0.78, 0.48 on a 240 px handset), `barForm` / `barSize`
  (`--sb-size` 48 or 44), `hudInset` (`--hud-inset`: the ultrawide 16:9
  clamp — 1280 px on 5120x1440) and `stageZoom` (0.82–1 on phones, up to
  1.8 on the huge tier). `Camera.setLayoutZoom` multiplies it into the
  wheel zoom. `Ambience.setBudget` thins the embers and mist when the
  PerformanceScaler steps down.
- `ui/icons.ts`: `currentColor` SVG marks on a 24 px grid — an emoji is a
  different picture in every browser and a different width in every font.
- The globes, `#progress-hud`, `#resource-wrap`, the it.65 tray and the
  `hud-top` measuring path are gone from the DOM, from `main.ts` and from
  the CSS: 89 rules and 103 selectors purged by a parser over the
  `<style>` block, 5010 -> 4645 lines, brace balance verified.
- Touch tutorial copy: the move / strike / loot / skill-point hints name
  the stick, the blades, the hand and the bar when the layout is touch.
- Micro landscape (320x240) moves the draught above the stick so it stays
  out of the folded bar's box.

### Bugs found by the matrix, in order
- `sb-row` as a body class collided with the settings sheet's `.sb-row`
  (padding 8px 12px): every device overflowed by 25 px on the right. Body
  classes are now `bar-*`. The lesson is in `docs/skills/adaptive-hud-layout.md`.
- The plate and the folded bar touched on 240x320; the plate yields to
  0.48 there.
- The healing draught sat inside the 3x2 bar's box on 320x240.
- The hero sheet and the bestiary were never contain-fitted: `fit.add` ran
  on `getElementById` two lines BEFORE those panels were constructed, so the
  registration was a silent no-op. `FitScaler.addById` resolves on every
  pass instead, so construction order is moot.
- A hidden tab never advances a CSS transition, so a probe of the close
  mark's inverse scale reads the start frame (identity). Disable the
  transition while measuring; see the skill note.
- The pause sheet had no close mark; it has the medallion now (resumes).

### Verified
- `__qa66(true)`: 66/66 configurations, zero failures — no document
  scroll, no overflow, 44 px targets (84 px attack), no control or HUD
  overlap, corridor rules, six bar entries, legible plate, no thumb
  control above the pad.
- Every bar entry opens its panel and closes it again by pointerdown.
- Joystick + attack on two pointer ids in one gesture: DIRECT_MOVE,
  ATTACK_DOWN, a second heading, ATTACK_UP, STOP — nothing dropped; the
  base spawned exactly under the touch point.
- Simulated rotation 390x844 -> 844x390 in 128 ms with hp, position, gold
  and camera zoom unchanged.
- Clean `tsc --noEmit` and `vite build`; zero console errors.

## 2026-09-04 (iteration 65) - A phone has no keyboard: the system tray, panel fit, HUD restack

### The bug behind every other bug
- The report was "no inventory, no spell tree, no cheat menu". None of those
  panels was broken. They opened on I, K and F1 — and a phone has no keyboard,
  so on a phone they simply did not exist. Iteration 64 fitted and scaled
  panels a player had no way to reach. That is the whole root cause, and it
  was invisible from a desktop browser at 1536 px.

### The system tray (`src/ui/TouchControls.ts`)
- A single gothic bar under the depth label opens a centred sheet: BAG,
  SKILLS, HERO, MAP, PAUSE and FULLSCREEN. Every entry is 172x44, above the
  44 px minimum, and the sheet sits inside the screen at every tested size
  (measured 96..294 x 170..490 on a 390x660 phone).
- Each entry dispatches the SAME key the desktop uses, so there is one code
  path into every panel and no second way for them to disagree.
- Fullscreen moved from the corner into the tray on touch. The corners belong
  to the map and to two thumb clusters; on a short landscape screen the button
  had nowhere left to stand. A desktop keeps its corner button.
- The sheet closes on its own veil, on any entry, and on `releaseAll()`, so a
  rotation or a modal can never leave it hanging over the fight.

### The globes were fighting two rules at once
- Iteration 63 pinned the globes to the top band on micro screens with
  `!important`; iteration 65 pinned them above the pad. Both applied. The
  result on a 320x480 phone: the health globe at x76 and the mana globe at
  x62 — crossed over each other, on top of the depth label, at the top of a
  screen whose pad was at the bottom.
- The top-band rules (`tier-micro` and `hud-top`) are decisions about the
  FLOATING layout and are now scoped `:not(.has-pad)`. The pad layout owns the
  globes whenever there is a pad.
- In micro landscape the globes shrank from 0.42 to 0.36 so the depth label
  keeps its corner with real clearance rather than a pixel.

### Health and stamina, horizontally
- The XP strip was crossing the globes because it was anchored to the HUD
  scale (~46 px up) while the globes are 150 px of art scaled by their own
  factor. Both the pad and the floating layouts now stack off the globes'
  real height: `150px * var(--orb-scale)` plus a gap. Measured zero overlap
  among globe, mana globe, XP strip and stat line at every size.

### The freeze, and why there are no observers in `FitScaler`
- A fit writes a transform and toggles a class. A `ResizeObserver` or a class
  `MutationObserver` then schedules the next fit from inside the effects of
  the last one, and on a hidden page `schedule()` runs synchronously — the
  loop never yields and the tab locks up. A re-entrancy flag does not help,
  because the calls are sequential rather than nested. Both observers were
  removed; fits are driven by the layout, by resizes, by the openers, and by
  a 450 ms heartbeat. The freeze is gone.
- `.fit-centred` is now applied only after a successful measure. A closed
  panel measures zero, and centring it before it had a scale left it half a
  panel off-centre the moment it opened.

### Verified live at 390x660 with touch forced
- Tray opens and closes; every entry drives its panel: bag 333x523, skill tree
  374x588, character sheet 378x493, bestiary 378x582, cheat menu 300x592,
  level select 327x475, pause 320x445 — all inside the screen.
- The map entry toggles the minimap and restores it; pause opens and closes
  without leaving the run.
- Desktop at 1600x900: panels keep their own CSS placement (not centred, no
  fit transform), no touch controls, no tray, corner fullscreen button back.
- 33 devices x 2 orientations: 66/66 pass for document scroll, elements inside
  the viewport, 56 px targets, control overlap, HUD-under-thumb, HUD-under-tray
  and HUD-against-HUD. `PAGES=1 npm run build` clean; zero console errors.

## 2026-09-04 (iteration 64) - Emergency mobile fix: viewport lock, contain-fit panels, ARPG touch controls

### The document may never scroll
- `html, body` are `position: fixed`, full-size, `overflow: hidden !important`,
  with `touch-action: none`, no text selection and no tap highlight. `#app`
  and its canvas the same. Panels that need to scroll do it INSIDE themselves
  with `overscroll-behavior: contain`, so a flick at the end of a list can
  never rubber-band the page. Inputs keep text selection and normal touch.
- Measured on the title, the class screen and the live HUD: no vertical or
  horizontal document scrollbar at any tested size.

### The class screen was cropping — the fix (`src/ui/FitScaler.ts`)
- The bug: four 205 px cards in a flex row are 1008 px wide. On a 320 px
  phone the row ran from x −344 to 664 — every card off-screen.
- The fix is contain-fit, exactly as an image is fitted:
  `scale = min(1, availW / naturalW, availH / naturalH)`, against 90–94% of
  the viewport. Natural size is read from `offsetWidth`/`scrollWidth`, which
  CSS transforms do not affect, so the measurement can never spiral.
- Three things had to be right before the formula could work:
  * The panel needs a DESIGN WIDTH, not the viewport's. `max-content` was
    wrong — it refuses to wrap, so a one-line heading set the width and the
    scale collapsed. The class screen is laid out at 1040 px on a desktop,
    560 px on a tablet and 430 px on a phone (matching its 4/2/2 card grid)
    and is then scaled down as one piece.
  * The natural size must be the CONTENT's. `offsetWidth` alone lies when a
    flex parent has already clamped the box while its children overflow it.
  * The 200 ms entrance from it.61 ended on `transform: none`, and a
    keyframe outranks an inline style — it was silently throwing the scale
    away every time. Full-screen overlays now slide as a whole; panels that
    carry their own centring transform fade instead.
- Registered on the class screen, the title stack, credits, pause, death,
  exit, the co-op lobby, the loading frame and settings. Verified across 28
  viewports from 240x320 to 7680x4320: every one fits with zero cropping,
  zero off-screen elements and no document overflow.

### The touch controls, rebuilt
- Translucent slate under an embossed bronze ring: a lit top edge, a deep
  inner shadow, an inner hairline circle, and a gold bloom when held. The
  attack is its own red-iron circle, the healing draught rose, the mana
  draught steel-blue.
- Sizes are the brief's: 56x56 for every skill and utility, 80x80 minimum
  for the attack (104 px at full HUD scale), with real spacing between them.
- The stick is rebuilt around direct pointer tracking. The base SPAWNS UNDER
  THE THUMB on `pointerdown` — verified: the base's centre landed within a
  pixel of the touch point — and the knob is written straight from the
  pointer's own coordinates inside the event, with no rAF hop and no easing.
  A heading is published the instant it changes. Deadzone down from 0.2 to
  0.12. Verified: every synthetic move produced a command immediately.
- In the PAD the draughts moved above the stick on the left. Four 56 px
  skills plus an 80 px attack already fill the right half of a phone;
  splitting the load is what keeps every target full size and stops the
  cluster growing up out of the slate into the fight.

### The fullscreen corner
- A gothic 38 px button with four carved brackets, top-right on every
  screen — title and crypt, phone and desktop. It calls
  `requestFullscreen()` (with the webkit spelling as a fallback), turns
  green while active, exits cleanly, and survives being refused. On a short
  landscape screen, where the control cluster owns the whole right edge, it
  moves under the depth label instead. Settings keeps its own row.

### Instant reflow
- Rotation and resize now land on the new layout in the SAME frame. The
  it.63 spring was right for a deliberate change and wrong for a rotation:
  a canvas easing toward its new size shows the old one stretched, and a HUD
  sliding to new anchors is a moving target for a thumb already reaching for
  it.

### Verified live
- 33 devices x 2 orientations, all 66 asserted for document scroll, stage
  agreement, elements inside the viewport, 56 px minimum targets, control
  overlap, stick overlap and HUD-under-thumb: zero failures.
- Class selection fits inside the screen at 28 viewports including 320x480,
  390x844 and 968x2376.
- Joystick spawns under the thumb and answers every move immediately.
- `requestFullscreen` invoked from the corner button and from Settings.
- `npm run build` clean; zero console errors.

### What the matrix caught on the way
- The pad's left half could not hold three 56 px draughts on one line (it
  wrapped and squeezed the stick out of the slate).
- The globes straddling the pad's border collided with the new draught row,
  so they now sit just above it.
- Under ~420 px of height a map cannot share the screen with two thumb
  clusters, so it steps aside there (M still summons it).

## 2026-09-04 (iteration 63) - Dual-orientation engine, virtual controls, performance scaler

### The layout spine (`src/core/OrientationManager.ts`)
- One place decides how big the play area is, which way the device is held
  and how dense the HUD may be. It publishes the answer as custom properties
  — `--app-w`, `--app-h`, `--stage-h`, `--pad-h`, `--hud-scale`, `--orb-scale`
  — and as body classes (`orient-portrait` / `orient-landscape`, `has-pad`,
  `input-touch`, `tier-micro … tier-huge`). The DOM HUD and the WebGL stage
  both read that one source, so they cannot disagree.
- The canvas is no longer sized to the window: Pixi's `resizeTo` follows the
  `#app` box, whose height is `--stage-h`. In portrait that is the band above
  the control pad; in landscape it is the whole viewport.
- ROTATION IS LIVE. `screen.orientation`, `resize`, `visualViewport` and a
  `matchMedia` listener all feed one recompute. Classes flip at once and the
  numbers spring to their new values on a `dt * 12` exponential lerp, so the
  HUD glides to its new anchors while the simulation keeps ticking. Nothing
  reloads, nothing re-initialises, no input is dropped. A hidden page snaps
  instead of springing — there is nothing on screen to animate, and a frozen
  rAF would otherwise leave the numbers behind the classes.

### Two architectures
- PORTRAIT (phone): the crypt takes the upper 65% and a gothic slate pad
  takes the lower 35%, filigree along its lip, stick left and the control
  cluster right — no thumb is ever over the fight. The globes straddle the
  dividing border, scaled by `--orb-scale` to the strip the cluster leaves
  them. Minimap top-right, buffs above the pad, party HUD top-left.
- LANDSCAPE (and a tablet held upright): the canvas is edge to edge and the
  controls float in the lower corners, the stick coming to whichever thumb
  presses down.
- THE PAD IS A PHONE ARCHITECTURE. A thumb's arc is the same few centimetres
  whatever the glass, so a fixed 35% band would waste half a tablet's screen
  (on a 2640 px-tall viewport it would be a metre of slate). Above a 600 px
  short edge the controls float instead. That is the one place this iteration
  reads the brief's "lower 35–40%" as a phone rule rather than a universal one.

### The virtual controls (`TouchControls.ts`, `VirtualJoystick.ts`)
- Raw PointerEvents with `touch-action: none`: no 300 ms tap delay, no
  double-tap zoom, no long-press menu. Each control captures its own pointer
  id, so the left thumb keeps steering while the right one hammers skills.
  Verified: a synthetic three-finger sequence produced DIRECT_MOVE, SKILL,
  ATTACK_DOWN, another DIRECT_MOVE (the stick still steering under the other
  two fingers), ATTACK_UP, STOP — in order, nothing dropped.
- The cluster packs into three wrapping rows (utilities, skills, attack)
  rather than an absolute arc, which is what keeps every target its full
  44 px and non-overlapping from 240 px to 8K. The stick reports a screen
  vector that becomes the isometric world axes, exactly as the keyboard does.
- Haptics on every press (`navigator.vibrate(15)`), fullscreen from the
  cluster and from Settings, and a `releaseAll()` on every orientation change
  so a rotation never leaves a thumb "held" on the old layout.
- Nothing here touches the simulation: every control becomes an
  `InputCommand` on the queue, stamped with the local seat, so a co-op party
  stays in lockstep.

### The frame budget (`PerformanceScaler.ts`)
- A rolling 60-frame average walks a resolution ladder (2 → 1.5 → 1 → 0.75)
  with hysteresis: a second under budget steps down, three comfortable
  seconds step back up, never twice inside two seconds. The HUD is DOM text,
  so it stays crisp at the device's own resolution either way. Verified:
  forcing 0.75 shrank the buffer to 1152x521 while the CSS box stayed
  1536x695; back to 1 restored it.
- `quality` also caps the title's ember and fog counts, so a weak device gets
  a calm sky rather than a slideshow.

### The device matrix
- 33 devices x 2 orientations = 66 configurations, each asserted for: the
  stage box and the renderer agreeing; the portrait split; every HUD element
  and control inside the viewport; every touch target at least 44x44; no
  control overlapping another or the stick; no HUD element under a control;
  no globe under the map; and no clipped text. All 66 pass.
- The harness drives the same code path a real device does (`simulate(w, h)`
  writes the same properties), and a transform on the body makes the
  simulated box the containing block for every fixed element, so the whole
  HUD anchors to it and not to the real window.
- What the matrix caught and this iteration fixed: the cluster's rows wrapped
  out of the pad on a 360 px phone (targets now hold 44 px inside the pad so
  four fit a row); a tablet held upright had no anchor for the stick zone
  (the corner anchors became the default); the globes sat under the floating
  stick (they move to the lower centre, and to the TOP BAND when a measured
  free band between stick and cluster is under 250 px); the XP strip kept a
  desktop left offset; and a more specific rule was quietly beating the
  top-band anchors.
- MICRO (240x320) is the one screen where 44 px targets and a 60/40 split
  cannot both hold: there the split evens to ~56/44, the cluster carries five
  essentials (attack, two skills, interact, draught) and the map steps aside.

### Verified live
- Rotation with a run in progress, both directions: same player object, same
  position, same hp, same entity count, still ticking, no reload, no errors.
- Portrait 400x720 → pad 252 / stage 468 with the canvas at 400x468; rotate
  to 720x400 → pad 0, canvas 720x400, controls floating, HUD at lower centre.
- Desktop is untouched: no pad, no touch controls, the keyboard HUD intact.
- `npm run build` clean; zero console errors across the whole pass.

## 2026-09-04 (iteration 62) - Menu cleanup, gothic close medallions, skill node states, the opening and the loading screen

### The asset audit (`public/assets/test-models`)
- Three finds carried this iteration, all from packs already in the tree:
  * `compass.png` — an ornate steel cross with a red gem at its heart. It is
    the close button's crisp metallic cross, and the seal that turns while a
    floor is raised. Baked twice: cold iron with a bronze cast for rest, and
    a gold-graded copy under its own bloom for hover.
  * `Darinia/ornaments/*` — black line-art filigree, recoloured to gold by
    keeping the alpha and repainting the pixels. The loading screen's top and
    bottom bands and its four corner knots.
  * `buttons.png` and the inventory frames were examined and passed over:
    their red-and-silver banners fight the crypt's bronze.
- Everything lands in `public/assets/ui/frames/` (a bake script, not the
  atlas — these are DOM backgrounds, not sprites).

### The stack
- HALL OF RECORDS is gone from the title. The ledgers were never a title
  concern: they live on the town's Hall of Records board, where the delver
  who set them stands. Six buttons now sit under the logo, balanced again.

### The close mark: an X, dead centre
- The first bake left the compass as it came: a four-pointed cross that read
  as a plus, hung off to one side. Its red gem — the mark's true visual
  centre — sits about nine pixels up and left of the bounding box's middle,
  so centring on the box was always going to lean. The mark is now re-centred
  on the GEM, mirrored onto itself both ways so its four unequal arms come
  out the same length, then turned 45° into an X and cropped symmetrically
  about that centre. The baked art measures zero margin on all four sides
  with the gem at (47.5, 47.5) of 96 — square, centred, and unmistakably an X.

### Gothic close medallions
- Every panel's plain `✕` is replaced by a carved medallion: a dark iron
  disc with an inset shadow and a bronze rim, the steel cross at its centre.
  Hover swaps the cross for the gold-lit copy, lights the rim and throws a
  soft outer glow; pressing sinks the disc a pixel, deepens the inset and
  shrinks the cross to 88%. Each one answers a metallic tick on hover and a
  click on strike.
- Fitted to the bestiary, skill tree, character sheet, armorer, alchemist
  and stash — and the INVENTORY, which had no close control at all before
  (only the I key).

### Skill tree node states
- UNLOCKED: full-colour icon (saturated and lifted, with its own soft
  halo), a two-pixel gold border over a warm wash, a gold rank badge, the
  name in gold, and a 3.6 s breathing glow.
- READY: a bronze border pulsing on a 2 s cycle, a bright gold `+` beating
  in the corner, and a bronze badge. The pulse stops under the cursor.
- LOCKED: the icon desaturated to half at 50% opacity, a weathered iron
  border, muted name and text, and a padlock watermark drawn in CSS (body,
  shackle and keyhole) at 28% opacity.
- The badge reads the node's rank in its path — `1/4` through `4/4` for the
  actives, `1/2` and `2/2` for the passives. This game's skills are learned
  once rather than ranked, so the badge shows the true progression rather
  than an invented `1/5`.
- Every tooltip opens with its state in brackets: `[UNLOCKED · LEVEL 1/4]`,
  `[READY TO LEARN · 1 SKILL POINT]`, `[LOCKED · REQUIRES LEVEL 5]` or the
  real gate when it is not a level (`[LOCKED · REQUIRES FIREWALL]`), then
  the name, what it does, and what it would cost.

### The opening
- On the first title only: black, then the fog sweeps across at forty times
  its resting speed and settles, the braziers catch and the vignette
  breathes, the embers begin to rise — and the logo lifts out of the dark
  through a blur into its gold, with a deep horn under a bronze bell
  (`introHorn`: a horn slice and a low sine swell under a two-note bell,
  with dust falling off the doors). The tagline, rule, stack and footer
  follow it in. One and a half seconds, then the scene stands at rest.
- The sequence is read off the WALL CLOCK, not accumulated frames: a player
  who alt-tabs during it comes back to a title that already stands rather
  than to a frozen black screen.

### The loading screen (`src/ui/LoadingScreen.ts`)
- One overlay for every zone change — entering the crypt, descending, the
  arena sealing, the trial coliseum, a portal home, the rift back, a
  fast-travel jump, a co-op join. Dark slate under gold filigree bands and
  corner knots, the rune seal turning at seven seconds a revolution inside a
  breathing amber bloom, the destination in gold, a bronze progress bar, and
  one of fifteen lore tips drawn from the crypt's own rules.
- The bar is honest: `open` → `atlases` (the floor's roster streamed in) →
  `world` (built) → `ready`, easing toward each milestone and creeping the
  last sliver so it never sits frozen, and always finishing at 100% before
  the screen lifts. A 400 ms deadline guards the finish so a stalled frame
  clock can never hold the screen up.

### Verified live
- Title: six buttons, records gone, the opening runs and completes.
- Loading screen on a real town-portal transition: opened as THE PORTAL
  HOME, the bar walked 0% to 100% across ten samples, closed, and the hero
  stood in town.
- Skill tree at level 12 with six points: 24 nodes, 24 badges, 20 locked
  with padlocks, 4 ready with `+`. Learning Fireball flipped it to gold with
  a `1/4` badge, its hotbar picker and `[UNLOCKED · LEVEL 1/4]`; its
  neighbour then read `[LOCKED · REQUIRES FIREWALL]`.
- Close medallions on the bestiary, character sheet, inventory, armorer and
  stash: all 30x30, inside their panels, hover swapping to the lit cross,
  each closing its panel.
- Every new asset serves (five 200s); `npm run build` clean and the frames
  copied into `dist`; zero console errors across the whole pass.

## 2026-09-04 (iteration 61) - The title rebuilt: animated atmosphere, gothic logo, menu categories

### The atmosphere (`src/ui/TitleScreen.ts`, Pixi)
- The title is no longer a CSS gradient with a 2D ember canvas. It is a Pixi
  scene on the game's own renderer, three layers deep, every texture drawn
  once on a canvas at construction (nothing to load):
  * DEPTH — two seamless fog sheets (a wrap-around blob field baked to a
    512 px tile) drifting sideways at different speeds and directions, each
    breathing vertically on its own slow sine, screen-blended.
  * LIGHT — brazier glows in the bottom corners with a hot core, flickering
    on four stacked incommensurate sines so no two flames ever agree, a warm
    wash rising off the floor, and a vignette whose weight pulses.
  * MOTES — 110 embers rising from the corners (additive, warm, swaying,
    breathing in scale) and 55 dark ash flakes falling and turning, each with
    its own speed, lifetime and peak opacity, fading in and out at the ends
    of its life. Halved when ambient particles are switched off.
  * SPARKS — striking a menu button throws a gold burst at the cursor, which
    arcs and falls under gravity.
- The scene runs on its own rAF while the menu is up and is torn out the
  moment a run takes the stage. It sizes off `app.screen`, so the fog,
  backdrop, dimmer and vignette fill any viewport — verified by driving the
  renderer to 1280x800, 1920x1080, 2560x1080 and 3840x1600.

### The logo
- "CRYPT OF THE HOLLOW KING" in Cinzel Decorative 900, filled with a
  metallic gradient (highlight, gold, deep bronze, a second highlight,
  shadow) clipped to the glyphs, carved with two stacked hard drop shadows
  and a black halo. A second copy of the text sits on top as a gold outline
  whose opacity breathes from 0.12 to 0.7, so the edges catch light. The
  whole logo floats 4 px up and down on a 5.2 s cycle.

### Menu categories
- The stack is now CONTINUE · SINGLE PLAYER · CO-OP MULTIPLAYER · HALL OF
  RECORDS · SETTINGS · CREDITS · EXIT GAME.
  * CONTINUE carries a pill with the last delver's class, level and depth
    ("WARRIOR · LVL 1 · THE TOWN"), and stands disabled and dim when nobody
    has gone down yet.
  * LOAD GAME left the title: loading a slot belongs to the class screen,
    where LOAD A SAVED DELVER now sits beside BACK and CONFIRM.
  * HALL OF RECORDS opens the two-tab leaderboard from the title, reading
    the global ledgers with the last delver as "this delver".
  * EXIT GAME asks first, saves, then tries to close the tab — and says
    plainly that a tab the game did not open cannot close itself.
- The stack is keyboard-walkable (up / down move focus, Enter strikes) and
  focus returns to it whenever a sub-menu closes.

### Typography, panels, buttons
- Cinzel Decorative added to the font link for the logo; Cinzel for every
  header and button, Crimson Pro for prose. Hard drop shadows throughout.
- Buttons: muted bronze on dark iron with a carved inner shadow and a
  diamond stud at each end. Hover lifts the text to gold, the border to
  bronze-gold, and adds an outer glow (the studs light too). Active presses
  the panel down 1 px and deepens the inset. A struck button flashes bright
  gold and throws the spark burst.
- SETTINGS is now tabbed — AUDIO (the four sliders and mute), VISUALS
  (screen shake, blood & gore, hurt flash, ambient particles) and CONTROLS
  (the full key reference, scrollable) — in a carved frame with gold
  corners. The visual toggles are new (`src/core/VisualSettings.ts`),
  persist to localStorage, and are read at the effect sites in Camera, Gore
  and Ambience. They are render-side only, so a co-op party stays in
  lockstep whatever each player switches off.
- CREDITS is a reel: the list rolls upward through a masked window on a
  48 s loop and pauses on hover.

### Transitions
- Every sub-menu (class select, settings, records, credits, co-op lobby,
  save slots, exit) rises 14 px into place over 200 ms while the title
  scene dims to half and the menu panel behind it dims and blurs. The scene
  polls the DOM for the open panel, so no panel needed a new hook.
- ESC closes any sub-menu and hands focus back to the stack.

### Verified live
- 1.39 ms per update+render at 1536x695 with the full particle load — about
  25 times the 60 FPS budget of 16.7 ms.
- Every button hovered (crisp tick, no bubbling), every sub-menu opened and
  ESC-closed, focus returned to CONTINUE, records tabs both present,
  credits rolling, exit prompt opening and closing.
- No text clipping and no page overflow at 1280x800, 1920x1080, 2560x1080
  or 3840x1600; the panel is 450 px tall so it fits every one.
- A run started and the scene tore down (one child left on the stage); with
  shake and gore off, `addShake`/`addKick` were ignored and a kill left no
  gore; back at the title the CONTINUE pill had updated. Zero console
  errors throughout; `npm run build` clean.

## 2026-09-03 (iteration 60) - Cross-network relay config, grace period & rejoin, lobby rebuilt, hover SFX

### NAT traversal — what is true in 2026
- ICE now gathers over Google AND Cloudflare STUN (both verified live from
  this machine: server-reflexive candidates in under a second). Mozilla's
  public STUN is dead (no candidate) and was left out.
- Every credential-less public TURN was probed from the browser: the old
  Open Relay (`openrelay.metered.ca`, `global.relay.metered.ca`) answers on
  TCP 443 but allocates nothing — Metered's own page now says the Open
  Relay needs a signed-up API key; `turn.anyfirewall.com` resolves to a
  private address; the freestun/freeturn projects gave no relay either.
  There is no free relay that can be shipped without a secret.
- So the relay is the PLAYER'S: the lobby's NETWORK RELAY section takes
  any TURN account's url / username / credential (a free tier — Metered,
  ExpressTURN, Cloudflare Calls — or a coturn), stores it in localStorage
  only, expands a bare `turn:host:port` to its UDP, TCP and TLS-443 forms,
  and TEST NETWORK reports what the network can reach (STUN only / relay
  reachable / nothing). Nothing is hardcoded; the repo holds no key.
- A join tries the direct path for 8 s; if the channel has not opened, the
  peer is rebuilt RELAY-ONLY (`iceTransportPolicy: 'relay'`) and tried
  again, with a message naming the relay when that fails too. A "join
  through the relay only" switch exists for testing. Without TURN
  credentials, symmetric NAT / CGNAT pairs (phone hotspots) will still not
  meet — stated plainly in the lobby help.

### Heartbeat, grace period, reconnection
- Ping-pong every 2 s both ways (`hb` / `hba`): the leader measures every
  seat's round trip, each joiner its own; latency is broadcast and shown
  on the lobby cards and the party HUD (green < 80 ms, amber < 200, red).
- A link silent for 10 s reads RECONNECTING (nameplate note, party HUD row,
  lobby card, chat line) — the seat and hero are KEPT. Silence past 25 s
  drops the seat (LEAVE frame). The lockstep never freezes the party on one
  seat: a seat late by 1.5 s is played on without (its lane empty) and is
  back in the set the moment its inputs land within two seconds of the
  leader's present.
- A joiner whose channel dies re-dials the leader on its own for 25 s,
  presents its seat and last executed tick, and receives a RESYNC — the
  frames it missed plus any barrier the leader resumed — then sprints
  through the backlog at up to 30 ticks a frame. Verified: the channel cut
  and re-dialled in about six seconds, both peers back at the same
  position; a 19 s send blackout showed RECONNECTING on the leader's screen
  while the leader kept playing, then "Bravo is back."
- A player who comes back through the lobby with the room code is welcomed
  mid-run: the leader ships the party's start (seed, opening roster, stash)
  and every executed frame (plus the frames completed but not yet executed)
  in 48 KB chunks; the joiner replays it all with a CATCHING UP veil (floor
  changes included — barriers resolve locally because the frames are
  final), then a JOIN frame seats their hero on every peer on the same tick,
  at the floor's entrance, with the sheet from their co-op save (class,
  level, XP, gear). The tab saves on `pagehide`, so a closed tab keeps its
  progress. Verified: closed the joiner's tab on depth I, rejoined from a
  fresh tab, same entity id and position on both peers, inputs accepted.

### Losing the leader
- A vanished leader shows THE PARTY LEADER HAS DISCONNECTED (gothic modal,
  "Returning to town…"), saves the local hero, tears the transport down,
  goes solo as its own leader and walks the run home. Verified with the
  leader's transport killed mid-floor: reconnecting indicators for the
  window, then the modal, then town, no console errors.

### Two bugs that only a hidden tab shows
- Chrome throttles a long-hidden tab's `setInterval` to once a minute, so
  the leader's lag rule and both heartbeats never ran during automation.
  Both now tick from the lockstep gate, which the Worker clock keeps alive
  in a hidden tab.
- `DataConnection.close()` fires 'close' synchronously; dropping a seat's
  link from inside that event spliced a shifted index and removed a
  NEIGHBOUR's link (the freshly joined player went silent and, after 25 s,
  mourned the leader). Links are now removed from the table before any
  connection is closed.

### The lobby, rebuilt
- Dark slate frame with bronze corner filigree, a ROOM CODE badge with COPY
  CODE → "CODE COPIED!", four player cards (an animated class portrait
  from the hero's own idle frames, nickname, class badge and level, a READY
  check, the latency dot, the leader's crown, RECONNECTING / OFFLINE
  states), a character selector whose preview cross-fades on a switch, the
  NETWORK RELAY section, chat, READY / START DELVE / LEAVE. The relay
  fields refuse browser autofill (the first pass showed a saved e-mail and
  password dropped into them).

### Hover SFX
- The pitched sheath / pop samples that bubbled on every button are gone;
  `uiHover` is now a dry stone tick (a 16 ms band-passed noise burst and a
  28 ms triangle blip). Every `mouseenter` in the menus, lobby and panels
  goes through this one case.

### Verified live
- ICE probe with the default servers: STUN answered, no relay (expected
  without credentials); the relay-only policy honoured (no candidates).
- Lobby: create, join, ready, portraits, pings (0–9 ms locally), copy.
- Channel cut → auto re-dial + resync; 19 s blackout → RECONNECTING then
  back, leader never stalled; tab closed → lobby rejoin with history
  replay and JOIN; leader killed → modal → town solo. `npm run build`
  clean; zero console errors in every tab.

## 2026-09-03 (iteration 59) - 4-player online co-op: lockstep over PeerJS, party lobby, shared stash, chat

### The choice: deterministic lockstep over WebRTC (PeerJS)
- The engine was built for this from milestone 1: a 60 Hz fixed step, every
  intent an `InputCommand` with a `playerId`, every roll on a seeded stream.
  So the network carries INTENT only. Each fixed tick a peer drains its local
  queue, stamps the commands for tick `now + 6`, and sends them to the Party
  Leader; the leader merges one lane per online seat (slot order) into a
  FRAME and broadcasts it; a tick executes only when its frame is known.
  Four machines run four identical worlds with nothing serialised.
- Transport: PeerJS 1.5.5 (`npm i peerjs`). The free public PeerJS broker
  only brokers the WebRTC handshake (no account, no key; the default
  `peerjs` key is public by design). After that the party talks browser to
  browser over a reliable ordered DataChannel in a star around the leader.
  Zero infrastructure, works from GitHub Pages, nothing hardcoded.
- Room codes (`KNG-482`) come from `crypto.getRandomValues`; the peer id is
  derived from the code. Every inbound message is shape-checked; chat and
  nicknames are stripped of control characters, capped, and rendered with
  `textContent` (never HTML) — a `<b>` sent in chat shows as text.

### The party lobby (`src/ui/CoopLobby.ts`)
- Title screen → CO-OP MULTIPLAYER: nickname, class pick, CREATE PARTY (a
  room code with COPY) or JOIN PARTY (the code, any casing / spacing). Seats
  list in slot colours (gold leader, sky, rose, moss) with class, level,
  READY / LEADER / offline; lobby chat; the leader's START DELVE unlocks
  when every online seat is ready. A full party, a build mismatch, or a
  party already in the crypt is refused with a sentence, never a crash.
- Each class keeps one persistent co-op hero in a hidden save slot (11–14);
  the lobby sends its sheet with `hello`, so every peer builds identical
  heroes (level, gear, skills) in seat order — identical entity ids.

### The sim goes N-player
- One `MovementSystem`, `SkillSystem` and `InventorySystem` per seat, each
  answering only its own `playerId`; `CombatSystem` holds a seat table with
  per-seat swing state, `nearestPlayer()` (the enemy AI's target rule:
  nearest living, unhidden hero) and `seatOf()`; projectiles can hit any
  hero; `TownSystem` resolves the trader per command and the STASH is one
  shared object — the leader's stash is the party's, every put / take /
  gold move is a lockstep command, so all four see the same chest live.
- Aim rides the stream: `AIM` commands (throttled cursor world point) so
  swings and casts resolve toward the same spot on every peer; held-attack
  targeting uses line of sight instead of the per-screen fog in co-op.
- The Party Leader's feet open stairs, gates, portals, teleporters and the
  seal room; a `WARP` command (coliseum waves, level select, the victory
  choice, the epilogue's return) is honoured only from the leader's seat
  ("ONLY THE PARTY LEADER OPENS THE WAY" for anyone else). A warp raises a
  BARRIER: the deciding tick closes the gate, each peer reports when its
  new floor stands, the leader answers RESUME, everyone clears the stale
  delay window and steps out together. `[System] Leader entering …
  Warping party...` lands in chat.
- Wall-clock beats that touched sim state now count ticks: the arena
  teleporter rise and the boss loot burst (solo too).
- Kills give every hero on the floor the full XP; a fallen hero lies where
  they fell and rises beside the entrance at half health after ten seconds
  (no death overlay in co-op); frost auras, gold piles and pickups work per
  hero. Hit-stop and the cheat menu are off in co-op (a local-only edit
  would fork the sim); ESC's pause never stops a party's loop.

### Seeing the party
- Pixi nameplates (nickname + hp bar in the seat colour) over every hero;
  a PARTY HUD under the depth label (★ marks the leader); four colour dots
  on the minimap; party-mates' swings, hurt flashes and level-up rings.
- `#chat` (left column above the orbs and under the party HUD, collapsible,
  unread badge, fades back after eight quiet seconds): ENTER opens the line,
  ENTER sends, ESC closes; `[Nick]: text`, `[System] …`. While typing, a
  capture-phase filter swallows every game hotkey. Rate-limited.
- A WAITING FOR THE PARTY veil when the sim holds > 0.7 s (with who is
  late, or "the floor is being raised on every screen…").

### Losing people gracefully
- A dropped joiner (link close or 9 s of heartbeat silence): the leader
  stops waiting on the seat, injects a `LEAVE` command into the next frame,
  every sim despawns that hero on the same tick, chat says so. A vanished
  leader: the joiner flips to SOLO — it becomes its own leader, generates
  frames locally, the other seats despawn, the run goes on. Leaving the run
  tears down the wire, the chat, the HUD, the worker clock — nothing lingers.
- Chrome pauses requestAnimationFrame in a hidden tab, which would have
  frozen the party the moment one player alt-tabbed: in co-op a Web Worker
  (timers unthrottled) drives the fixed steps while the tab is hidden and
  rAF takes over on return; rendering is skipped while hidden.

### Verified live (two Chrome tabs through the public broker)
- Create → code → join → both rosters agree; lobby chat sanitised; ready /
  start → both runs at the same seed, same seats, ticks in step.
- Joiner walks, chats, deposits to the stash: the host sees the same
  position, the line, the same stash. Determinism hash (every entity's
  id / pos / hp / action + stash + party sheets) at tick 14000: identical.
- Leader into the gate: both peers on depth I on the same tick, same
  positions, 18 enemies each, barrier released. Both hunt the same foe:
  hash at tick 21000 mid-fight identical; the leader fell and rose again
  on both. Joiner's tab closed → host held ~9 s, dropped the seat, went on.
  Mirrored: host closed → joiner continued solo. A third tab joining
  mid-run got the polite refusal. `npm run build` passes with PeerJS
  bundled. Zero console errors in every tab; nothing left after exit.

### Known limits
- Rejoining is possible while the party is in the lobby; a peer that drops
  mid-run rejoins the next delve (there is no mid-run state snapshot yet).
- The party travels as one (no split floors); the leader's stash is the
  party's for the session; joiners keep their own slot's stash on save.

## 2026-09-03 (iteration 58) - Arena exits by teleporter only, records tabs hardened, the E radius

### The arenas
- The boss arenas no longer reveal a stair. Every arena clear (depth V, X,
  XV and XX) raises the teleporter at the heart of the arena; stepping onto
  it descends to the next depth, and on depth XX it opens the victory
  choice. A remembered-cleared arena raises the teleporter on entry. The
  stair prop is parked off-map at (1,1) and never shown in an arena; stair
  contact is ignored there so nothing can descend by accident.

### The Hall of Records
- The two tabs now read DUNGEON RECORDS and ARENA COLISEUM RECORDS and are
  fully independent ledgers. `StatsManager.merge` fills any missing
  `clears[len]` arrays on load, `pushArena` guards against a missing wave
  ledger, and the panel's `render()` wraps the inner renderer in a
  try/catch fallback so a stale save can never blank the board. The arena
  tab renders before any trial has been fought (placeholder rows continue
  the numbering after the real ones).

### The E radius
- One constant, `PROMPT_RANGE = 2.6`, now drives both the prompt plate and
  the interaction: `nearestTownPrompt` and the E handler share it, so the
  key answers the instant the plate appears (previously the plate showed a
  half tile before E would respond). Chests use `CHEST_PROMPT_RANGE = 2.2`
  in `Movement`, and OPEN_CHEST / PICKUP_NEAREST emit `chest:reached`
  immediately when already inside it instead of pathing a step.

### Verified live
- Coliseum floor: zero stair props; depth V arena clear raised the
  teleporter at the arena centre and stepping on it reached depth VI.
- Records board: plate at 2.4 tiles, E on the same tick opened the panel;
  both tabs rendered with the arena ledger empty. Zero console errors.

## 2026-09-03 (iteration 57) - The victory teleporter, the town gone grim

### Depth XX
- When the Hollow King's last form falls, the teleporter (the it.56 stone
  pad, rune rings, vortex and beam) rises at the heart of the arena beside
  the last stair. Stepping onto it opens THE VICTORY CHOICE: RETURN TO TOWN
  (the run goes on, spoils kept) or CLAIM THE CROWN (the epilogue). "Not
  yet" closes it; step off and back on to ask again. A depth XX arena
  remembered as cleared raises the teleporter on entry. The stair still
  ends the delve as before.

### The town, grim
- Grass and dirt diamonds regraded: 45 % / 35 % desaturated, darkened to
  two thirds, a cold cast; the flagstone dimmed a fifth more. The cliff
  cubes ringing the town went from mossy green to deep damp shade. Twisted
  oaks (`tree_a/b`, tinted into shadow) join the pines and dead wood in the
  belt (42 of them). In town the screen vignette deepens to near-black at
  the edges (`body.in-town`). The campfire's pulsing glow and the torch
  ember hotspots already carry the warm side of the palette.

### QA (browser, zero console errors)
- Town: 42 oaks in the belt, `in-town` vignette active. Depth XX: arena
  cleared -> teleporter at (15,11) beside the stair; stepping on opens the
  choice; RETURN TO TOWN lands in town; re-entering the cleared arena raises
  the teleporter on the first tick; CLAIM THE CROWN shows the epilogue.

## 2026-09-03 (iteration 56) - Terrain variants, the teleporter, an honest arena floor

### Terrain
- Every town ground kind now has FOUR diamonds picked per tile by
  coordinate (`floor_town_<kind>_<v>`, `SceneManager` falls back to the
  single): grass and dirt from the `grass/` sheets' variant rows, sand for
  the coliseum, and cobble projected onto the ground plane from the
  `Textures/Stone` squares (rotated, squashed, cropped, graded dim). No
  field reads as a flat block; the arena walk and the town square share the
  flagstone. The 'Tile' mosaic squares were tried first and rejected.

### The teleporter
- `teleport/` is a 3D teleporter's texture set, not a strip: the diffuse is
  the carved stone pad seen from above and `rune2` the glowing blue rune
  ring. Both bake as singles; the pad is squashed 2:1 onto the sand at the
  arena's centre with the ring turning above it (a second, smaller ring
  counter-turning), the vortex strip in its throat and a column of light.
  It rises when the last wave falls and, now, whenever T is pressed in the
  coliseum (a second T while it stands leaves at once); stepping onto the
  pad goes home. The prize chest sits beside it.

### The arena floor
- The sword display cases (read as sarcophagi on the sand) moved onto the
  wall beside the cages. Every fixture on the walk — torches, candelabra,
  candle stands, barricades — now claims its tile as BLOCKED at dressing
  time, so nothing phases through them (24 fixtures, 0 on walkable tiles in
  QA).

### Indexed, not used
- `additional mobs/` (16 LPC-style 2048x2048 sheets: goblin, ogre, slime,
  elemental, werewolf, magician, skeleton, zombie, eight male variants) —
  four-direction sheets; the engine's rigs are eight-direction, so they
  wait for a 4-to-8 mapping pass.

### QA (browser, zero console errors)
- Town ground draws 12 distinct diamonds (four each of grass, dirt,
  cobble); coliseum sand four variants; 24 fixtures all on blocked tiles,
  4 racks on the wall; T raises the teleporter at (23,20) with pad, two
  rune rings and the beam; stepping onto it returns to town.

## 2026-09-03 (iteration 55) - Arena tallies persisted, seated 4x crowd on cheer loops, the fifth upload baked

### Records
- Arena kills persist in batches (every ten kills, every boss, every wave
  clear, and the moment the sand is left) so a browser closed mid-trial
  keeps its tally. The Hall of Records opened with placeholder rows before
  any trial in QA (10 "the ledger waits" rows, no null path).

### The fifth upload (audited, nine new root files + the folders not yet
### baked; the raw folder stays, ignored)
- BAKED: `Characters/Male_0..7` -> `crowd_m0..7` (a 14-frame cheer loop
  each: idle, bend, rise, idle); the `spider` pack -> `spider_walk/idle/
  attack/death` (8 dirs, 25/1/8/8 frames, rows clockwise from east);
  `grass/grass_tiles`, `dirt_tiles`, `sand_tiles` -> 64x32 diamonds
  replacing `town_grass` / `town_dirt` and adding `town_sand` (kind 3);
  `rocks.png` -> `rock_a..f`; `watchtower_wooden_full_size` ->
  `watchtower`; library `displayCaseSword` -> `weapon_rack`,
  `candleStandDouble` -> `candle_stand`; dungeon `stoneWallGateBars` ->
  `iron_cage`; `NEw pack blood/1` -> `vfx_bloodburst` (30 frames).
- INDEXED, not used: the 128x128 iso texture squares, `grassland` and
  `rock_cliffs` sheets, `cursed_grave` strip, `iso_dungeon_walls`,
  `hjm-assorted_rocks`, the library set beyond the case and stand,
  `bloody-wall`, VFX 1-5 frames (four already bake as slashes).

### The crowd (4x, seated)
- 388 spectators in four rows on the wall ring (was 90), eight models,
  east side mirrored to face the sand. Each is SEATED at a fixed spot —
  zero horizontal drift over 90 frames in QA — and either runs its own
  seamless cheer loop at its own tempo or stands breathing, flipping state
  every 2–7 s so the stand ripples. The walking-in-place look is gone.

### Town and arena
- Town: new grass and dirt underfoot; boulders in the lawns (2.5 % of open
  grass, undone if they seal a route); the wooden watchtower beside the
  coliseum road (a cutaway occluder). The dense-fill reachability baseline
  was stale (only the first cluster ever survived) — re-based after every
  kept prop, so tree clusters and rocks both land now.
- Coliseum: sand tiles; iron cages from the dungeon pack; candle stands
  alternating with candelabra; four sword-case weapon racks on the walk;
  22 boulders at the wall's foot.
- The Crypt Widow (spider) joins the pools from depth II (two slots on
  VI–IX) and every wave; a bestiary page; champions' deaths on the sand
  burst the new blood strip.

### QA (browser, zero console errors)
- Town audit clean, 11 rocks, 386 pines, watchtower placed; board opens
  pre-arena with 10 placeholders. Coliseum: 388 crowd sprites, none moved
  horizontally in 90 frames, sand kind 3 at the centre; spider spawns on
  `spider_idle` at rig scale 0.75; 7 arena kills stored mid-match.

## 2026-09-03 (iteration 54) - Split ledgers, the active clock, the Hall of Records, a living coliseum, boss waves

### Records and the clock
- `systems/StatsManager.ts`: two ledgers. DUNGEON: deepest depth, kills,
  wardens slain, per-floor clear records (deepest first, fastest within a
  depth, top 10). ARENA: best wave, kills, champions felled, clear records
  per 5 / 10 / 15 / 20-wave trial (fastest first, top 10), gladiator rank
  (Untested / Sand-blooded / Novice / Veteran / Champion / Crown of the
  Sand). Global in localStorage (`iso-arpg-records`) and copied into the
  save (`stats`); loading merges best-of-both.
- THE ACTIVE CLOCK: `activeTicks` advances only on dungeon floors and during
  a live arena wave — the town and the intermissions stand still. The HUD
  timer shows it; floor clears record `floorActiveTicks`; a trial records
  its active span; `activeTicks` is saved.

### The Hall of Records
- `ui/LeaderboardPanel.ts` replaces the old tallies board: two tabs,
  DUNGEON SPEEDRUNS and GLADIATOR COLISEUM (with 5/10/15/20 selectors), a
  ranked table (rank, class, MM:SS, floor or wave, date) with the ledger's
  tallies beneath (deepest / kills / wardens / this delver; best wave /
  arena kills / champions / rank).

### The coliseum, alive
- THE CROWD: ninety townsfolk in two rows on the wall ring, each cycling
  frames on its own beat and bouncing — a stand that never sits still.
- DETAIL: 34 blood-soaked patches and a dozen broken weapons on the sand,
  spiked barricades flanking each gate, iron cages and red/blue war banners
  on the wall, torches with an additive flicker glow, ember hotspots, and a
  dry sand drift across the floor.
- SPAWNS: every body climbs out of the sand (`Enemy.beginRise`: frozen,
  half-sunk and translucent, sliding up over 24–42 ticks through a ring of
  dust) — no pop-ins.
- BOSS WAVES: wave 5 the Tomb Warden, 10 the Frost Warden, 15 Vyrissa, 20
  the Hollow King (level wave+3), rising at the north gate behind a red
  light beam, a pentagram flash, a 0.85 shake, a 3-tick hit-stop and the
  ARENA HORN (the war horn under a brass swell). The boss bar tracks it.
- THE CROWD ROARS: every champion or boss felled on the sand plays the
  synthesized crowd swell, a gold burst and a glint.

### QA (browser, zero console errors)
- Clock: 0:00 after 300 town ticks; 0:05 after 300 dungeon ticks; still
  0:05 back in town and through the trial's intermission; 0:06 in the fight.
- Hall of Records opens from the board with both tabs and empty ledgers.
- Wave 1 bodies rising (riseTicks 15–29, body 18–27 px sunk, alpha 0.5).
- Wave 5: "THE TOMB WARDEN ENTERS", bar 1302 / 1302; trial complete ->
  arena ledger: best wave 5, 51 kills, 1 champion, one 5-wave record.
- Floor I cleared -> a speedrun record on the dungeon tab; the save carries
  `stats` and `activeTicks`.

## 2026-09-03 (iteration 53) - Elite affixes, the Trial Coliseum, combat acceleration

### Elites
- One body in seven (15 %) rises as a champion: `Enemy.setAffix` gives
  +15 % scale, x1.5 life, a titled nameplate ("Vampiric Rotting Ghoul",
  colored by affix, held at screen size) and a floor aura drawn under the
  feet (cyan shards / amber spikes / crimson drops, breathing).
- FROST-TOUCHED: inside three tiles the hero is chilled — move x0.75 and
  swing timings x1.33 (`Player.chillTicks`, refreshed per tick, shown as a
  debuff ring). THORNS: 15 % of a hero's blow reflects (armor still
  applies; never on the killing blow, never re-reflected). VAMPIRIC: a
  fifth of every wound flows back into the champion, shown as a crimson
  "+N". Elites pay x1.5 XP and always drop. The floor spawner rolls the
  affix before the memory skip so remembered floors keep their champions;
  arena honor guards and coliseum waves roll too.

### The Trial Coliseum
- Town: a cobbled apron at the east end of the high street with the arch
  between two pillars, a brazier and the Arena Master (E opens his dialog:
  5 / 10 / 15 / 20 waves, or "Not today"; Esc closes).
- `scenes/Coliseum.ts`: a 46x40 ellipse of sand with a cobbled walk, stone
  wall, sixteen fixtures (torches, candelabra, pillars) and ~80 townsfolk in
  two rows of stands facing the sand; four gate pads N/E/S/W with a red
  glow. Floor index -1 (`THE COLISEUM`), theme `town`, no chests, no stair,
  `Lighting.omniscient` — every tile visible, full light everywhere.
- Waves (sim): 5 s to the first wave, then `4 + 2n` bodies (cap 24) from
  the pads, level n+1, pool by depth 2n-1, elite chance 15 % + 4 %/wave (cap
  60 %), all set to chase. Clear -> "WAVE CLEARED!" banner and a 15 s
  intermission counted on the wave HUD ("WAVE 3 / 5 - NEXT WAVE IN 12s").
  Last wave -> "TRIAL COMPLETE!", a grand chest at the centre (three
  rare-or-better trophies + two rolls, gold halo) and a blue rift four tiles
  east that walks you home. T abandons the trial. The trial is never
  captured to floor memory; a save inside it resumes in town.

### Combat acceleration
- `COMBAT_SPEED = 1.25`: hero windup and recovery /1.25 (recovery a
  further x0.85 for chaining); enemy windup/recover /1.25; projectiles
  x1.25 (arrow 11.25 / bolt 9.4 / fireball 10). Every cast now calls
  `Movement.interrupt()` so a skill fires the instant the key lands.

### QA (browser, zero console errors)
- Town audit clean; dialog opens; 5 waves chosen -> floor -1, omniscient,
  far tiles visible, 340 object nodes; wave 1: 6 foes, 3 elites titled and
  ringed. Frost: chill 12, speed ratio 0.75, clears when the champion
  leaves. Vampiric: +3 on a 15-damage bite (expected 3). Thorns verified on
  a non-lethal blow. Five waves cleared with 15 s intermissions; grand chest
  opened for 5 drops; rift -> town, HUD hidden. Cast on a 6-step path clears
  it at once.

## 2026-09-03 (iteration 52) - End-to-end audit pass

- Static: typecheck + production build clean; no TODO/FIXME markers.
- Live (one session, zero console errors): menu + fonts; all four classes
  start with their rigs, kits and resources; armorer + alchemist buy/sell/
  buyback; stash put/take/gold; gate descent; melee kill; all four rogue
  skills cast with cooldowns and costs (an empty Blade Flurry refunds by
  design); 10 kills drop 7 items; pickup; chest opens with 3 drops; equip/
  unequip iron cap (armor 3 -> 4 -> 3); Q potion 30 -> 94; 60 sfx names and
  7 music transitions without error; 0.076 ms per sim tick with 592 object
  nodes; death overlay then respawn at the entrance at full life; skill
  tree, level select, settings, cheat menu, minimap toggles; depth X and XV
  wardens (Frost Warden lvl 13 / Vyrissa lvl 18) with bars, kills and
  stair reveal; portal to town and back to depth III at the exact tile.
- Polish: the XP figure gets a hard black outline over the gold fill.

## 2026-09-03 (iteration 51) - Dark-fantasy scrollbars, pack padding, icon fit, hotbar locks, window frame pass

- SCROLLBARS: every scrollable surface (inventory, bestiary, skill tree,
  shop, stash, records, character sheet, cheat menu, level select,
  settings, endgame) draws the same 11 px stone track with a bronze thumb
  (gold on hover, bright when dragged); `scrollbar-width: thin` +
  `scrollbar-color` for Firefox; the page itself never scrolls; no corner
  or button artifacts.
- PACK PADDING: the inventory is 352 px wide with 22 px side padding, the
  scroll field carries its own 6 px left inset and the grid is left-aligned,
  so column 0 sits fully inside the frame. Rarity rims and the hover glow
  are INSET shadows now — nothing crosses a cell boundary — and the hover
  lift is gone.
- ICON FIT: `fitItemIcons()` sizes every icon in a cell to
  `min(slotW / w, slotH / h) x 0.85` of its natural size (re-fitted when a
  late image loads); a CSS cap of 85 % backs it. Applies to the pack, the
  paperdoll slots and the belt.
- HOTBAR LOCKS: an unlearned hotkey slot renders at 0.4 opacity with a
  grey padlock watermark and a muted "Locked - Requires a skill point"
  tooltip (or "N skill points to spend - press K" when points are banked).
- WINDOW PASS: one frame for every window (2 px iron border, gold inset
  line, deep inner shade, drop shadow), one 26 px close button, one 15 px
  title size across the inventory, shops, tree, sheet and bestiary.

### QA (browser, zero console errors)
- 24 items in the pack: column 0 fully inside the scroll field, every
  icon within 85 % of its cell, the field scrolls with the bronze thumb;
  four hotbar slots show padlocks with the locked tooltip on hover; the
  armorer's list scrolls with the same bar.

## 2026-09-03 (iteration 50) - 48-slot pack, pixel boss fill, town label manager, forest ring, side-by-side globes, collapsible commands

### Inventory
- The pack is a fixed 6x8 field (48 slots, more rows when the haul
  outgrows it); every empty slot is drawn, the field scrolls (height
  follows the viewport), the count reads "26 / 48". Crisp 1 px slot
  borders with an inner black line; rarity rims glow (common gold, magic
  blue, rare amber, legendary orange). The panel grew to 302 px.

### Boss bar
- The red fill is a PIXEL width recomputed every render frame:
  `hp / max x (track width x 0.766)` (the frame's window). 322 / 162 / 33 px
  at 100 / 50 / 10 % in QA, shrinking with the numeric counter.

### Town
- LABEL MANAGER: plates sort by screen Y and any two whose boxes meet are
  spread apart; a plate fades out while the E-prompt for the same landmark
  shows (`setPromptAt` from the render loop), so no title doubles up.
- FOREST RING: the belt inside the blob is 72 % trees / 28 % bushes, and
  the cliff tiles up to two deep beyond the blob carry their own trees and
  bushes (445 trees, 235 bushes, 245 of them on cliff tiles), drawn in
  front of their cubes — no raw tile edge shows. The straight west wall
  stays bare for the gate.

### HUD
- The stamina/mana globe sits beside the health globe at the bottom-left
  (four-fifths scale); stats and the XP row moved right of it; the portal
  icon sits right of the hotbar.
- COMMANDS is pinned to the bottom edge with a permanent "COMMANDS v / ^"
  handle that folds the sheet down (remembered in localStorage).
- Stat icons: crossed swords for damage and a shield for armor on the HUD
  and the character sheet.
- XP bar: 120 x 12 px, glowing gold fill with a moving sheen, a tooltip
  "XP: 7 / 156" and the same text overlaid.

### Level-up, hints, type
- The LEVEL UP! banner rides over the hero (positioned every frame) for
  4.5 s beside the flash and pillar; the floating duplicate text is gone.
- Popup timers doubled: tutorial banners 11 s, descend note 5.2 s, boss
  note 8.4 s, death note 5.2 s.
- Every panel root inherits a crisp dark drop shadow.

### QA (browser, zero console errors)
- 24 items added: 48 cells, 26 stacks, scroll 397 > 222. Boss fill
  321.7 / 161.7 / 33.1 px. Town audit clean. Zoomed-out edges wrapped in
  forest. COMMANDS folds and unfolds by its handle. Level-up banner at the
  hero's head.

## 2026-09-03 (iteration 49) - Dual globes, nameplates, orc anchors, tree lines, bestiary keys, portal icon, loot-then-stairs ending

### Text and type
- Audit: every in-game string was already English; the one Cyrillic
  fragment was a code comment (TownMap) and is now English. Lock reasons
  read "REQUIRES LEVEL 5" / "REQUIRES WHIRLWIND" / "NEEDS 2 SKILL POINTS".
  A high-contrast text shadow now sits on every readable UI line (tree
  text, shop rows, bestiary rows/stats, character sheet, HUD labels, tips).

### Town
- The gate segment stands TWO tiles out from the west wall (x 3, threshold
  (3,26)); the strip behind it is solid rock (no cube, nothing walks there).
- Floating NAMEPLATES (Pixi text on a dark gold-rimmed plate, bobbing,
  drawn above every roof): TOWN STASH, THE ARMORER, THE ALCHEMIST, DUNGEON
  RECORDS, THE HEROES' CAMP, THE DUNGEON GATE.
- The alchemist wears the peasant body (`villager_walk`) in violet — no
  longer the armorer's twin. The camp gained a keg, a crate and cookware
  beside the three resting heroes.

### Sprites
- Crypt Sentinel (halberdier) verified walking toward its movement vector
  in-game after the it.48 half-turn map (a spawned sentinel approaching from
  the east shows its left profile).
- Orc Slinger: measured solid-pixel bottoms per clip (walk 89 / idle 92 /
  attack 70 / hit 79 / death 83 of 96) — the attack and hit clips sit high
  in their cells. New `feetAnchors` per animation (attack 0.75, hit 0.84,
  death 0.885, idle 0.97, walk 0.95) keep the slinger grounded mid-swing.
- Hurt flash toned down: max alpha 0.25, 0.15 s pulse.

### HUD
- DUAL GLOBES: the health globe on the left, a resource globe on the right
  (the same gargoyle glass hue-rotated gold for stamina / blue for mana)
  with the numeric value and the resource name; the old bar is gone. The
  COMMANDS sheet moved under the minimap so the globe owns the corner.
- Inventory: drag verified (header pointerdown → pointermove); the panel is
  capped at the viewport height and scrolls, the pack list grows to 232 px.
- Skill tree: prerequisite lines between tiers (gold when the tier below is
  learned, green when ready) above the padlocked silhouettes.
- Buff timers read "3.5s" under ten seconds on the HUD and over the head.
- Boss bar fill = hp/max × the frame window (76.6% of the track) — it was
  clamped, so it only started shrinking below 77%.

### Bestiary
- The list keeps its scroll when an entry is picked; Up/Down arrows cycle
  the known entries and scroll the lit row into view.

### Level-up, portal, ending
- Level-up: gold screen flash + "LEVEL UP! · LEVEL N · +1 SKILL POINT"
  banner over the it.48 pillar, aura and chimes.
- Scroll of Town Portal never drops or rolls from chests and left the
  alchemist's table; the HUD button beside the hotbar is now the scroll's
  icon with the T key and cooldown.
- FINAL DEPTH: killing the Hollow King's last form no longer ends the run.
  The spoils drop, the last stair opens behind the arena with a hint, and
  THE CRYPT IS CONQUERED plays only when the hero climbs it.

### QA (browser, zero console errors)
- Town audit clean; 6 nameplates; MANA globe reads 120 for a mage.
- Sentinel walks forward; orc attack clip anchored at 0.75; level-up
  banner/flash shown; bestiary scroll kept at 300 and arrows cycle
  archer → orc → boss; depth XX arena cleared with no ending, stair
  revealed, stepping on it shows the epilogue.

## 2026-09-03 (iteration 48) - Combat feel, boss bar, buff timers, respec, dual vendors, records board, deep save

### Map, portal, HUD
- The gate segment stands ONE tile out from the west wall (x 2, threshold
  (2,26)); the tile behind the opening carries no wall cube.
- Depth I only grows its tutorial waystone on the FIRST visit: a rebuilt
  depth I (back from town) no longer shows a second portal-looking stone.
  Arriving in town after any descent queues the hint "press L to open
  DEPTHS and fast-travel". Hint banners read for 8.25 s (+50%).
- Boss bar: shown the moment the warden stands in its arena (it used to
  wait for a fog sighting, and an arena rebuild reset that), name · level
  in the title, numeric "827 / 1176" inside the 24 px silver track, and it
  lingers three seconds past the killing blow instead of vanishing.
- Stamina and XP gauges carry text overlays ("87 / 100", "XP 12 / 180").
  Damage numbers float at 0.75 opacity with a smoother ease-out.

### Combat feel
- CRYPT SENTINEL and GRAVE GUARD walked backwards: a per-row render of both
  sheets shows the halberdier stores [W, SW, S, SE, E, NE, N, NW] (a half
  turn: `(d + 4) mod 8`) and the shield-bearer runs counter-clockwise from
  SW (`(d + 3) mod 8`, the peasant order). Both maps corrected.
- HIT-STOP: crits freeze the sim two ticks, kills two (bosses three), a
  12+ blow one. Directional camera kick along the blow's screen vector
  (`Camera.addKickDir`). Impact burst VFX on 8+ blows. Layered audio: the
  weapon's slash under every landed hit, the species pain grunt, the wet
  splatter layer from 8 damage.
- Player hurt: red edge flash on `#vignette.hurt` (0.3 s) plus a recoil kick.
- Shadows: the texture is twelve feathered rings (no hard rim); hero and
  mob shadows stretch and are thrown 12 px away from the nearest torch,
  brazier or campfire via `Lighting.lightDirAt`.

### Smart clicks
- A click on rock / a wall / a sealed pocket paths to the reachable tile
  nearest the click (radius up to 6, ties toward the hero, ten A* tries).

### Skills
- Locked nodes show a padlock and a near-black silhouette icon.
- Active buffs (War Cry / Arcane Intellect, Stone Skin, Haste, Vanish,
  Poison Blade, Frostbite as a debuff) render as icon tiles with a conic
  countdown ring and seconds on the HUD above the hotbar AND over the
  hero's head (`Player.activeBuffs`, `buffMax` set at cast).
- Level-up: a golden light pillar climbs off the hero plus an aura strip and
  a second chime.
- RESET SKILLS in the tree header refunds every learned rank and passive
  (`RESET_SKILLS` command, `SkillSystem.resetSkills`); disabled in the
  dungeon (button greyed "TOWN ONLY", the sim refuses with a floating note).

### Town
- Two shopkeepers: the ARMORER (north stall: arms, armor, magic/rare gear)
  and the ALCHEMIST (south stall, violet robes: potions, elixir, portal
  scroll). `TownSystem.stockAlch`, `BUY.vendor`, `ShopUI.open(vendor)`.
- DUNGEON RECORDS board (signpost off the south street, E): total kills,
  wardens slain, gold collected (`Player.goldCollected`), deepest depth,
  time in the dark.

### Save v3
- `SaveGame.pos` + `arena` record the exact spot; CONTINUE / LOAD resume on
  that floor at that tile (arena mode when saved inside one). Older saves
  migrate (v1 → v2 → v3) and resume in town. `goldCollected` persisted.
- Starter kit adds a secondary arm: a short bow for the melee trades, a
  rusty sword for the ranger.
- Pentagrams mark BOSS floors only: the arena heart and the seal room of
  depths V / X / XV / XX (the 35% far-room sigils are gone).

### QA (browser, zero console errors)
- Town audit clean; both vendors trade; the board opens; 23 padlocks in
  the tree; respec 9 → 7 → 9 points in town, refused on depth I.
- Smart click on a wall tile paths to the tile beside it; hurt flash
  toggles; a kill freezes two ticks; pillar renders on level-up; buff rings
  show for War Cry + Vanish.
- Save on depth III at (8.5, 10.5) → reload → resumes on DEPTH III at the
  same tile with the loadout intact.
- Depth V arena: bar shows at once, "1176 / 1176" → "827 / 1176" → "0 / 1176".

## 2026-09-03 (iteration 47) - West wall cleanup, gate glued into the wall, threshold inside the arch

- The baked ruin gate is a THIN wall segment four tiles long whose arch faces
  EAST (measured from the bake: its south corner sits at 0.3 / 0.995 of its
  box). It had been placed on a 3x2 footprint with a centred anchor, which is
  the offset the user saw. It is now a 1x4 segment set INTO a straight
  two-tile west wall column (x 0-1, y 19-34), anchored on its own south corner,
  sorted as a wall along y (everything east of it draws in front).
- The apron in front of the wall (x 2-10, y 19-34) is bare cobble: braziers,
  torches, guards, the flat stair sprite, belt pines and brush are gone from
  it; the guards watch from the far end of the high street (x 14).
- The threshold is the tile inside the arch opening (1,26); touching it from
  the apron descends at once. The belt pass no longer re-blocks it.

## 2026-09-03 (iteration 46) - Dungeon gate relocated to the WEST cliff

- The ruin archway now sits on the west edge of floor 0, EMBEDDED in the
  cliff: solid rock above (x 0-8, y 19-24) and beside it (x 0-1, y 25-32),
  the 3x2 footprint at 3-5 x 25-26, the threshold tile at (4,27). A cobbled
  forecourt (x 2-9, y 25-30), two braziers flanking the threshold, two
  guards on the road, two torch posts. The high street now starts at the
  threshold and runs straight east to the market square. The blob bulges
  gently toward the west cliff; the north-west quarter keeps its cottages,
  stalls and stores on a plain lane. Contact with the threshold descends.

## 2026-09-03 (iteration 45) - North-west gate, dusk-lit town, no town pentagram, music playlists, Darinia font, gargoyle globe + framed bars

- GATE: the ruin archway now sits NORTH-WEST, set into the cliff (footprint
  10-12 x 8-9, front tile (11,10)) with a cobbled forecourt, braziers and
  guards; the blob's bump follows it. The gate road runs south-east to the
  square through a new built-up quarter (two cottages with fences, two
  stalls, crates, stacked barrels, a wood pile, signs, four torch posts).
  Touching the front tile descends at once (unchanged contact rule).
- TOWN: the ritual circle, its track and clearing are gone from floor 0
  (pentagrams stay in arenas and hidden dungeon rooms). Lighting builds the
  town with `fullRadius 5 / sightRadius 36` instead of 14 / 40: full light
  only beside the hero, the rest of the streets lit by the baked warm
  sources (torch posts, two braziers, the campfire, the stash glow).
- MUSIC: `TOWN_PLAYLIST` (Whispers of the Abyss, dark magic, spell chant)
  and `DUNGEON_PLAYLIST` (dark mystery, unleashed demon, gloomy drone,
  demonic presence). Town and dungeon beds no longer loop one file: an
  `ended` listener steps the playlist and keeps playing; every new dungeon
  floor steps it too; entering the deep band jumps to the drone. Menu,
  boss and victory beds still loop.
- FONT: `Darinia.ttf` from the upload registered via `@font-face`
  (`assets/ui/fonts`) as `--font-display`; applied to every panel header,
  sheet / tree / bestiary titles, tooltip names, skill and item names,
  menu and endgame buttons, banners and the depth label.
- HUD: `health_globe.png` (the gargoyles' red glass) is the health orb; the
  old fill circle sits over the sphere in multiply blend so the glass
  visibly drains. `enemy_health_bars_2.0` supplies the bar background, the
  gold frame + blue fill for the hero's resource bar (stamina hue-rotated)
  and the silver frame + red fill for the warden's bar. The left HUD stack
  shifted right to clear the wider globe. `rpg - hud.psd` was inspected
  (portrait ring + bars with baked "100%" text) and not used.

## 2026-09-02 (iteration 44) - Portal softlock fix, north gate on contact, orc anchor, pack stairs + chests, pentagrams, skill point cap, HUD frames, UI voice

### Town-portal softlock (root cause + fix)
- CAUSE: a rebuilt arena copied `arenaCleared` from memory into the SPAWN
  decision (no boss when cleared) but the World literal still started at
  `arenaCleared: false` - so a portal round trip to a beaten arena had no
  enemies and a stair that kept saying "the arena is sealed".
- FIX: the World carries the remembered flag; plus an ARENA SAFETY rule in
  the tick - when nothing in a sealed arena breathes (no hp, no phase
  transition) for 45 ticks, the arena clears itself and the stair reveals
  ("Nothing left breathes here"). No rebuild, portal trip or spawn
  accounting can strand the hero again.

### The gate moves NORTH and opens on contact
- Town v4 (60×54): the ruin archway sits at the top centre (footprint
  29–31 × 3–4, front tile (30,5)), braziers and two guards at its foot, the
  cobbled main street winding south into the market square. Touching the
  front tile (reach 1.05) descends at once - no prompt needed.
- DENSE FILL: seven cottages, six stalls, the tavern, vault, camp, portal
  yard and a lower plaza; then every open lawn is seeded with tree clusters
  (each seed is undone if a flood fill shows it cut a route) and bush tufts
  (26% of open grass). A hidden ritual circle glows in the south-east woods
  at the end of a forest track.

### Units + models
- Orc Slinger: the pack bakes a long drop shadow, so the automatic painted
  anchor floated it; sprite defs gain `feetAnchor` and the orc is pinned
  at 0.95.
- Stairs: the isometric pack's stone spiral (80×109) stands on the stair
  tile as a depth-sorted prop on every floor (the old stairwell is the
  fallback). Chests: the pack's dark-wood chest (closed 64×54, open 70×76)
  replaces the procedural box via `assets.registerTexture` at boot.
- Pentagrams: `pentagram.png` (7-frame glowing sigil sheet) baked as
  `vfx_pentagram`; every arena floor loops it at the room's heart, 35% of
  ordinary floors hide one in the farthest room, the town keeps one in the
  woods (with a warm light source).

### Skill points
- Two points per level (59 by level 30; every rank costs 44). Cheat HERO
  tab: "+10 POINTS" and "MAX OUT".

### HUD + sound
- Minimap in an iron/stone gradient frame with gold hairline and corner
  studs; dark backing panels (0.68–0.78) behind the hotbar, the command
  list and the orb bar.
- UI voice swapped from the pack's bubbly pops to iron and oak: blade
  whisper on hover, lock click on click, door + lock on confirm, blade
  going home on back, chest / door on inventory open / close.

## 2026-09-02 (iteration 43) - Deploy, direction re-audit, bestiary silhouettes, free town portal, boss victory, persistent gore, asset pack integration, organic town

### Stage 1 - commit, push, GitHub Pages
- `git add .` swept the untracked 1.1 GB `public/assets/test-models` upload
  (13,454 files) into the milestone commit and GitHub accepted it with a
  large-file warning. Rewrote that single commit without the folder
  (`--force-with-lease`), added `public/assets/test-models/` to
  `.gitignore`, then `npm run deploy` (PAGES=1 base + gh-pages) -> the
  site answers 200. The raw folder is NOT deleted this time (the user's
  preservation rule) - it stays local, ignored, indexed below.

### Direction re-audit (ground truth, every mob sheet rendered per row)
- Correct: hollow2, mithras, frost, naga, hydra, guard, wolf, lizard,
  shambler, skelw, skelm, shaman, ahoul, knight.
- WRONG and fixed in `SpriteLibrary.DIR_ROW_FIX`: the zombie pack (also
  the Hollow King's first form) stores rows CLOCKWISE on screen ->
  `(8 - d) mod 8` (it had the mirror map, which put W under E: the boss
  ran left facing right); the grave-guard pack is a half turn out ->
  `(d + 4) mod 8`. New packs: Villager_01 and archer rows run
  counter-clockwise from South -> `(d + 2) mod 8`; the orc pack matches
  the canonical order.

### Bestiary
- God mode (Forbidden Arts) sets `Player.bestiaryRevealed` (not saved):
  every page reads as known while it is on. Unknown creatures are now
  selectable and render as a solid black silhouette (`brightness(0)`)
  with "???" for the name and every stat.

### Item phrasing
- `statLine()` now emits standardized ARPG statements joined by dots:
  "3–7 Damage", "Range 6", "+2 Armor", "Restores 50% Life", "+8 to Max
  HP", "+8% Damage", "+5% Dodge", "+20% Regeneration". Tooltip type line
  reads "Common · Ring" / "Rare · Main Hand".

### Free town portal + boss victory
- T (or the TOWN PORTAL button beside the hotbar) casts the portal for
  free on a 12 s cooldown (`TOWN_PORTAL` InputCommand); scrolls are gone
  from the starter kit and the merchant staples (the item still works).
- The Hollow King's final form: 7.8 s after the arena clears the victory
  overlay runs itself; a new RETURN TO TOWN button fades the run back to
  the camp with everything intact (`RunHandle.returnToTown`).

### Gore
- `render/Gore.ts`: persistent floor decals from the baked blood splats
  (five singles, random turn/size/tint, squashed to the ground plane,
  capped at 260 with the oldest recycled). Every kill drops a pool plus
  directional spray (bosses larger) and plays the splat strip; hits of 5+
  damage drip and flash the pixel blood-impact strip; 12+ crack bone.
- Boss death is 420 ticks: the death frames play over the first 40%,
  ember tint pulse throughout, flicker + alpha thinning over the back
  half while `Enemy.onBossDeathFrame` lifts ember trails off the body;
  the arena's stair reveal waits 7.6 s.
- Gore vol 1 audio copied to `audio/gore/` and mapped: `goreKill`
  (guts + bone crack) on every kill, `goreHit` (crack) on heavy hits.

### Asset audit (fourth upload, 13,454 files - preserved, indexed)
- KEEP -> baked: tavern (2 of 8 rotations), the well (new model),
  the ruin gate archway + three ruin wall blocks, isometric props
  (aged/spiral stairs, open/closed gates, archway, column, tables, bridge,
  stacked barrels, crates, wood pile, supports), five Retro Tree Pack
  pines/dead trees, blood splats (decals + strip), pixel blood impact,
  four warrior slash strips (`vfx_cut1/3/4/5`), Villager_01 walk/death
  (`folk_*`), the archer pack (`poacher_*`), the orc slinger pack
  (`orc_*`), inventory slot frames (`ui/slots`), Wenrexa armor/helmet
  icons for the armor items, Gore vol 1 WAVs.
- INDEXED, not used yet: `_iso` (a heraldic knight, 2,176 frames),
  Characters/Male (8 small townsfolk), Matthew's Dual Wielding (5,364
  weapon overlay frames for a paperdoll we do not have the body sheets
  for), the 20 `Effect_*` pixel packs, castle / dungeon-tiles PBR
  textures (3D materials), Building/Roof tile sheets, Isometric Geo Pack
  (low-poly), FREE ver UI kit, Darinia ornaments, the .blend/.fbx/.obj
  sources, Wizard normal maps. No music tracks were in the upload - the
  audio upgrade is the gore bank; town/dungeon beds stay as they were.

### Town (organic, 56×50)
- The map edge is a noise-carved blob (three sines + a bump toward the
  gate): outside = cliffs, a 2.6-tile belt of pines/dead trees with brush
  between, and a flood fill after carving turns any unreachable pocket
  into brush. Winding cobbled main street from the ruin gate up to the
  elliptical market square (four stalls, shopkeeper, the well, crates and
  barrels), an east–west high street, dirt lanes to five cottages, the
  tavern (5×4 with a stone stair and a table outside), the stash vault,
  the campsite clearing and the portal yard; torch posts along every
  street; two poacher guards flank the gate; villagers use the new
  Villager_01 walk. New mobs: Orc Slinger (floors 2–9) and Crypt Poacher
  (ranged, floors 4–14), with bestiary pages.

## 2026-09-02 (iteration 42) - Feet-true mob anchors + painted hitboxes, legendary tier + rings, starter gear, inventory redesign, bestiary, typography, depth scaling

### Enemy anchors and hit-testing (`entities/Enemy.ts`)
- FEET-TRUE ANCHOR: every atlas frame goes through `setFrame()`, which
  sets the body anchor from the manifest's painted bounds
  ((painted.bottom + 1) / origH, minus a 7% sliver for sheets with a baked
  shadow) — the lowest painted pixel sits on the tile, no matter how much
  padding a sheet carries. The hand-tuned `anchorY` is now only the
  fallback for anims without painted data.
- PAINTED HITBOX: `clickBox()` returns the painted region of the CURRENT
  strip (not the whole cell) — the click target hugs the visible torso,
  head included, and never reaches into empty cell padding. Verified live
  on floor-1 mobs: a canvas pointerdown on the torso centre and on the
  head both target the creature.
- DEPTH SCALING (audit): `levelHpScale(level) = 1 + 0.3·(level − 1)`
  (floor-1 mobs are their base; +30% of base per level after), damage
  +1/level (unchanged), and a new `armor` def field (+½ per level; Grave
  Guard 2, Crypt Sentinel 1) read through `Enemy.armor` by the damage
  formula. Phase transitions use the same scale.

### Items (`items/catalog.ts`)
- LEGENDARY rarity (gold) joins common / magic / rare; `rollRareItem`
  (boss trophies) rolls legendary one time in six. Kingsbane (16–28,
  +10% dmg) and the Crown of the Hollow (+5 armor, +15 life, +4% dodge).
- RING slot (`EquipmentSlot` + paperdoll order, no overlay): Copper Ring
  (+8 life), Ring of Embers (+8% dmg), Warden's Signet (+2 armor, +5%
  dodge), Seal of the Hollow King (legendary: +15% dmg, +20 life, +20%
  regen). Item `bonus` fields feed the same `Player.passiveBonus()` the
  passives use; max HP re-derives on equip / unequip.
- Starter kit: Apprentice Wand, Worn Katana, Cloth Robe; a new hero
  auto-equips the class weapon (rusty sword / short bow / apprentice wand
  / worn katana) and a chest piece (leather jerkin / cloth robe).

### Inventory (`ui/Inventory.ts`, index.html)
- Paperdoll as a body-shaped cross (HEAD / MAIN·BODY·OFF / RING·LEGS·BACK)
  with ghost glyphs in empty slots; a BELT row shows the Q / R quick
  draughts with counts; the backpack is a 5-wide grid of 52 px cells with
  hover lift and rarity halos.
- Crisp icons: generated pixel icons are drawn at 2× and shown at exactly
  40 px (integer scaling, `image-rendering: pixelated`), pack weapon icons
  at 2×, painted art contain-fit at 42 px; rarity borders gray / blue /
  yellow / gold (`--rar` custom property per rarity class) across the
  inventory, merchant, stash and cheat arsenal. A ring pixel icon joins
  the generator.

### Bestiary (`ui/Bestiary.ts`, hotkey B)
- Every creature kind listed; unseen kinds are silhouettes ("???"). A
  first sighting (visible on screen) and every kill update
  `Player.bestiary` (persisted in the save). The detail pane animates the
  south-facing idle strip straight from the atlas PNG as a CSS sprite,
  gives a lore snippet per kind, base stats (life with the projection at
  the hero's level, damage, armor, accuracy, speed, reach, wind-up, flee /
  slow / summon traits) and the scaling formula.

### Typography
- Body face swapped from IM Fell English to Crimson Pro (Google Fonts;
  Cinzel stays for headers); every HUD label, tooltip, panel and banner
  carries a dark halo (`text-shadow` block); floating damage numbers get a
  4 px stroke plus drop shadow.

### Draggable windows + cheat menu
- The bestiary joins the draggable set (inventory, merchant, stash, skill
  tree, character sheet, cheat menu). The cheat menu is wider (300 px),
  framed like the other panels, its power buttons no longer overflow, tabs
  wrap, and the arsenal list owns the remaining height with its own scroll.

## 2026-09-02 (iteration 41) - Skill tree + progression, cross-class synergy, animated spell VFX, draggable windows, E toggles, HUD cleanup

### Asset audit (`public/assets/test-models`, third upload: 884 PNG, 205 MB)
- KEEP -> 12 single-direction strips baked into `atlas/vfx_*.png` (union
  alpha crop, Lanczos, centred in square cells): `vfx_fireball` (the
  oriented comet, 15 f/96), `vfx_explosion` (fire_explosion every 3rd,
  25 f/96), `vfx_burst` (5 f/96), `vfx_firewall` (fire_wall every 3rd,
  24 f/80, loops), `vfx_ring` (FirePortal, 15 f/128), `vfx_vortex`
  (15 f/96), `vfx_splash` (WaterSplash, 8 f/96), `vfx_whirl` (Whirlpool,
  15 f/128), `vfx_slash` (WaterSlash, 10 f/96), `vfx_aura` (15 f/96),
  `vfx_orb` (fire Orb, 15 f/48), `vfx_strike` (fire_strike every 2nd,
  15 f/96). 1.36 MB total; every floor preloads them.
- REJECT: the `_high` 1000 px duplicates, the 30 FPS sheets (three times
  the frames for no visible gain at 60 Hz render), the pixel "explosion
  pack 1" (chunky 32-192 px style against the painterly game),
  Flamethrower / Kamehameha / lavafall / waterfall / fountain / torch /
  canalisation / circle and waterball sheets (nothing casts them), the
  GIF previews, PDFs, __MACOSX and .DS_Store junk. Folder deleted after QA.

### Progression (`systems/SkillTree.ts`, `entities/Player.ts`)
- Heroes start with basic attacks, ONE skill point, and an empty hotbar;
  every level grants one point (the cheat level jump grants the
  difference). `Player.skillPoints / unlockedSkills / loadout / passives`
  are hero state and persist (save v2; v1 slots migrate with one point
  per level).
- Four class paths x four tiers (level 1 / 3 / 5 / 7, each tier needs the
  previous one on that path) plus two passives per class (level 4 + one
  active of that class): Iron Hide +3 armor, Blood Rush +10% dmg,
  Wellspring +40% regen, Emberheart +12% dmg, Fleet Foot +8% speed, Keen
  Eye +12% dmg, Sleight +8% dodge, Second Wind +35% regen - read by the
  Player getters (`passiveBonus`).
- CROSS-CLASS: any path may be learned at double point cost.
- SYNERGY: a skill on the hero's own path casts at +30% power, 20% shorter
  cooldown, and every hit lays the class status - warrior STAGGER (18-tick
  hit stun), mage BURN (2 dmg / 20 ticks for 3 s), ranger HOBBLE (10-tick
  stun), rogue POISON (existing DoT). Delayed effects (zones, flurry cuts,
  the fireball's impact) carry the synergy they were cast with.
- Commands (determinism rule intact): `UNLOCK_SKILL`, `UNLOCK_PASSIVE`,
  `EQUIP_SKILL {slot, id|null}` applied by SkillSystem inside the tick;
  `skills:changed` re-renders the tree, the sheet and the hotbar.
  The first learned skill auto-fills the first empty slot.

### Skill tree window (`ui/SkillTree.ts`, K) + character sheet (`ui/CharacterSheet.ts`, C)
- Own path first and flagged; nodes read LEARNED / READY / LOCKED (with the
  reason: level, prerequisite, points), show cost, and learned actives
  carry a 1-2-3-4 picker; the footer hotbar accepts a selected skill or
  clears a slot. Empty hotbar slots show "+" and point at K.
- Character sheet: progress, vitals, offense (damage with every
  multiplier), defense, hotbar, passives, running buffs; refreshed each
  second while open.

### Spell VFX (`render/Vfx.ts`)
- `VfxSystem.play(anim, x, y, {fps, scale, tint, loop, lift, rotation,
  flat, overlay, depthBias})`: strips in the depth-sorted object layer
  (or the ambience overlay), additive, one-shots fade over their last
  third, loops run until stopped. `SkillDeps.vfx` is the only way in.
- FIREBALL is now a real projectile (`kind: 'fireball'`, animated comet
  head, ember trail) that detonates on the first foe or at the aim point
  through `ProjectileSpawn.onImpact` (area damage inside the tick) with
  the explosion strip + ground ring. Wand bolts fly the animated orb and
  burst on impact. Firewall cells loop the fire_wall strip; frost nova =
  splash + whirl ring; whirlwind = vortex; charge / rain / shadow slash
  = strike streaks; buffs = aura; flurry / slash = oriented cut arcs;
  trap detonation = explosion + ring; learning a skill rings the hero.

### Draggable windows (`ui/draggable.ts`)
- Any panel header with `.drag-handle` drags its window (pointer capture
  on the panel so re-rendered headers keep working; buttons in the header
  still click), clamped to the viewport, position remembered per window
  in `iso-arpg-ui-pos`. Wired: inventory, merchant, stash, skill tree,
  character sheet, cheat menu.

### E key symmetry + HUD cleanup
- E with the merchant / stash window open closes it; E beside the portal
  stone returns through it and E at the gate descends (no need to step in).
- Boss phase notes and the depth banner are top-anchored under the boss
  bar (`#boss-note` 96 px, `#descend-note` 60 px, sub-line 98 px).
- Overhead enemy HP bars are slimmer (26x4) and, with the level plaque and
  floating damage numbers, scale by 1/zoom (clamped) so a deep zoom never
  fills the view with bars and text (`Enemy.hudScale`, `DamageText.setZoom`).

### Studio QA pass (second session, fresh ranger)
- XP path: 14 kills on floor 1 -> level 2 -> +1 point; empty hotbar slots
  advertise the point count and K.
- Drag: inventory, skill tree, character sheet, cheat menu each moved by
  their header and stayed in bounds; the sheet reopened at its dropped
  spot; positions stored under `iso-arpg-ui-pos`.
- E: opens a chest beside the hero; at the portal stone returns to the
  remembered floor; at the gate descends.
- Level 30 via cheat -> 30 points: all 16 actives learned through the tree
  (own path 1 pt, others 2 pts) + Fleet Foot / Keen Eye; points end at 0
  and the remaining passives report LOCKED - 2 POINTS. Passives applied:
  speed 1.21, damage x1.12. Every skill cast from the hotbar started its
  cooldown and drew its strip (rain waves keep adding streaks over time).
- Boss arena: bar top-anchored at 44 px above an open window, note slot at
  96 px; hp bar 26x4 at zoom 1.
- Fixes from the pass: the firewall strip is now masked with an elliptical
  falloff (the source sheet was a square tile), trap placement flares a
  ring. Background-tab note for future QA: never `await setTimeout` in a
  long test script - hidden tabs throttle timers to 1 Hz and the script
  keeps running after the CDP call times out.

### Live QA (Chrome, stepped sim)
Fresh mage -> K: only Fireball READY, all else LOCKED with reasons ->
learn (1 pt -> 0, auto slot 1, synergy frame) -> drag the tree 161x44 px,
off-screen drag clamped, position stored -> level 7 (6 pts) -> Whirlwind
cross-class 2 pts + Firewall 1 pt -> 3 left; Whirlwind moved to slot 4 ->
E at the stall opens, E again closes -> fireball in town: comet + ring,
cooldown 148 (200 x 0.8 synergy) -> floor 1: fireball on a foe, burn ticks
after impact -> zoom 2.2: bars/numbers hold size -> zero console errors.

## 2026-09-02 (iteration 40) - Town redesign, market square, camp heroes, buyback, skill art, level cheat

### Asset re-audit (`public/assets/test-models`, second upload: 499 files, 44 MB)
- KEEP -> baked to `public/assets/ui/` (DOM-only art; the atlas stays for
  world sprites): 16 of the 220 elemental 16 px glyphs as `skills/<id>.png`
  (x4 nearest, one per active skill), and 16 of the 62 painted 1024 px
  "Ultimate Fantasy RPG Icons" (CC0) as `items/<id>.png` (alpha-cropped,
  60 px inside 64, Lanczos): potions (red / blue / green / purple), the
  portal scroll, wooden + iron shields, bows, the ember staff, swords,
  axes, a chest.
- REJECT: the pixel "Free Medieval Fantasy UI Pack" (word buttons and 32 px
  frames in a chunky pixel style that fights the Cinzel / parchment UI;
  its icon sheets are duplicates of the singles), the pack's promo card,
  the remaining 204 glyphs and 46 icons (no matching skill / item yet -
  re-bake from the pack when one is added). No NPC sprites, houses,
  stalls or trees were in this upload; the town uses the it.39 bake.
- The raw folder was deleted after the bake; `scripts/purge-assets.mjs`
  now keeps `ui/` alongside `atlas/`.

### Town redesign (`town/TownMap.ts`, 46x40)
- A cliff ring (the map's only walls, tinted mossy rock by SceneManager)
  behind a two-deep staggered FOREST BELT; every belt tile that is not a
  tree is undergrowth (blocked) so the edge never traps anyone.
- MARKET SQUARE (N): 16x10 cobbled plaza, four canopied stalls, the
  shopkeeper behind stall A, crates / barrels / pots / hanging signs /
  signpost, torch posts at the corners; six villagers wander it.
- Streets: the cobbled main street south to the gate, an east-west high
  street, dirt lanes to every cottage, the vault and the camp.
- Two RESIDENTIAL quarters (3 cottages each) with fenced yards; the
  fence rows leave the door column open. Each cottage keeps its room
  and doorstep walkable: step in and the roof + front wall drop to 20%
  (behind stays 38%).
- STASH VAULT (NW), CAMPSITE (SW: fire, seats, the three resting heroes,
  the portal stone east of the street), the ugly animated well removed.
- DUNGEON GATE (S): a stone archway drawn in Pixi Graphics across the
  main street (piers on the two blocked tiles, voussoir ring, keystone,
  translucent throat so the hero fades into the dark), two BRAZIERS
  (pillar + scaled campfire flame + warm light), cold blue light and five
  drifting fog sprites (`TownDressing.update`). The stairwell sits under
  the arch; walking in descends.
- COLLISION AUDIT: `auditTownLayout()` flood-fills from the spawn and
  warns about any unreachable walkable tile or unreachable point of
  interest (gate, stash, stall, portal, fire, every door). Found and fixed
  in QA: two north cottages fenced shut; 80 forest pockets (now brush).

### Camp heroes (`town/CampHeroes.ts`)
- The three classes NOT chosen rest around the fire as real `Player` rigs
  (same atlases, HERO_HEIGHT scale, idle breathing) that are RENDER-ONLY:
  never in GameState, never ticked, never targetable. They face the fire
  and take the scene tint. The camp chip names them.

### Merchant fix + buyback (`systems/Town.ts`, `ui/Shop.ts`)
- Selling now moves the item to a BUYBACK counter (newest first, 8 deep,
  cleared on every restock) shown under FOR SALE; `BUYBACK` is a new
  InputCommand priced at exactly what the merchant paid. Gold math
  verified live: 300 -> sell sword +19 -> 319 -> buy back -19 -> 300.
- The Violet Elixir (+35% hp, +50% resource, 65 g) joins the staples.

### Skill art + cast FX
- `SkillDef.icon` -> `<img class="skill-icon">` in the slot (rune glyph
  is the fallback); slots wear iron plate + gold hairline + corner rivets;
  when a cooldown starts from zero the slot pops (`.cast`: scale 1.12 +
  radial gold bloom, 0.45 s).
- `ui/itemIcons.itemIconHtml()` is the one resolver for every panel
  (inventory, shop, stash, cheat arsenal): painted `art` > pack `icon` >
  generated pixel icon.

### UI overhaul (index.html, appended block)
- Double frames (iron outside, gold hairline inside) on every panel and
  tooltip, parchment ink (#eadfc8) on near-black, gold price text, gear
  cells rimmed gold, dashed rows for buyback, `button:active` at 0.72.

### Cheat menu HERO tab
- LEVEL 1-30 grid plus -5 / -1 / +1 / +5 steps -> `Player.setLevel()`
  (max HP = class base + 4/level, HP refilled, XP zeroed), sheet readout
  (xp, hp, base damage), level-up sting + burst.

### Live QA (Chrome, stepped sim)
Fresh save -> town spawn (audit clean, no console errors) -> stepped into
the west cottage: roof alpha 0.20 -> stall: sell Rusty Sword (+19),
buyback (-19), painted icons in every row -> skill 1: `.cast` flash,
cooldown 298 -> F1 HERO: level 10 (186 hp), +5 -> 15 (206 hp) -> gate
approach and arch inspected in screenshots. Camp shows Mage, Ranger,
Rogue for a Warrior run.

## 2026-09-02 (iteration 39) - Town hub (floor 0), vendors, save/load, stash, town assets

### New assets (baked from `public/assets/test-models`, then pruned)
- Audit verdict: KEEP the cottage renders (`house/rem_0002/0006/0010/0014`),
  the Ancient Isometric Tileset (ground diamonds, stalls, fence, pillar,
  trees, crates, signs, grass), Dungeon Pry placeables (barrels, chest
  open/closed), the campfire + torch sheets, the animated well, and the
  coc_chars peasant / peasantGold walk sheets. REJECT: the hob sheets (a
  goblin, not townsfolk), PSD/PNG junk exports, re-uploads of packs that
  were already atlased in it.36, and the "Alpha" edge-mask sheets (faint
  masks that only speckle a bake).
- Baked into `atlas/` by the one-shot `src/dev/TownBaker.ts`
  (`await __bakeTown()` in the browser; kept in this commit's history,
  deleted afterwards): singles `town_cobble/grass/dirt` (64x32),
  `house_a..d` (276x253 @0.28), `stall_a..d`, `fence`, `pillar`,
  `barrel_a/b`, `crates`, `stash_closed/open`, `tree_a/b`, `signpost`,
  `hanging_sign`, `grassclump`, `pots`; anims `campfire` (6 f), `torch`
  (4 f), `well` (12 f), `villager_walk` + `merchant_walk` (8 dirs x 8 f,
  96 px cells, nearest).
- Direction audit of the peasant sheets: rows run counter-clockwise from
  SW ([SW, S, SE, E, NE, N, NW, W]) -> `ROTATE_SW` row fix
  (`(d + 3) mod 8`) registered for `villager_` / `merchant_` in
  `SpriteLibrary.DIR_ROW_FIX`. Villager body height 62/57 painted
  (~44-52 px on screen; the union bounds overstate the 40 px walking body).
- The raw `test-models` folder (929 MB) was deleted after the bake.

### Floor 0 - the town (`src/town/`)
- `TownMap.buildTownLayout()`: hand-authored 34x30 square - walled
  border, cobble plaza, dirt lanes, four corner cottages (3x3
  footprints), merchant stall + shopkeeper NE, stash chest + barrels NW,
  central campfire, well, six torches, gate pillars, fences, trees,
  decals. The map is a `DungeonMap` subclass with a per-tile `tileKind`
  (cobble/grass/dirt) so the scene builder, pathfinder, lighting and
  minimap work untouched; theme `'town'` maps to `floor_town_<kind>`.
- `TownProps.placeTownProps()`: dresses the layout; standing props anchor
  at the footprint's south corner with `depthKey(x+w-.5, y+h-.5)`; the
  campfire (9 fps), torches (8 fps) and well (6 fps) loop through
  `Ambience.addLoopingAnim`; the fire and torches are `Lighting` sources
  + ember hotspots. Returns OCCLUDERS (cottages, trees) and INTERACTABLES
  (merchant, stash).
- `Villagers`: render-only townsfolk (never sim entities) that stroll a
  wander room with hysteresis facing (`stableDir`), pause, breathe; the
  shopkeeper stands behind the stall. Lit by `getTintAt(x, y, 0.8)`.
- ROOF CUTAWAY: each frame an occluder the hero stands behind (screen
  point inside the sprite's inner 76% x 90% box and hero depth < prop
  depth) lerps to alpha 0.38 (k = 1 - e^(-12 dt)), back to 1 otherwise.
- Lighting builds with `{ sightRadius: 40, fullRadius: 14 }` in town;
  music state `'town'` (the title theme, Tristram rule); gate = the
  regular stairs prop placed at `layout.gate` -> descend to floor 1.
  `updateDepth` shows THE TOWN; the first descent reads "The gate seals
  behind you".

### Economy, consumables, stash (`systems/Town.ts`, `ui/Shop.ts`, `ui/Stash.ts`)
- Items gained `value`, `use` (heal / resource / portal) and the
  `'consumable'` slot; `health_potion` (30 g, +50% hp), `mana_potion`
  (30 g, +60% resource), `scroll_town_portal` (80 g). Q / R quaff the
  first health / mana potion; clicking a consumable in the inventory uses
  it. `CombatSystem.heal()` is the second (and only other) hp mutator.
- `TownSystem`: merchant stock restocked per visit from the run seed +
  deepest floor (staples: 3 health, 2 mana, 2 scrolls; 3 gear rolls; a
  magic/rare piece past floor 3/6); buy = `itemValue`, sell = 25%.
  Commands BUY / SELL / STASH_PUT / STASH_TAKE / STASH_GOLD flow through
  the InputQueue like everything else (determinism rule intact); events
  `town:changed / traded / refused`.
- Shop and Stash panels (`.town-panel`): FOR SALE <-> YOUR PACK, gold
  purse, deposit/withdraw 100/all, shared `#item-tip` hover tooltip with
  the gold line, ESC closes (capture), click sfx. Stash = 24 slots + gold,
  owned by the SAVE SLOT (restart / change class keep it).
- Interaction: E near the stall / chest opens it (`PICKUP_NEAREST` in
  town); clicking the stall / chest walks up (`pendingInteract`) and
  opens on arrival; non-blocking chips: E TRADE / E STASH / THE DUNGEON
  GATE / PORTAL back to depth N.

### Town portal + floor memory
- Reading a scroll (outside town, not while transitioning) sets
  `pendingPortal`; the tick fades to a freshly built town, warps the hero
  to the portal stone, drops a blue rift (glow + ring + light source) and
  remembers `{floor, arena, x, y}`. Stepping off the stone arms it; stepping
  back fades to the remembered floor and spot.
- `FloorMemory` per floor key (`floor`, arena = `1000 + floor`): opened
  chest indexes, taken gold pile indexes, killed roster indexes, packed
  explored bits (base64), `arenaCleared`. `captureFloor()` runs before
  every departure (descend, arena, portal, cheat travel, save);
  `buildWorld` re-applies it: `chests.applyMemory`, taken piles destroyed,
  `spawnFloorEnemies(..., skip)` rolls the identical roster (the RNG
  stream is consumed for skipped entries) and tags `Enemy.spawnIndex`,
  `lighting.unpackExplored`; a cleared arena rebuilds empty with the
  stair open.
- Double-descend guard: `swapWorld` clears `pendingDescend` /
  `pendingArena` so a stale "on the stairs" flag from the old floor can
  never fire on the new one (found in stepped QA).

### Save / load (`persist/SaveGame.ts`, `ui/SavePanel.ts`)
- 3 LocalStorage slots (`iso-arpg-save-<n>`, version 1, ~0.8 KB each):
  seed, floor, deepest floor, playtime ticks, the sheet (archetype,
  level, xp, gold, hp/hpMax, resource, backpack, equipped), the stash,
  the floor memories. `saves.read/write/remove/list/firstFree/latest`.
- Autosave on arriving in town (spawn, portal, cheat), on opening the
  pause menu, and SAVE & EXIT; "PROGRESS SAVED" floats over the hero.
- Main menu: CONTINUE (latest slot, shown only when one exists), START
  GAME (class select -> first free slot; all full -> OVERWRITE picker),
  LOAD GAME (slot list with LOAD / DELETE). Loading restores the hero and
  starts in town; the gate leads back down, remembered floors intact.
- `?class=` test entry still drops straight onto floor 1.

### UI polish
- Panels share the classic ARPG frame (double gold rule, dark violet ground),
  `:active` opacity 0.75 on every button, high-contrast serif labels,
  hover tooltips with gold values on shop / stash / inventory cells,
  Q - R row in the command reference, SAVE & EXIT in the pause menu.

### Live QA (Chrome, stepped sim)
Start -> town spawn (autosave) -> E at the stall: buy Healing Potion
(500 -> 470 g), sell Rusty Sword (+19 g) -> E at the chest: potion + scroll
stashed, 100 g deposited, taken back -> gate -> floor 1 (roster 11 + kill
one, `killed = {10}`) -> scroll -> town (portal chip, floors memory `{1}`)
-> back through the rift -> floor 1 rebuilt with index 10 dead ->
SAVE & EXIT (panels torn down, no run left) -> CONTINUE -> town with 777 g,
pack, floor memory -> gate -> floor 1 still remembers. Roof cutaway 0.38
behind the NW cottage. Zero console errors; the Pixi addChild deprecation
(shadow root was a Sprite) fixed.

## 2026-09-02 (iteration 38) - Chest chip leak, menu streamlining, aim/firewall alignment

- STUCK "E OPEN": the interact chip set an INLINE opacity (0.25) during
  combat and only removed the `show` class when hiding, so a faint chip
  floated forever near the player after a chest was opened. Now a `dim`
  class carries the combat fade, the chip is cleared on `chest:opened`
  and on every floor swap. All floating text already auto-fades
  (damage numbers 0.85 s, crits 1.1 s, banners 2.6 s).
- Main menu = START GAME / SETTINGS / CREDITS. START opens the character
  selection (select card -> CONFIRM -> floor 1); the delver button is gone.
- Skills: `SkillDeps.aimPoint()` (cursor world point) + `aimTarget()` -
  aimed ground skills (Fireball, Firewall, Rain of Arrows) land on the
  foe in the aim cone, else EXACTLY on the cursor (range-clamped), never a
  fixed distance ahead. Firewall is laid across a SCREEN-perpendicular of
  the aim (world-space perpendiculars skew under the 2:1 projection),
  centered on the target, 1.15-tile cell spacing.
- Live QA: menu -> select -> confirm -> floor 1; chest E-open (chip hidden,
  no inline opacity, 2 drops); firewall perpendicular on screen (90.0 deg)
  and centered on the foe (0.00 tiles); fireball 7 dmg, frost nova 4 dmg +
  freeze. Zero console errors.

## 2026-09-02 (iteration 37) — Stability: transition freeze, direction
## remaps, slow idles, select→confirm flow, gold visibility, impact FX

### Level-transition freeze (root cause + fix)
- CAUSE: `buildWorld` awaited the atlas fetch AFTER `destroyWorld(old)`.
  With rAF live, the game loop kept ticking a destroyed world during that
  async gap → Pixi threw inside `update()` → the rAF chain died silently
  (the it.36 hidden-tab QA never saw it because rAF was paused there).
- FIX: `preloadFloor()` streams atlases while the old floor still runs;
  `buildWorld` is synchronous; `swapWorld()` builds the NEXT floor first,
  then destroys the old one (`destroyWorld` only detaches the hero if it
  still owns them). A build error keeps the player on the current floor.
- Error boundaries: the loop's update/render are wrapped (first 5 errors
  logged, loop survives); atlas preload failures fall back to procedural
  markers; a 20 s watchdog releases a stuck fade.
- Verified: stepping the loop while a preload is pending leaves the old
  floor intact (no errors); real stair descent 16→17; arena travel.

### Direction audit (ground truth, every unit)
- Rendered all 8 rows of every idle/walk atlas to a labeled grid and read
  them against the knight reference (E = right profile, N = back, W =
  left profile, S = face). Big pack (skeletons, shaman, ghast, wardens,
  Hollow King forms, mage, rogue) and the knight: correct.
- MIRRORED (E/W swapped): ranger, zombie, halberdier, werewolf, lizardman
  → `rowForDir = (4 - d) mod 8`. REFLECTED across NW–SE (E showed the face,
  W the back, S the right profile): hydra, naga, villager → `(6 - d) mod 8`.
  Fix lives in `SpriteLibrary.rowForDir` (applied at slice time); the
  post-fix grid shows all 64 cells of the 8 packs facing correctly.

### Idle pacing
- 4-frame big-pack idles (mage, rogue, skeletons): ping-pong at 2.2 fps
  (≈2.7 s breath, was 3.6 fps); long idles 5–7 fps.

### Menu flow
- START (DESCEND) always opens the character selection; a card click
  SELECTS (gold highlight), CONFIRM / Enter starts, BACK / ESC returns.
  The remembered delver comes pre-selected.
- Pause menu and death overlay gained CHANGE CLASS (tears the run down,
  reopens selection — no refresh). Credits rewritten: developer, engine
  (Pixi.js 8 · TypeScript · Vite), art, icons/type, SFX, music.

### Loot & gold
- Ground icons compact: pack icons 1.0× (≤33 px), pixel icons 0.7× (28 px);
  pick box adjusted.
- Gold piles: TREASURE mode — saturated gold tint floor with a slow
  shimmer (never sinks into the shadow ramp), stronger pulsing glow
  (alpha 1.0 × 1.35), twinkle sparks every ~0.4 s.

### Combat FX
- `Ambience.impactFlash` (additive bloom at the victim) + `slashArc`
  (crescent flashed at the victim along the blow axis, melee only) on
  every landed player hit, on top of the it.36 sparks/blood/trails.

### QA
- Menu → select → confirm → floor 1 → stairs 16→17 → cheat/arena travel
  → change class from pause and death → restart → credits. Zero console
  errors, no loop-boundary reports, no 404s.

## 2026-09-02 (iteration 36) — Studio overhaul: atlas purge, main menu, run
## lifecycle, unit scale standard, UI visibility, audio map, VFX

### Asset audit → bake → purge (the load-time fix)
- Baseline: boot fetched ~6,000 raw frame files (2.5 GB store on disk,
  330,558 files); the loading screen cleared at **~50 s** in dev.
- Every animation the game renders was baked FROM THE RUNNING GAME into
  grid atlases (`src/dev/AtlasBaker.ts` + a dev-only `/__bake` Vite
  endpoint, commit 07c386cd): renderer-extracted textures (rebakes,
  paperdoll composites, the tone-baked stairwell all preserved), alpha-
  cropped per anim with Pixi `trim/orig` keeping every anchor valid, and
  the ≤0.42-scale packs (zombie/hydra/wolf/lizard/guard/shambler) baked at
  half resolution. 89 anims + 19 singles, 49 MB. Denser frame picks for the
  packs that had the frames on disk (zombie 12/16/16/12, ranger 12/12/16/8/15,
  naga/guard/hydra/shambler/wolf/lizard likewise).
- `SpriteLibrary` rewritten as an atlas registry with `ensure()` lazy
  loading; `manifest.json` carries painted bounds per anim.
- PURGE: `scripts/purge-assets.mjs` moved 217 entries / 2,921 MB out
  (all raw sprite packs, the unused Foozle/Copings/Temple/Large-Wall/vfx/
  effects packs, dummy `tiles/sprites/paperdoll/ui` folders, the 0-byte
  voice-actor stubs, every unmapped TomMusic/Horror file, the unused
  dark-magic-4 track and stray wav). `public/assets` is now 96 MB / 235
  files: `atlas/` + the mapped audio + README. `.gitignore` whitelist and
  the PAGES publicDir hack retired (public/ copies normally).
- RESULT (production build, `vite preview`): DOMContentLoaded 0.2 s, menu
  shown at **0.81 s** with **206 KB** transferred (9 requests); a run
  starts ~1.0 s after PLAY (hero rig + floor-1 roster); later floors
  stream under the fade in 20–700 ms and the next floor prefetches.

### Main menu, character re-selection, restart flow
- `main.ts` split into BOOT (once) and `startRun()` → `RunHandle.destroy()`:
  every EventBus subscription, timer (`later()`), UI panel, DOM listener
  (AbortController), world, player and `state` are torn down; HUD resets.
  RESTART RUN / RETURN TO MAIN MENU / a different hero never reload the tab.
- Title screen (`ui/MainMenu.ts`, ember canvas): DESCEND (remembers the
  last delver in localStorage) · CHOOSE YOUR DELVER (cancellable class
  select with BACK/ESC) · SETTINGS & CONTROLS (settings panel now carries
  the full control table + CLOSE) · CREDITS.
- `ui/RunMenus.ts`: ESC pause (loop stopped, music ducked; RESUME / SETTINGS
  / RESTART / MAIN MENU) and the DEATH overlay after the death animation
  (RISE AGAIN at the entrance / RESTART / MAIN MENU). Epilogue gained MAIN
  MENU; DELVE AGAIN restarts in place.
- Verified: pause→resume, death→rise, restart (1.9 s), exit→menu leaves 0
  panels / 0 skill slots / `__game` null, warrior→mage→ranger→rogue swaps.

### Idle repair + unit height standard
- `render/animUtil.idleFrame`: time-based; 4-frame big-pack idles (mage,
  rogue, every skeleton) PING-PONG at 3.6 fps — no more snap from the last
  frame to the first; long idles loop at 6–8 fps. Player idle clock is a
  render wall-clock (was per-render-frame, so frame-rate dependent).
- Scale is DATA now: `HERO_HEIGHT = MOB_HEIGHT = 56`, `BOSS_HEIGHT = 128`
  (× `heightMult` flavor) over the manifest's painted idle height. Measured
  in-game: warrior/mage/ranger/rogue all 56 px (mage/rogue were 43, knight
  56 before); skeleton 56, fallen 48, zombie 60, hydra 70; Tomb/Frost
  Wardens and all three Hollow King forms 128; Ember Maw 102.
- Walk `stride` is now CYCLES per tile (frame-count independent).

### UI visibility pass
- Inventory/cheat slot tiles lit (radial highlight + 2 px border), rarity
  glows (magic blue / rare gold box-shadows), icon drop-shadows, dashed
  empty slots; `ui/itemIcons.ts` redrawn as 20×20 shaded pixel icons
  (bow, wand, helm, shield, mail, greaves, cloak) from a 5-step ramp of the
  item color with metal/wood/gold accents.
- Hint banner slightly transparent; tooltip opaque; all overlays remain
  `pointer-events: none` except real buttons.

### Audio + procedural VFX
- `AudioManager` music state machine (`setMusic`: menu / dungeon / boss /
  victory, 1.4 s element crossfades, ambience only with the dungeon bed,
  `duck()` for modals). Title theme = "Whispers of the Abyss", epilogue =
  "Cursed Citadel". Combat/horror banks decode when a run starts (`preloadRunBanks`),
  not on the title screen. New SFX: uiHover/uiClick/uiConfirm/uiBack, pause/
  unpause, inventory book open/close, map open/close, hero select, rare
  pickup (gem), gold gather takes, equip clack, level-up heart.
- `Ambience.sparks()` (additive impact flecks on every landed blow, bolt
  impacts, gold) and `Ambience.trail()` (ember smear behind bolts, dust
  behind arrows, emitted from `Projectiles.updateRender`). Dynamic floor
  shadows: `Lighting.lightDirAt` + `setShadowLight` stretch each unit's
  grounded ellipse away from the dominant light.

### QA (hidden-tab automation; `__game.travel` dev hook = timer-free floors)
- Warrior/mage/ranger/rogue runs; floors 1–20 all spawn fully-sprited
  rosters (no marker fallbacks); arenas 5/10/15/20: Tomb Warden kill → stair
  reveal → descent to 6; Frost + Ember arenas build with boss music per
  floor; Hollow King all three phases (summons at P2) → arena clear → stair
  → THE CRYPT IS CONQUERED with victory music → MAIN MENU → new run.
- Zero console errors/warnings across the whole pass; no 404s after the purge.
- Hidden-tab caveat: Chrome throttles timers to ~1/min after 5 min hidden,
  which is why the dev hook bypasses the fade timers for automation.

## 2026-09-01 (iteration 35) — Full troubleshooting session (no code changes)

End-to-end real-play QA on a fresh seed (1234): class select by real card
click → click-to-move (2.2 tiles) → click-on-enemy hitbox → auto-approach
→ kill (+8 xp, level-up to 2 mid-boss-fight) → gold pickup (+22) → chest
E-open + E-loot + equip → stairs descent 4→5 → arena threshold teleport →
REAL Tomb Warden fight (gravecleaver + Whirlwind, held-Space swings) →
seal correctly HELD with one fleeing archer alive (touching the hidden
stair did nothing) → click-chase killed the kiter → clear → reveal →
descent to 6 → UI toggles (I/L/O/M) → cheat TRAVEL to Arena XX → phase-1
pool burst → knight form P2 with fresh full pool. Zero console errors.

Two apparent failures were test artifacts, both correct behavior:
(1) clicking an enemy behind a wall does nothing — fog gates targeting
(and a debug warp had put the player INSIDE a wall); (2) held-button
attacks don't pursue a kiting archer — click-to-attack is the pursuit
command by design.

## 2026-09-01 (iteration 34) — Ranger vector remap, hero scale normalization,
## idle pacing, dynamic portraits

### Ranger 8-dir GROUND-TRUTH remap
- Rendered every stored ranger_run row to a labeled on-screen grid and
  read the true facings: the it.23 half-turn list was still 90° off
  (slot E showed S, N showed E, S showed W — consistent (d+6)%8 error).
- R_ANGLES fixed at the SOURCE to ['270','315','000','045','090','135',
  '180','225'] — hero AND archer mob corrected together. Re-rendered the
  grid post-fix: all 8 canonical dirs now face their movement vectors.

### Hero scale normalization (measured painted heights)
- Alpha-scanned idle frames: knight 58u@0.92≈53u (baseline; big-pack mobs
  ≈55u; bosses 128–134u = 2.4–2.5× — preserved). Mage was 111u@1.1≈122u
  and rogue 112u@1.1≈123u (the "too tall" bug), ranger 167u@0.42≈70u.
- New rig scales: mage 0.48, rogue 0.48, ranger 0.32 → every hero ≈53u,
  verified on-screen beside skeleton mobs.

### Idle jitter fix
- Sheet-hero idle clock 0.12→0.05/render (~3 fps): the 4 unevenly-sampled
  big-pack idle frames now read as slow breathing; stepping is monotone
  0→N with modulo wrap (frame() already wraps — no clamp/bounce).

### Dynamic hero portraits
- Cheat menu portrait = classPreviewFrames(archetype) (alpha-cropped,
  animated); CheatMenu draw simplified to contain-fit.
- Inventory paperdoll body = the chosen class's idle anim at per-class
  PORTRAIT_SCALE (≈78px painted for all four); armor tint warrior-only.
- Skill-bar always-on name plaques hidden (they overlapped; tooltips
  carry the names).

### Audit: ranger dir grid pre/post, all four in-game heights vs mobs,
### mage/rogue idle pacing, ranger+rogue portraits in both menus.
### Zero console errors.

## 2026-09-01 (iteration 33) — Select previews, distinct rogue, aim casting,
## dash lock, trap object, tooltips, cheat travel

### Character select
- LIVE ANIMATED previews per card: S-facing idle frames extracted, ALPHA-
  CROPPED to painted bounds and drawn at one fixed height — automatic
  scale unification across all four heroes on the select screen.
- ROGUE REPLACED (user: too close to the warrior): hero1 dropped for a
  big-pack paperdoll composite — BaseHumanMale + DrkPant + DrkStudLeth +
  DrkBoot + DrkHood + Dagger + LeftKuhkri: a hooded DUAL-WIELD shadow.
  compositeCamAnim generalized to take a layer list.
- In-game scale parity: mage/rogue 1.1 (148px composites) ≈ knight 0.92.

### Ranger direction audit
- Frame-by-frame walk tests (A/W/D): facings CORRECT in this build — the
  it.32 3x-scale bug made directions unreadable; scale fix resolved it.
- Real fix shipped: untargeted swings/shots now aim at the MOUSE CURSOR
  (Combat.aimDir, wired in buildWorld) — the draw no longer plays toward
  stale facing when firing at air.

### Skills
- Rich hover tooltips on the action bar (name · cost · cooldown · effect;
  .skill-slot pointer-events restored for hover only).
- TARGETED CASTING: SkillDeps.aim() (cursor world vector); takeAim() turns
  the hero and drives charge/firewall/shadowstep/shadowslash/multishot and
  the fireball/rain target cones.
- EXPLOSIVE TRAP: visible gold rune + glow (zoneVisual dep) that detonates
  with ring bursts + glint and cleanly despawns; firewall cells now carry
  persistent flame glows; rain shows a target sigil. Zones own dispose().
- Cleave widened: reach +0.4, arc 55°→70° per side — verified one swing
  hitting a 3-enemy cluster.
- FX pass: double steel rings (whirlwind), double nova ring, impact ring
  on fireball, shadow puffs on vanish/shadowstep.

### Dash wall-collision lock
- dash() now steps 0.1 with corner-aware canStandAt and snaps to tile
  center if ever embedded — verified 6 consecutive dashes INTO a wall all
  ending on legal ground.

### Chest label & cheat menu
- #interact-hint dims to 0.25 opacity while anything is chasing (already
  pointer-events: none).
- Cheat menu: TRAVEL tab (20 floor buttons + 4 arena buttons, closes over
  the fade; verified instant jump into the Ember Maw's arena), smooth
  scrolling; arsenal already lists the full ITEMS catalog.

### Zero console errors across every pass.

## 2026-09-01 (iteration 32) — 4 playable classes, skill system, asset audit

### Asset audit (public/assets deep-scan)
- NEW packs parsed: "Frames_320x320 hero1" (leather swordsman, 21 anims —
  the ROGUE hero, half-turn angle rotation like the lizard pack);
  512x512 (three-headed CRIMSON HYDRA, naga-style 0-based angle folders,
  16 angles); x256_Spritesheets (RISEN VILLAGER shambler, 16 grid sheets
  per anim, zero empty cells audited). effects/ + vfx/ noted for future.
- MAGE hero is a big-pack PAPERDOLL COMPOSITE: BaseHumanMale + RobesMage1
  + MageHood2 + MageStaff1 stacked per cam/frame and baked at load
  (compositeCamAnim). Layer health size-audited (tiny hood/staff frames
  are legit accessories, not blanks).
- CALIBRATION TRUTH (finally measured): rebake helpers KEEP original
  texture dims — def/rig scales multiply RAW frame size. Reference table:
  archer 320@0.36, wolf 320@0.42, big pack 148@0.62. New: shambler
  256@0.4, hydra 512@0.36, ranger hero 320@0.42, mage 148@1.1.

### 4 playable classes (Player refactor)
- CLASS_RIGS per archetype (idle/run/attacks[]/hit/death + scale/anchor/
  shadow): warrior=HD knight (unchanged), mage=composite, ranger=bow pack,
  rogue=hero1 (3 cycled attack anims). enableKnightRig picks by class with
  knight fallback; syncKnight generalized to per-anim frameCounts.
- ARCHETYPES extended: armorBase, critBonus, attackSpeedMult (rogue 0.75),
  dodgeChance (rogue 0.12/ranger 0.05, rolled in enemyStrike), resource
  pool (mage MANA 120 else STAMINA) + per-tick regen, class default
  weapon (mage wand/ranger bow/rogue katana) + base damage.
- Class select overlay (#class-select) before the run; `?class=` bypass.

### Active skills (src/systems/Skills.ts): 16 skills, hotkeys 1–4
- SKILL InputCommand + Digit1–4 bindings; per-slot cooldowns; resource
  costs; HUD action bar (#skill-bar: glyph, key, cost, cooldown sweep +
  seconds, insufficient-resource graying) + resource bar by the orb.
- Warrior: Whirlwind (r2.2 AoE 1.4x) · Charge (4-tile dash, path damage
  + knockback) · War Cry (+35% dmg 10 s) · Stone Skin (55% DR 7 s).
- Mage: Fireball (r1.8 burst at nearest foe) · Firewall (5-cell line DoT
  6 s) · Frost Nova (freeze r3, bosses immune) · Arcane Intellect (+45%).
- Ranger: Multishot (5-arrow fan) · Shadow Step (dash + haste) ·
  Explosive Trap (armed mine, r1.9 detonation) · Rain of Arrows (5 waves).
- Rogue: Blade Flurry (4 staged cuts) · Poison Blade (hits envenom, DoT
  via combat:swing hook) · Vanish (untouchable+unseen 5 s; enemies lose
  LOS via EnemyAIDeps.isPlayerHidden) · Shadow Slash (dash-through 1.8x).
- All rolls go through the floor's seeded combat rng (Combat.rng getter);
  dealDamage gained damageMult (source=player) + damageReduction hooks.
  New sfx cases (skillWhirl/Dash/Shout/Buff/Fire/Arrows/Trap/TrapSet/
  Poison/Vanish) from the TomMusic + Horror banks.

### Verified live: all 16 skills fired with costs/cooldowns/FX per class;
### rogue flurry staged 4 cuts; mage soak (fireball 77 crit, firewall
### kills, nova freeze); ranger 5 arrows in flight + trap/rain kill;
### warrior whirl/charge/buffs; class-select screen + card start; shambler
### (d7) + hydra (d16) in rosters, sized and facing right; F20 3-phase
### boss regression intact. Zero console errors on all passes.

## 2026-09-01 (iteration 31) — GitHub private repo + Pages deployment

### Asset curation (the blocker)
- Raw public/ is ~2.5 GB / 303,517 files; one 142 MB WAV exceeds GitHub's
  hard 100 MB limit — a raw push is impossible. `.gitignore` whitelists
  EXACTLY what the game loads (mirrors SpriteLibrary/AudioManager, down to
  zombie `picks()` frame numbers): 15,334 files ≈ 347 MB, none >90 MB.
  Untracked on purpose: paperdoll layers, BMP twins, macOS `._*` stubs,
  empty voice-pack folders, unused ambient WAVs, `se_ku…wav`.

### Pages plumbing
- vite.config: `PAGES=1` → base `/isometric-game/` + `publicDir: false`
  (never copy 2.5 GB into dist). Runtime asset roots now derive from
  `import.meta.env.BASE_URL` (AudioManager AUDIO_BASE, SpriteLibrary ROOT).
- `npm run deploy` → scripts/deploy-pages.mjs: PAGES build, copy the
  git-tracked public/ subset into dist/, `.nojekyll` (folders with spaces/
  parens would break under Jekyll), publish via gh-pages branch.

### Repo
- gh CLI installed via winget; device-flow login (keyring token unreadable
  cross-process on this Windows → re-login `--insecure-storage`;
  `gh auth setup-git` for pushes). Repo:
  https://github.com/IlliaKomissarov/isometric-game (main).
- Windows gotchas fixed in deploy: `core.longpaths true` (LOP pack paths
  overflow MAX_PATH in gh-pages' internal clone); the gh-pages npm package
  replaced with native git plumbing (15k paths on one command line →
  spawn ENAMETOOLONG).
- Pages on a PRIVATE repo → HTTP 422 on the Free plan; user chose to make
  the repo PUBLIC. Pages enabled from gh-pages branch, LIVE and verified
  in-browser (game boots and plays):
  https://illiakomissarov.github.io/isometric-game/
  Note: a cold-CDN 503 on first-ever load skipped the big pack for that
  one session (graceful guard); warm reload was clean.

## 2026-09-01 (iteration 30) — Final boss: 3 forms, 3 hp pools, death/rebirth

### The Hollow King fight rebuilt as a def CHAIN (`nextPhase` on EnemyTypeDef)
- bossHollow (P1, pool 300) → bossHollowKnight (P2, 260) → bossHollowLich
  (P3, 220). Threshold-fraction phases and attackHaste REMOVED.
- NEW MODEL registered: SkeletonWarrior10 as hollow2_* (horned-helm armored
  war-knight; heaviest unused skeleton in the big pack — size-audited, ALL
  anims healthy incl. 2_Attack). Three fully distinct bodies:
  P1 zombie colossus (melee) · P2 war-knight (melee, grave-gold 1.5) ·
  P3 lich (ranged kiting, scale 1.05→1.5 — uniform LARGE presence).

### Death-and-rebirth transitions (`action: 'transition'`, new Entity state)
- Pool empties → entity:died is INTERCEPTED by beginPhaseTransition():
  no xp/loot/clear. PHASE_DIE_TICKS(150): full death anim of the fallen
  form; def swap + applyRig at the boundary; PHASE_RISE_TICKS(120): the
  NEW form's death anim in REVERSE (rises from the grave) under the ember
  pulse. hp stays 0 throughout — dealDamage's guard = invincibility (and
  untargetable). Rebirth: fresh 100% pool, minion wave, boss:phase.
- Arena-clear counter treats a transitioning boss as alive
  (`hp > 0 || action === 'transition'`).

### Per-phase boss bar
- Notches (segmented pool look) hidden for the phased boss; fill recolored
  per form (default green-rot / grave-gold / pale sorcery); label
  "· PHASE n/3". Transition: bar drains to 0 through the death, then
  visibly refills with the rising body.

### Verified live (F20): pool 1164→0 → transition (damage ignored), swap at
### tick 150, rise, P2 fresh 1009 @100%, P2→P3 same, lich kites (3.6) with
### 6 volleys/400t, final death → clear → victory. F5 regression: Tomb
### Warden dies normally (no intercept). Zero console errors.

## 2026-09-01 (iteration 29) — Hitbox recalibration, lich model swap, instant teleport

### Entity hitbox / targeting recalibration
- pickEnemy's fixed 22×68 family box made tall bosses clickable only near
  the feet ("targets below the model"). New `Enemy.clickBox()` derives the
  box from the LIVE body: texture size × rig scale × anchor (width narrowed
  to 30% for pack padding, min halfW 16). Verified: Tomb Warden box spans
  −138..+37 px vs old −68..+8 — head AND torso clicks target him; small
  mobs scale down correctly (fallen −67..+19); empty air above misses.
- Test-driver gotcha: synthetic PointerEvents at 125% page zoom scale
  clientX→offsetX by 0.8 — multiply dispatched coords by 1.25.

### Floor 20 phase overhaul — REAL MODEL SWAP (tint phases removed)
- phaseTint/phaseScale/AoE slam deleted (boss:slam event removed).
- P1–2: heavy melee colossus (P2 "QUICKENS": haste 0.72 + wave).
- P3 ≤33%: `this.def = ENEMY_TYPES.bossHollowLich` + `applyRig()` — the
  boss physically swaps to SkeletonMage1 (skelm_*, scale 1.05, bone-white
  0xe8e2d0) and AI flips to ranged kiting (range 7, kiteMin 3.6, bolt
  projectiles, windup 38/recover 30, speedMult 0.66). Bar → "TRUE FORM",
  banner "THE HOLLOW KING SHEDS HIS FLESH!". applyRig extracted from spawn.
- Verified live: def/texture/scale swap at 30%, kited 2.2→3.6 tiles, 6 bolt
  volleys in 400 ticks, lich death → clear → victory overlay.

### Instant arena teleportation (no stair interaction)
- Boss floors have NO stairs: the farthest room IS the chamber; a crimson
  seal glow + red light burns at its center (world.stairs carries the seal
  sprite). `world.arenaThreshold` = the room rect; the tick loop teleports
  the player the moment their tile enters it. Verified on 5/10/15/20.

### Zero console errors across all four boss floors.

## 2026-09-01 (iteration 28) — Boss arenas, multi-phase Hollow King, boss music

### Sealed Boss Arena system (floors 5/10/15/20)
- Boss-floor stairs are now a PORTAL: touching them teleports (withFade)
  into a dedicated arena world — `generateArenaMap` (30×22, one vast open
  hall, zero internal clutter), candelabra hearth ring (8, TILE_BLOCKED),
  same theme band. Bosses NO LONGER spawn on the base floor.
- Arena spawns the keeper (BOSS_LADDER/BOSS_LEVELS, now module consts) at
  the east end plus a 5-mob honor guard from `kindPoolFor(floor)`.
- Exit stairs are HIDDEN (`renderable=false`, fog-unregistered; placeStairs
  gained `{hidden, at}` opts and returns its sprite) until EVERY combatant
  — keeper, guard, summons — is dead. Clear beat: reveal + burst + glint +
  gateOpen + "THE WAY OPENS" (gateOpen moved out of the boss loot beat).
- Floor-20 victory now requires the FULL arena clear (stairs gate).

### Multi-phase Hollow King (def flag `phases`, replaces old `summons`)
- P2 ≤66%: sickly-green recolor (phaseTint over scene light), 1.09× scale,
  attackHaste 0.72 (effective windup/recover getters), minion wave.
- P3 ≤33%: enrage — red recolor, 1.18×, haste 0.52, +6 damage, wave, and a
  260-tick AoE ground slam (reach 3.4) with `boss:slam` ring-burst FX.
- `boss:phase` FX: horn + roar, quake, gore, banner, bar → "· PHASE II" /
  "· ENRAGED". New events in EventBus.

### Boss fight music (public/assets/audio/boss fight — 6 tracks scanned)
- Per-floor map: 5→Shadowforge Convergence · 10→Veil of Eternal Nightfall
  · 15→Eclipsed Desolation · 20→Dread March (filenames keep their spaces).
- `audio.setBossMusic(on, floor)`: ~1.4 s element-volume crossfade against
  bgm+ambience, play-retry vs autoplay policy, routed through the BGM bus.
  In on entering the arena; out on full clear (and on any normal build).

### Verified live (seed 42, floors 5/10/15/20): portal teleport, sealed
### open arenas, per-floor tracks, hidden→revealed stairs, arena descend
### (5→6), P2/P3 stats+bar+waves, slam cadence, F20 victory overlay only
### after full clear. Zero console errors.

## 2026-09-01 (iteration 27) — Warden attack-frame fix, audio density boost

### Tomb Warden idle/attack invisibility — ROOT CAUSE FOUND
- Mithras's `2_Attack` (and `3_Bow`) PNGs are BLANK 0.7 KB exports across
  all 8 cameras (the .bmp twins hold the pixels but lack alpha) — the boss
  had literally no attack pixels, vanishing for the entire windup ("stands
  still, then invisible"). His `4_Cast` PNG set is intact and reads as a
  poleaxe lunge → mithras_attack now loads 4_Cast. Verified live: 400-tick
  probe (392 attack ticks) + two mid-attack captures, fully visible,
  alpha 1.0 throughout. LESSON: size-audit a pack's PNGs per-anim (blank
  exports hide inside healthy folders).

### Audio density boost (it.27)
- Stinger scheduler: check 6s→4s, skip-roll 0.45→0.25, quiet window
  16–36s→9–20s — ambient triggers land roughly twice as often.
- Enemy voices: anti-chorus 90→70 ms, volumes +0.05.
- NEW combat voice heartbeat: every ~2.5 s one nearby chasing enemy speaks
  (species growl/hiss/moan) — combat never falls silent. Render-only.

### Verified live — zero console errors (floor 5 engagement).

## 2026-09-01 (iteration 26) — Warden stability, Frost wight, gold glow, SFX round 2

### Tomb Warden "flicker/invisible" — diagnosed & fixed
- 480-tick live probe of the ALIVE boss showed zero anomalies (alpha 1.0,
  texture always set, smooth light tints) — the reported glitch was the
  DEATH sequence: the hard tint strobe read as flicker, and the fade to
  alpha 0 before corpse-spawn left an invisible body. Fix: continuous
  sine-mixed ember PULSE (verified: 71 distinct smooth tints, no flips)
  and an alpha floor of 0.55 — the corpse replaces the body seamlessly.

### Boss roster & mobs (big pack round 2)
- Floor 10: the Frost Warden now wears its OWN body — the robed WIGHT
  (SkeletonWarrior4, hoarfrost tint, 1.35×). Mithras is exclusively the
  Tomb Warden (floor 5). Verified distinct at L13.
- NEW mob 'Grave Guard' (shield-bearing SkeletonWarrior7), depths 6+ —
  verified 5 on floor 12 alongside the full existing roster (nothing
  removed). Both use the proven CAM_FOR_DIR mapping (no reversed walks).

### Gold visibility & pickup
- Piles now carry a pulsing additive GOLD GLOW + scale 1.8 (visible on
  dark floors). PICKUP BUG FIX: the fog-gated loop anim used to resurrect
  hidden piles — collected piles are now DESTROYED (sprite + glow), with
  destroyed-guards in Ambience loops/glows. Verified: instant despawn.

### TomMusic deep-scan round 2 (all banks verified decoded)
- gateOpen → the barred stair grinds open at the boss loot-beat ·
  firespray → the Ember Maw's bossCast · bowBlocked → arrows clattering
  off stone (non-flesh impacts) · unsheath → equipping a weapon (UI tick
  on unequip). Previously mapped banks unchanged.

### Verified live — zero app console errors (floors 5/10/12 + probes)

## 2026-09-01 (iteration 25) — The Big Pack, Horror SFX hard-map, cursor-at-boot

### /assets/big pack 8 moves — indexed & integrated
- A full layered character system: base bodies + ~400 equipment overlays +
  complete models. Naming {seq}_{Anim}_CAM{0-7}_{frame}.png, 148×130,
  frames idle[20..40]/attack[60..78]/cast[140..158]/walk[180..200]/
  run[220..238]/death[261..280] (shared across models, verified). CAM0
  faces WEST → CAM_FOR_DIR=[4,3,2,1,0,7,6,5]. Loaded directly (no rebake).
- INTEGRATED: SkeletonWarrior1 = the Risen Blade's real bones · BaseAhoul
  = NEW "Ahoul Ghast" (fast melee, depths 2+) · Shaman7 = NEW "Blood
  Shaman" (bolt caster, 4+) · SkeletonMage1 = NEW "Marrow Warlock" (bolt
  caster, 10+) · MITHRAS the minotaur = the Tomb AND Frost Wardens' new
  non-knight body (bronze / hoarfrost tints, scale 1.35 after live calib).
- Spawn pools rebalanced across 1–20 with the new species (verified:
  floor 3 = 9 ahouls; floor 11 = 7 shamans + 5 warlocks casting).
- Skipped: Panther (one unsegmented 78-frame blob — no attack/death
  mapping possible), Rot (24 flat files, not a character).

### /assets/audio/Horror SFX Free — hard-mapped (36 buffers verified)
- 11 banks: hScream/hZombie/hGrowl/hGrunt/hHiss/hRoar/hGore/hHurt/hMoan/
  hStinger/hAmbience. enemyVoice(state,pitch,bank): species → bank
  (zombie=hZombie, ahoul+wolf=hGrowl, lizard+Ember=hHiss, warlock=hMoan,
  humanoids=hGrunt with hScream deaths, wardens=hRoar). Crits + ≥12-dmg
  hits tear with hGore; hero sometimes gasps (hHurt); bossSeen/bossDie
  ROAR; stinger scheduler now rotates piano stingers, long creepy
  ambiences, creaks, and moans on the amb bus (non-overlap kept).

### Cursor freeze fix + resize
- Root cause: the pointer style was injected AFTER the ~1-min asset load,
  so a post-victory reload showed the system pointer on a dead-looking
  loading screen ("cursor stops working past the boss floor").
  `installCursor()` now runs FIRST, before any loading. Pixels 2→1.7×.

### Gotcha repeated & fixed
- A PowerShell -replace pipe mojibake'd Enemy.ts AGAIN (the it.17 gotcha).
  Reversed via cp1251 round-trip. RULE: never edit source with PS text
  pipes — Edit tool only.

### Playtest (floors 3/5/11, zero app console errors)
Ahouls flank correctly; Mithras towers at L7 facing the player; shamans
visibly cast glowing bolts; horror buffers 36/36; global cursor live.

## 2026-09-01 (iteration 24) — Direction audit (ALL packs), voice-pool probe, orb/cursor

### Full direction audit — the vendor-wide half-turn
- Frame-by-frame audit of every pack's angle convention proved ALL FOUR
  angle-tree packs (guard 320x320, wolf x320p1234, lizard Frames_320x320,
  naga 256x256) share the ranger's 180° inversion: their angle-0 frames
  face WEST (triangulated: guard 090=S, 270=N). Every angle list now
  carries the half-turn rotation ['180','225','270','315','000','045',
  '090','135']. Knight, LoP, and zombie (E=E, verified) were correct.
- Live proof: guards square up chest-to-chest with the player; the wolf,
  lizard, and naga all orient AT their targets mid-combat.

### Voice-pack auto-discovery (the numbered folders)
- TRIPLE-VERIFIED: all 10 numbered folders hold 555 macOS ._AppleDouble
  stubs and ZERO files >1KB — no audio data was ever copied in.
- Built `probeVoicePack()`: at unlock it probes damage/death/grunting/
  shouting/miscellaneous ({stem}_{n}_{actor}.wav, 5 actors × 10 takes),
  decodes whatever exists into randomized pools that TAKE PRIORITY over
  the beast-slice voices (hurt/die/idle/attack) and feed ambient stingers.
  The instant real files land, they map with zero code changes.
- New 'attack' voice state: species grunt on every enemy strike frame.

### UI
- Orb segment stripes REMOVED (user reversal) — clean smooth fill again.
- Cursor enforced GLOBALLY: injected `* { cursor: url(...) !important }`
  — the gothic pointer covers canvas, panels, buttons, sliders; no system
  pointer anywhere. (No cursor art exists in assets — searched again.)

### Pre-flight pass (bands via 12/15, prior iterations cover 1/5/16/20)
Zero console errors; facings verified in combat; orb clean; global cursor
style tag present; boss level plaque L18 at depth 15.

## 2026-09-01 (iteration 23) — Level matrix, archer facing, segmented bars, voices

### Strict level scaling matrix
- Enemy.spawn now takes a LEVEL; hp = base×(1+0.12(L−1)), damage bonus
  = round(1.0(L−1)), xpValue = (baseHp/6+3)×(1+0.08(L−1)) — everything
  derives from level, nothing else.
- Floor-N mobs are level N; ~15% spawn as rares at N+1 (verified floor 3:
  29×L3 + 6×L4). Boss milestones: 5→7 · 10→13 · 15→18 · 20→25 (verified:
  Tomb Warden L7, 722 hp). Hollow King base hp 800→650 for the L25 mult.
- Player curve: xpToNext = 140+8L (full floor clear = 3 levels, retested
  live: 35 kills → +3); per level +4 maxHP, 25% heal, +0.25/+0.35 dmg.

### Archer sprite direction FIX
- The x320p bow pack's angles run 180° OPPOSITE the other sheets — she
  walked/shot backwards. R_ANGLES rotated half a turn
  (['180','225','270','315','000','045','090','135'] for [E..SE]).
  Verified: she now draws toward the player.

### Enemy voice density (species-pitched)
- New `audio.enemyVoice(state, pitch)`: idle-growl / hurt-bark / death-cry
  as FRESH random beast-recording slices at a per-species pitch (zombie
  0.62 … lizard 1.35, bosses 0.55) with ±12% jitter — non-repetitive.
  90 ms anti-chorus throttle. NOTE: the uploaded voice-actor pack is STILL
  0-byte ._stubs (rescanned) — real files will slot in 1:1.

### Segmented HP UI
- Enemy bars: 32×5 notched quarters with top sheen + "Lv N" plaque
  (Pixi Text, shows with the bar). Hero orb gained quarter-notch divider
  overlay. Boss bar: taller, ornamental ◆ caps, 10% notches, glow, and
  "NAME · LVL N". Gold reads "◆ GOLD: n" on the HUD and "Gold: n" in the
  inventory.

### Cursor v3
- Obsidian blade-arrow, full gold edging, crimson gem inset (2× nearest).

### Verified live — zero console errors
Level histogram, boss L7 bar + plaque, 3-level floor clear, archer facing,
segmented orb/bars on screen, cursor style applied.

## 2026-09-01 (iteration 22) — XP levels, gold, enemy vocals, UI scroll, balance

### XP / leveling (Player.ts)
- XP strictly from kills: xpGain = round(enemy.hpMax/6)+2, granted
  SYNCHRONOUSLY in the entity:died handler (deterministic — damage grows
  from levels, so this is sim-relevant).
- Curve: xpToNext = 30 + 20L + 3L² (fast early, ~L18 by depth 20).
- Per level: +8 max HP, heal 30% of max, +0.5/+0.7 min/max damage folded
  into weaponProfile (levelDamageMin/Max).
- LEVEL-UP FX: gold burst + glint + shake + "LEVEL UP!" floater + the
  Firebuff shimmer & rising chime ('levelUp'). Verified live at L2.
- HUD: LVL plaque + gold-gradient XP bar + gold counter on the bar
  (#progress-hud); orb reflects grown max HP.

### Gold
- Props gold piles are now COLLECTIBLE (returned as GoldPile[] with
  seeded 8–25 amounts). Walking within 0.75 scoops: sprite hides, coins
  clink ('gold' = Lock-Unlock sped bright ×2), "+Ng" floater, HUD +
  inventory counters update. Verified: 17g pile → gold 17 everywhere.

### Enemy vocals (and the empty voice pack)
- NOTE: the uploaded "1–10" voice-actor pack contains ONLY 0-byte macOS
  ._metadata files — no audio data survived the copy. Slots are ready
  ('enemyHit'/'enemyGrowl'); re-copy the real WAVs to upgrade.
- Meanwhile: 'enemyHit' pain-bark + 'enemyGrowl' aggro-growl are sliced
  from the beast recording; new `enemy:aggro` event fires when an idle
  enemy first notices the player.

### UI scrolling
- Level select: rows wrapped in .lvl-scroll (56vh, thin scrollbar) —
  verified 744px of floors scrolling in a 358px viewport.
- Cheat menu items now show DETAILED STATS under each name (statLine:
  damage/armor/range) in the existing scroll region. Inventory backpack
  scroll retained; gold shown in the panel header.

### Balance pass
- Enemy hp curve 0.35/floor → 0.22/floor (depth 20 ≈ 5.2× vs old 7.7×);
  enemy damage bonus 2.0/floor → 1.2/floor. Pairs with level damage so
  late floors stay dangerous without sponging (trash ~4 s, tank-zombies
  ~12 s at depth 20 for an on-curve hero).

### Verified live — zero console errors
XP floaters + bar %, L2 level-up burst/banner/HP-growth, gold pickup end
to end, level-select scroll metrics, cheat stats render, enemy growl/
grunt paths executing.

## 2026-09-01 (iteration 21) — Enemy audio, layered ambience, full-system audit

### Enemy combat audio
- 'enemySwing': every enemy melee strike frame whooshes (Sword Attack bank
  at 0.38 vol / 0.85 rate — slower and heavier than the player's, so the
  ear tells who is swinging). Ranged foes already sound bow/bolt at launch;
  landed hits ring the armor clang + freeze crackle. Verified live: a
  floor-12 brawl fired enemySwing×8, hit×4, bow×2, arrowHit×2.

### Dynamic layered ambience (own channel)
- New AMBIENT bus (masterGain → ambGain) beside music and SFX, with its own
  Settings slider ("Ambience", persisted).
- Bed: the Fantasy pack's Cave.ogg loops quietly under everything.
- STINGERS: every 6 s a scheduler MAY fire one distant atmosphere — a door/
  gate groan (creak bank at 0.7–0.95 rate) or a far-off beast breath slice.
  NON-OVERLAP: a quiet window (16–36 s) after each stinger guarantees they
  never stack; a 20 s hold after unlock lets the intro land first.

### Full-system audit (seed 77, fresh run) — ALL PASS, zero console errors
- Combat AoE: grouped pair (d=1.0) both damaged by one swing sequence.
- Ranged AI kiting: point-blank archer retreated to exactly 3.11 tiles
  (kiteMin 3.2), stayed visible, stood and fired.
- Layouts 3–20 = 1–2 generator: verified XII (frozen) + XVI (ember) —
  identical rooms, band tints only; level-select hints name every band.
- Auto-stairs + boss lock: proven it.20 (on-stairs unlock the tick hp=0).
- Light radius: full warm pool around the hero on deep floors.
- Inventory grid + animated paperdoll canvas: present and cycling.
- Cheat menu: 15-item weapons bank in a live scroll region.
- Floor-12 roster: wolf5/archer9/guard4/zombie4/lizard5 — full band mix.

## 2026-09-01 (iteration 20) — Fantasy SFX pack, stair/boss-lock proof, hit-box audit

### 1. Stairs & boss lock (verified, no code gap found)
- Live proof on depth 5: standing ON the stairs with the boss alive holds
  the floor; the tick its hp hits 0 the descent fires AUTOMATICALLY (the
  proximity check runs every tick, so the unlock is immediate — no click,
  no re-touch). Standard floor 6→7 auto-descended on touch likewise.

### 2. Fantasy SFX pack fully mapped (TomMusic upload)
- New VARIANT-BANK engine: 13 banks × 2–5 takes (36 oggs), random take +
  ±7% pitch jitter per play — the one-sample-many-pitches ARPG standard.
  All banks verified decoded live. Synth blips demoted to decode-failure
  fail-safes only.
- MAP: swing/whiff=Sword Attack 1-3 · hit=Sword Impact 1-3 ·
  crit=chop 1-4 + impact layer · hurt=Sword Blocked (armor clang) ·
  bow=Bow Attack · arrowHit=Bow Impact · bolt=Fireball 1-3 ·
  boltImpact=Spell Impact · freeze=Ice Freeze (Frost Warden slow, fires
  when slowTicks refreshes) · pickup=Sword Sheath stow · chest=Chest Open
  1-2 · stairs=three descending Stone Run footfalls · ui=Sword Parry tick
  (quiet, 1.85×) · NEW player FOOTSTEPS=Stone Run 1-5 on the onStep hook.
- Kept from the drone set: beast groans (enemyDie slices), doom+magic6
  (bossDie), war-horn (bossSeen), chant (summon), reveal/bgm/bgmDeep.
- Volume balance: steps 0.2, ui 0.14, whiffs 0.35, hits 0.85, crits 0.95.

### 3. Math & collision audit
- FIXED: enemy click hit-box assumed 48px bodies — bosses render ~150px,
  so upper-body clicks fell through. Now 22×68 (×zoom), feet-anchored.
- Audited clean: stairs touch radius 0.8; STRIKE_REACH ≥ selection range
  (livelock rule); AoE arc dot ≥ 0.57 at same reach; canStandAt 4-corner
  collider (r=0.28) + radius-aware separation + per-tick bounds clamp;
  chest interact 2.2; armor math max(1, dmg−armor); enemy strike-frame
  range re-check (+0.15 grace). No lag paths found; all triggers tick-driven.

### Verified live — zero console errors; all 20 sfx triggers execute clean.

## 2026-09-01 (iteration 19) — Proximity stairs, tone-matched staircase, sampled combat audio

### 1. Stairs = proximity trigger
- The descent now fires the moment the player TOUCHES the staircase
  (distance < 0.8 to the tile center) — no exact tile-center landing, no
  clicking. Verified live: warping into touch range auto-descended 1→2
  through the fade. The ONLY transition gate anywhere remains a living
  warden on its own boss floor (by design).

### 2. Staircase tone-baked into the floor grid
- Full asset audit re-confirmed: no pack carries a floor-matching
  descending staircase (Temple Kit has none; the deleted Stairs pack only
  ascended). The REAL Infernus Stairs_Inverted stays, but its cool grey
  stone is now TONE-BAKED per-pixel (×0.62/0.53/0.40 warm multiply) into
  the stone-floor palette at load — it sits in the grid seamlessly
  instead of popping bright.

### 3. Sampled combat audio (synths demoted to fail-safes)
- MEASURED every provided file in-browser (duration + peak envelope) and
  discovered the truth of the library: dark-magic-4/-6 are sharp ONE-SHOT
  IMPACTS (transient in the first ~1.5 s, then silence), se_ku*.wav is a
  3 s front-loaded slash body, beast-breathing yields organic groans,
  unleashed-demon is a doom swell.
- New `playSlice(key, offset, dur, rate, vol, jitter)`: carves punchy
  one-shots from the recordings with ±rate jitter (one sample, many
  pitches — the classic 16-bit trick) and a 40 ms declick tail.
- COMBAT MAP (all real audio): swing/miss = slash slices at 1.8×/2.1×;
  hit = magic-6 transient at 1.6×; crit = full magic-6 + slash layer;
  bow = fast slash chirp; bolt = magic-4 cast; arrowHit = micro magic-6;
  hurt = magic-4 transient (distinct timbre from dealing damage);
  enemyDie = RANDOM beast-groan slice pitched low; bossDie = doom swell +
  magic-6 boom; chest = full slash body slow. Pickup/UI/stairs/victory
  keep chip-blips (idiomatic for menus/loot). Synth paths now run ONLY if
  a buffer failed to decode.
- Depth-band BGM: floors 10+ swap the mystery theme for the gloomy
  demonic drone (`setBgmDeep`); both real tracks.
- Verified: all SEVEN buffers decode live (beast/chant/doom/horn/magic4/
  magic6/slash); slice playback paths run clean; zero console errors.

## 2026-09-01 (iteration 18) — The Audio Phase + the real staircase

### Audio system (engine/AudioManager.ts)
- Web Audio graph: master → bgm/sfx gain buses; volumes + mute persist in
  localStorage ('iso-arpg-audio'). Unlocks on the FIRST user gesture
  (autoplay policy); a rejected first play re-arms on the next real
  gesture (`retryOnNextGesture`). Render-side only.
- REAL TRACKS wired (public/assets/audio): mystic-reveal = intro sting →
  dark-mystery-cinematic = looping BGM; war-horn = boss sighted;
  dark-magic-4 = fire-bolt cast; dark-magic-6 = boss-death undertone;
  dark-spell-chant = Hollow King summon. All four SFX buffers verified
  decoded in-browser. (Unused, untested: se_ku*.wav — unknown content;
  the three alesiadavina drones are future ambience candidates.)
- SYNTH VOICES (Web Audio oscillators + filtered noise, retro fidelity)
  for every essential effect: swing/miss whooshes, hit thump+crack, crit,
  bow pluck, arrow impact, player hurt, enemy death, pickup/chest/stairs
  blips, UI click, 4-note victory fanfare. 60 ms per-name throttle stops
  AoE/pack spam from clipping.
- Triggers: combat:swing (whiff/crit), entity:damaged (hit/hurt),
  entity:died (enemyDie/bossDie), fireProjectile + enemy shootArrow
  (bow/bolt), projectile:impact (flesh), pickup, chest, floor fades
  (stairs motif), bossSeen (horn), summonMinions (chant), endgame
  (fanfare), UI toggles (Inventory/CheatMenu/LevelSelect/Settings).

### Settings UI (ui/Settings.ts, O key)
- Master / Music / Effects sliders + Mute checkbox, gold-accented panel,
  persisted; audible tick feedback while sliding. COMMANDS row added.

### The REAL staircase
- Found it: `Infernus_Tiles/Building_Infernus_1/Stairs_Inverted_1.png` —
  a pre-rendered DESCENDING stairwell carved into a tile diamond, 64 px
  wide = exactly TILE_W. placeStairs uses it (procedural pit = fallback).
  Verified in-scene: carved steps sinking below floor level.

### Verified live (fresh tab, seed 42) — zero console errors
Settings panel renders + persists; audio graph builds, all file buffers
decode, sfx() calls clean; staircase sprite placed at the stairs tile.
HARNESS NOTE: extension canvas clicks do NOT deliver pointerdown to the
page in an occluded tab — audio unlock was verified with a synthetic
dispatch (ctx builds, stays 'suspended' until a real gesture, by design).

## 2026-09-01 (iteration 17) — Presentation revert: one pipeline, real stairs, boss beats

### 1. Depths 3–20 = the floors-1-2 pipeline, tint only
- The Temple Kit material path is RETIRED (load + builders removed). ALL
  depths render through `buildStoneEnvironment`, which now bakes the base
  set plus three banded sets differing ONLY by a subtle multiply tint:
  `_deep` 0xb2acc0 · `_frost` 0x9cb2dc · `_ember` 0xd2a488. Identical
  geometry, shading, seams, variants — palette is the only variable.
- Crack-decal overlays REMOVED (read as "broken tile placement"); the
  stone variants' baked hairline cracks are all the wear the ground needs.
- ENCODING GOTCHA: a PowerShell line-splice (`Get-Content`/`Set-Content`)
  mojibake'd the file's UTF-8 (— → вЂ”); fixed by reversing through
  cp1251. Use the Edit tool for TS surgery, not PS text pipes.

### 2. A real descending staircase
- `stairs_down` rebuilt as a classic-ARPG sunken stairwell: five lit stone
  treads with dark risers stepping toward the far corner, converging false
  perspective, masonry side flanks, black passage threshold, stone rim
  aligned to the tile diamond. Tread tones match the floor material so it
  connects seamlessly.

### 3. Extended boss death (a victory beat)
- Boss deathTicksTotal 110 → 240 (~4 s). Render: collapse anim across the
  first ~55%, then the body HOLDS its final frame strobing hot (slower
  strobe), turns pale 0xfff1d8, and fades over the last 18%.
- main: EIGHT growing explosion pulses across the collapse (200 ms + i*340,
  spread and count scale up), then the LOOT BEAT at 3.3 s: 3 rares + glint
  + a 20-particle gold burst + kick/shake — the reward lands only after
  the body burns down.

### Verified live (fresh tab, seed 42) — zero console errors
Depth VI and XVI render exactly like floor 1 with cool/ember casts; the
staircase reads as recessed descending steps beside live combat; the Tomb
Warden's death ran the full strobe → hold → pale → fade arc with the loot
glyph appearing at the delayed beat.

## 2026-09-01 (iteration 16) — Designer corrections: collision rule, purges, UI bar

Reference: the Devilution WASM web port — D1 conventions applied:
bottom control-panel HUD, collision-bearing clutter, descending stairwells.

### The classic ARPG collision rule + clutter purge
- NEW INVARIANT: every standing prop HAS COLLISION or does not exist. Flat
  ground paint (cracks, gold, corpses, blood) stays walkable by design.
- `TILE_BLOCKED` tile type: blocks movement/pathing, passes sight/light,
  renders floor under the prop. `planHearths(map)` marks hearth corners in
  the grid BEFORE scene/pathfinder build (main), so collision, rendering
  and prop placement agree. SceneManager.isOpaque = walls only.
- Candelabras stand on blocked tiles — verified walkable:false/opaque:false.
- PURGED walk-through standing clutter: rubble piles, broken-column stumps,
  grave shards, bone/gore heaps, the boss-stairs altar, the dragon-skeleton
  centerpiece ("screen-blocking"). Props.ts rewritten around the rule.
- SPINNING-PROP FIX: the candelabra sheet's 3×4 cells are ROTATION POSES,
  not flame frames — cycling them spun the prop ("spinning llamas"). It now
  uses ONE static cell.
- STAIRS DESCEND: procedural `stairs_down` — banded stairwell pit sinking
  into pure black with lit tread lips + stone rim. The ascending Stairs
  pack contradicted the descent and was deleted.
- Depth 3+ layout confirmed identical to 1–2 (bands + hearths only).

### AI & bosses
- Flee logic: cowards STOP at a safe distance (idle-stand) instead of
  marathoning into corners; a CORNERED flee-er latches `desperation` and
  fights to the death. Archers already stop-and-shoot (it.13 kite fix).
- FINAL BOSS REBODIED (user: no knight): The Hollow King is now a MASSIVE
  rotting colossus — the zombie cinematic pack at 0.58 (512px frames →
  ~150px on screen, 3× the knight), grave-pale tint, full anim set.
  The orc loads were benched (pack intact, unused).

### UI / cursor / text
- Bottom HUD BAR (#hud-bar): full-width stone strip; orb seated on it,
  DMG/ARM plaque beside, condensed two-column COMMANDS docked right.
- Cursor: hand-pixeled gothic pointer (obsidian outline, row-shaded steel,
  gold trim edge, 2× nearest) injected as a data-URL; SVG dagger removed.
- Text pass: endgame prose tightened ("The wardens have fallen, their
  crowns are ash… The dark will remember your name."), stats line
  capitalized, boss-gate line reworded, level-select hints now name the
  frost/ember bands.

### DELETED ASSETS (per the it.16 deletion protocol)
- 256x256/FireBreath (960 files) — WRONG CREATURE in the naga pack (the
  morph glitch source).
- Stairs (36) — every variant ascends; contradicts the descent.
- coc_chars (25) — RTS cartoon style, palette mismatch.
- Angle (144) + Isometric (144) — duplicate library furniture with baked
  grey drop shadows that clash with the lighting model.
- Boxes (8) — diamond-packed sheet, glitchy crops (purged from the game in
  it.11; files now removed).
- 8 Directional Greatsword Knight Character (48) — no death animation
  (violates the full-anim mandate).

### Verified live (fresh tab, seed 42) — zero console errors
HUD bar + orb + condensed commands; stairs-down pit reads as a hole;
static candelabra; hearth tile blocks movement, passes sight; Hollow King
colossus towers ~3× the knight at depth XX; clean rooms, no floating
clutter. Boot is faster (orc + Infernus prop loads gone).

## 2026-09-01 (iteration 15) — Game-feel overhaul: FX, endings, Infernus kit

### Environment & rendering
- STRUCTURAL REVERT (user-directed): depth 3+ layout generation matches
  floors 1–2 again (the it.14 pillar/minRoom flavor is off; `DungeonFlavor`
  kept for the future). Depth identity = theme bands + prop dressing.
- THEME BAKE FIX: the translucent retint overlay occasionally failed to
  bake during a busy boot → raw bright sandstone floors. Retints are now
  MULTIPLIED into the texture fills (`fill({texture, color})`) — atomic,
  race-proof. New band tones: deep 0x7e7890 / frost 0x5c74ac / ember 0x96604a.
- WALL FLICKER FIX: cutaway fade now has HYSTERESIS — held walls release
  only past looser depth/overlap thresholds (depthMargin −2 enter / +10
  hold, 14px rect padding), so boundary walls stop strobing.
- FOG CULLING FIX: creatures on NEVER-SEEN (black) tiles are strictly
  invisible; the 8-neighbor fallback now applies only on EXPLORED tiles
  (kills the halberdier-floating-over-void bug, keeps the cornered-archer fix).

### Combat feel
- MELEE AoE CLEAVE: the swing rolls against every other enemy within reach
  and ~55° of the strike direction (independent to-hit + damage, no crit
  double, standard knockback). Verified: one swing damaged 3 grouped mobs.
- SCREEN SHAKE: trauma-based (`Camera.addShake`, displacement ∝ trauma²,
  max ~5px) on ≥10-damage hits, player crits, boss deaths. Subtle by design.
- Particles: steel sparks on every landed player hit; crit spark burst;
  all prior systems (motes, mist, blood, glint) intact.
- DRAMATIC BOSS DEATH: 110-tick collapse with hot strobing tint, 5 staged
  blood/fire explosions + shakes over ~1.3 s, then a loot explosion (3
  rares + glint + kick). Guarded against floor changes mid-sequence.

### UI & endings
- ANIMATED PAPERDOLL: the inventory character cycles real idle frames
  (armor tint + slot gems baked per frame; interval-driven canvas).
- NEW CURSOR: built at boot from the REAL oubliette steel-falcon blade
  sprite — 2× nearest-neighbor, rotated tip-up-left, dark halo. (No cursor
  pack exists in assets; this uses genuine pack art.)
- FLOOR FADES: descend/jump wrapped in `withFade` (fade to black 300 ms →
  rebuild → fade in). Re-entry guarded.
- ENDGAME: real epilogue — screen sinks to black over 2 s, gold title,
  prose, run stats (depths/time/king), DELVE AGAIN button (fresh seed).

### Infernus kit integration (new upload)
- `inf_altar` looms behind boss-floor stairs; `inf_grave1/3` haunt depths
  3–14; `inf_bones` (6+) and `inf_gore` (15+) litter rooms; the CANDELABRA
  (3×4 flame-flicker sheet) stands at every hearth (elegant light bodies —
  the crude bonfire stays banned); ONE great DRAGON SKELETON (rebaked 0.35)
  lies across the largest hall of every ember-depth floor.
- Skipped with reasons: Greatsword Knight atlas (no death anim — zero
  tolerance), Angle/Isometric library furniture (baked grey drop shadows
  clash), remaining Infernus building tiles (future full-tileset swap).

### Verified live (fresh tab, seed 42) — zero console errors
Depth V boss arena: altar + rune grave + candelabra + Tomb Warden; full
death sequence (strobe, staged bursts, banner, loot). Inventory knight
animates (two poses captured). Depth XVI: ember halls + dragon-skeleton
centerpiece + gore. AoE cleave: 3 mobs hit in one swing (loop.step-driven).
Endgame overlay complete with stats + button. Cursor style applied.

### Testing gotcha (reaffirmed)
Chrome fully throttles rAF in occluded automation tabs — the game loop can
FREEZE mid-test (tick stuck). Drive verification with `__game.loop.step(n)`
instead of real-time waits; keyboard-dispatch tests silently no-op while
frozen.

## 2026-09-01 (iteration 14) — Deep-level rescue, roster completion, collision & gore

### 1. Deep dungeon redesign (no more identical floors)
- THEME BANDS: 1–2 stone crypts · 3–9 buried temple (`_deep`) · 10–14
  frozen halls (`_frost`, blue-steeped) · 15–20 ember depths (`_ember`,
  heat-scorched). One shared material, three baked looks
  (`AssetManager.buildThemedSet`); `SceneManager.FloorTheme` extended.
- ARCHITECTURE: `generateDungeon` gained `DungeonFlavor` — depths 3+ carve
  PILLAR COLONNADES inside ≥7×7 rooms (spacing 3, inset 2, centers kept
  clear, 25% crumbled away; carved AFTER corridors so connectivity holds);
  depths 10+ get grander rooms (minRoom 5). Enemy/chest spawns skip pillar
  tiles.
- RUIN DRESSING (Props): per-room cracked-tile decals (3 variants), rubble
  piles, and broken-column stumps with fallen drums — all fog-registered.

### 2. Roster completion + broken-anim extermination
- MORPH GLITCH PURGED: the 256x256 pack's FireBreath folder is a DIFFERENT
  creature (a dragon) than its Idle/Walk/Attack/Hit/Death (naga). Vyrissa
  now uses her spear `Attack1` as the bolt-launch anim; FireBreath is
  banned from loading. She is a consistent serpent-maiden at every angle.
- NEW MOB **Moon-Cursed Ravager** ('wolf'): armored werewolf axe-berserker
  (x320p_Spritesheets1234 grid sheets — idle/run/attack/hit/death), fast
  melee elite, depths 6+.
- NEW MOB **Ashscale Duelist** ('lizard'): crested lizardman scimitar
  raider (Frames_320x320 per-frame tree — BattlePose/Run/GroundAttack/
  HitStomach/DeathFallBack), depths 10+. Its AERIAL set (Air_Fly etc.)
  remains unloaded — a future flying elite.
- SIZE NORMALIZATION: guard 0.3→0.42 (the "tiny spearman"), archer
  0.3→0.36, naga 1.15→1.0, wolf 0.42, lizard 0.4.
- Depth-banded spawn pools: each band introduces new flesh (1 / 2–3 / 4–5 /
  6–9 / 10+ rosters — 7 regular kinds + 4 distinct bosses).

### 3. Corner collision / wall-clipping fix
- `EnemyPool.separate` now uses radius-aware `canStandAt` (tile-center
  checks let shoves wedge collider EDGES into wall corners).
- Enemy.update starts with a TIGHT BOUNDS CLAMP: any body that ends up in
  an illegal collider position snaps to its tile center, or the nearest
  walkable neighbor center — nothing can remain inside a wall mesh.

### 4. Visceral blood + combat infographics
- `entity:damaged` now carries the blow's direction; `Ambience.bloodSpray`
  flings 7–18 dark arterial droplets along that axis (30% splash back),
  4 mixed reds, gravity; deaths add a 22–34 droplet radial blowout on top.
- Existing: floating damage numbers, gold CRIT! banner, hit-flash, corpse +
  stain permanence — all confirmed still firing.

### Verified live (fresh tab, seed 42)
Zero console errors. Depth V: pillared halls + cracks. Depth XII: FROST
band + broken column + rubble + Ashscale/Ravager fighting. Depth XV: EMBER
band + consistent naga (no morph) + normalized guard. Directional blood
visible against walls. All packs loaded without warnings.

## 2026-09-01 (iteration 13) — Final polish: light, fire purge, asset audit, menu overhaul

### 1. Level 3+ darkness fixed
- FOG_RADIUS 8→9, LIGHT_FULL_RADIUS 3.4→4.5, LIGHT_SHADOW_RGB lifted
  [24,26,38]→[36,38,54] (explored/edge tiles readable, still cold).
- Temple retint overlay alpha 0.46→0.30 — deep floors clearly legible now.

### 2. Fire purge → crypt mist
- The bonfire anim + orange glow blob REMOVED everywhere (user: "ugly fire").
  Braziers are now invisible warm hearths: `lighting.addSource` + hotspot
  ember motes only. SpriteLibrary no longer loads the Bonfire vfx.
- NEW atmosphere: 12 ground-hugging "crypt mist" patches (`fogPatch` soft
  ellipse texture, cool tint 0x8f96b4, drift + breathe, light-gated alpha)
  in Ambience — subtle, never clutters.

### 3. Ranged AI corner bug + CRIT
- Kiting archers only retreat while `moveDirect` actually moves them; a
  cornered archer now stands and fires point-blank instead of pressing
  invisibly into the wall. Render fog-gate fallback extended to all 8
  neighbor tiles (diagonal corners).
- Max-damage weapon rolls now read as crits (`combat:swing` result 'crit';
  only true crit rolls still double). A gold "CRIT!" banner floats above
  the damage number ((x-0.4,y-0.4) world offset = straight up on screen).

### 4. Comprehensive asset audit → 3 NEW fully-animated creatures
- `256x256` pack = a CRIMSON DRAGON (16 angles × 20-24 frames, FireBreath!)
  → **Vyrissa, the Ember Maw**, the Depth XV boss (FireBreath = her ranged
  attack anim). Frames 0-based, rebake 0.5, def scale 1.15, anchorY 0.62.
- `320x320p_Frames` pack = armored ORC BERSERKER (Armed/Unarmed/Roar/Block
  sets) → **The Hollow King's** unique body (Depth XX). 1-based frames,
  rebake 0.4, def scale 0.55 (bakes stay 320px!), anchorY 0.7.
- `320x320` pack = armored HALBERDIER → **Crypt Sentinel**, new regular mob
  on depths 4+ (reach 1.7 polearm). def scale 0.3.
- Loader: generic `rebakeAnglePack` for `<Anim>/<Body>/<angle>/` per-frame
  trees; angle order [0..315] ⇒ dirs [E,NE,N,NW,W,SW,S,SE] (ranger rule).
- Still unexplored & usable later: Frames_320x320 (FLYING creature — Air_Fly/
  Air_Death/Combos), x320p_Spritesheets1234 (block-capable knight),
  coc_chars (RTS-style sheets, palette mismatch), effects/*.png spell
  sheets, vfx/Effect_* (BloodImpact, SmallHit/BigHit 30/60fps trees).
- Library decision: NO new deps — Pixi v8 + the existing depthKey/rebake
  pipeline already covers sorting/movement/frames; an isometric lib would
  duplicate engine code.

### 5. Cheat menu overhaul
- Redesigned as the "Forbidden Arts" panel: ANIMATED idle knight portrait
  (pre-extracted canvases, 180 ms cadence, cropped feet-down), 2×2 powers
  grid, categorized arsenal browser (WEAPONS/ARMOR/RELICS tabs) with its
  own scroll region, per-item give buttons with real icons + rarity edges,
  "TAKE ALL <category>" — nothing clips or overflows at any item count.
- Hooks now: giveItem(id) + items() metadata + portraitFrames().

### Verified live (fresh tab, seed 42)
Zero console errors across all scenarios. Floor 1 + XX visibly brighter;
no fire objects anywhere; mist subtle; CRIT! banner fired (gold, above the
doubled 6); Sentinel fights on floor 4; dragon looses bolts at XV; orc king
at XX attacks, dies, and leaves his sprawled corpse + rare drops; archer
kites visibly and stops retreating at walls; cheat tabs/give-all verified.

### Gotchas
- The 320-px packs bake at ~source size regardless of rebake scale — ALWAYS
  measure `body.texture.width` live and calibrate the def scale to it.
- After an HMR reload of SpriteLibrary-heavy modules the canvas can boot
  as a WHITE screen (texture bakes race the reload in an occluded tab).
  It is transient: hard-reload the tab. Production builds don't HMR.

## 2026-08-31 (iteration 12) — Light, mob variety, combat text, cheats, 20-floor arc

### 1. Warm hero light (user: "harsh darkness")
- `config`: FOG_RADIUS 7→8, LIGHT_FULL_RADIUS 2.6→3.4.
- Additive warm halo sprite (`playerHalo`, tint 0xffa050) rides the hero's
  interpolated position in the ambience layer, breathing gently.
- Scene-tint floors raised: enemies minBase 0.35→0.5 (dim-neutral fallback
  0x6b6472), player 0.55→0.7. Entities are readable in every corner now.

### 2. New mob packs (user: "stop showing only knights!")
- **Rotting Ghoul** (zombie kind): dedicated `/assets/zombie` pack — real
  WALK/IDLE/ATTACK/DYING cinematics, 8 directions, rebaked 0.28. NOTE: the
  rebaked frames are 512×512 canvases; sprite scale 0.26 (NOT ~0.8) puts the
  ghoul just above knight height. anchorY 0.78.
- **Dread Archer** (archer kind): `/assets/x320p_Spritesheets` ranger pack —
  Idle/Run/Attack(draw-and-loose)/Hit/Death bow sheets, 320px cells,
  `ownShadow: true` (no baked shadow). Cells stayed 320px → scale 0.3.
- Fallen/skeleton remain palette-tinted knight variants (full anims).
- Animated **bonfire** (16-frame vfx pack loop, 12 fps) replaces the
  procedural brazier pedestal; brick **stairs** sprite from the Stairs pack
  (black background chroma-keyed to alpha on a canvas at load — the sheet
  ground is OPAQUE black).

### 3. Floating combat text + weapon math
- `render/DamageText.ts`: pooled Pixi Text; enemy dmg bone-white, player dmg
  blood-red, crits large gold, misses small grey. Crit styling rides a
  `lastCritTarget` remembered from `combat:swing` (emitted just before
  `entity:damaged`).
- Damage already flows through per-weapon min/max, family crit chance,
  armor-flat-reduction (min 1) — numbers shown are post-armor.

### 4. Cheat menu (F1 / backquote)
- `ui/CheatMenu.ts` + hooks in main: God Mode (enforced inside
  `CombatSystem.dealDamage`, survives floor transitions via `cheatState`),
  Full Heal, Give All Items, Slay Visible Enemies (fog-gated 99999 through
  the legal damage path), Reveal Floor (`lighting.revealAll()` + minimap).

### 5. Exact game arc: 20 depths, unique boss every 5
- `MAX_DEPTH = 20`. Depth V: **The Tomb Warden** (unstaggerable spin).
  Depth X: **The Frost Warden** (hits apply 3 s slow — `player.applySlow`,
  speedMult ×0.55, icy tint). Depth XV: **The Ember Warden** (ranged
  fire-bolt caster, `projectile: 'bolt'`). Depth XX: **The Hollow King**
  (1.5×, summons 2 Ember Wretches at half hp via `summonMinions` dep).
- Boss bar shows the specific boss's name on first sighting. Level select
  caps at XX and names each keeper. Standing on the depth-XX stairs after
  the Hollow King falls shows the "THE CRYPT IS CONQUERED" victory banner.

### 6. Speed, blood, corpses, vector purge
- PLAYER_SPEED 3.9→4.3.
- `leaveCorpse` rework: the death animation's LAST frame (per renderDir)
  stays as a permanent ground-layer corpse + 2 randomized dark-red splat
  stains, both `lighting.registerProp`-managed.
- Ground drops of non-pack gear now use `itemIconTexture` (generated pixel
  icons) — the vector diamond glyphs are gone. Loot light-tint is now
  light-only (icons are pre-colored).

### Verified live (fresh tab, seed 42)
Zero console errors on boot and after every scenario. Damage numbers (hit/
miss/99999), cheat menu buttons all functional, ghoul/archer scale + facing
correct, bonfire animating, keyed stairs clean, corpse + stains persist
after despawn, Frost slow measured (slowTicks 155, speedMult 0.52), Ember
Warden verified at XV, Hollow King summons verified (2 Wretches at half hp),
victory banner fired on the depth-XX stairs.

### Gotchas for future agents
- `player.warpTo` does NOT refresh fog — call `lighting.updateVisibility`
  after a scripted teleport.
- Rebake results differ per pack: measure `body.texture.width` in the live
  game before trusting a sprite `scale` (zombie 512px, ranger 320px cells).

## 2026-08-31 (iteration 11b) — Boss floors (user-directed) + temple lift

- Temple floor darkening overlay 0.62→0.46 (user: floors were too dark).
- BOSS FLOORS: every 5th depth is "the warden's crypt" (level-select hint
  included). Thinner regular packs; **The Tomb Warden** spawns before the
  stairs: 1.35× blood-crimson knight, 420 hp (scaling per 5 floors),
  16–26 damage, 54-tick telegraphs into the MeleeSpin arena sweep,
  hitRecoveryTicks 0 = unstaggerable.
- The stairs are BARRED while the Warden lives (tutorial hint on attempt);
  its death drops 3 guaranteed rares in a circle, fires the glint, an
  8-strength camera kick, and the gold "THE WARDEN FALLS" banner.
- Boss health bar (#boss-bar) reveals on first sighting, tracks hp, hides
  on death. World carries `boss`/`bossSeen`.
- Verified at ?depth=5: gate held, fight engaged (bar shown, player bled
  85→71), scripted kill dropped falcon_edge + gravecleaver + dawnhammer,
  banner fired, stairs descended to DEPTH VI. Zero console errors.

## 2026-08-31 (iteration 11) — Map purge, mob validation, QoL, level select

### Purges (zero-tolerance quality rules)
- Crate props REMOVED: the Boxes sheet is diamond-packed; my grid-guess
  crops produced the "glitchy boxes". Dropped until frames are mapped.
- Temple material re-sampled from a clean, fully-opaque region of the DEMO
  render (the raw kit tiles have transparent diamond corners → the streak
  artifacts on depth-3 floors). Depth III now reads clean obsidian halls
  with gold-brick walls.
- LoP skeleton mobs PURGED (static attacks violated the animation mandate):
  ALL four enemies are knight-sheet variants with full attack/hit/death
  animations — Ember Wretch (0.68×, ember), Risen Blade (0.78×, bone),
  Hollow Knight (0.88×, dusk), Dread Archer (0.76×, frost — the CastSpell
  sheet IS its draw-and-loose, synced to the arrow's strike frame).
  Idle enemies play live idle frames (no frozen statues anywhere).

### Animation smoothness
- Direction HYSTERESIS (`stableDir`, 32° threshold) for the player and all
  sprite mobs — kills the sprite-flip jitter when running along diagonal
  sector boundaries (the main source of "jittery running").
- Weapon slash arcs now scale by family (katana whisper → halberd sweep)
  and blend the weapon's identity color on hits.

### Interaction & UI QoL
- E is now INTERACT: nearest of ground loot / unopened chest gets the
  walk-up-and-use. Chests glow with a pulsing gold halo and show an
  "E — OPEN" chip when the player is within 2.2 tiles.
- Inventory stacks duplicates (quantity badge, first-instance equip) and
  every icon is now real art or a generated pixel icon (`ui/itemIcons.ts` —
  canvas-drawn 14×14 pixel shapes: bow/helm/shield/chest/legs/cloak). The
  diamond-gem placeholders are gone.
- LEVEL SELECT (L): jump between unlocked depths; best depth persists via
  localStorage (guarded). Unlocks on every real descend.

### Bug fixes
- Invisible-when-cornered enemies: fog gating now falls back to 4-neighbor
  visibility when an entity's center drifts onto an unseen wall tile
  (knockback/separation corner case), with a dim-neutral tint fallback.

### Verified (seed 777)
Depth III clean; stacking badge + pixel bow icon + katana icon in the grid;
L-menu with three themed rows; instant jump to Depth I; E-interact opened a
chest from the prompt (2× Doombringer!); zero console errors; typecheck clean.

## 2026-08-31 (iteration 10b) — Full arsenal + temple depths (user-directed)

User decisions: full weapon arsenal; Temple Kit as the DEEP-floor tileset;
pacing untouched pending their playtest.

### The arsenal (items/catalog.ts)
Five weapon families with distinct combat character (WEAPON_FAMILY):
- katana: fast (12/14 ticks), 18% crit, short reach.
- axe: heavy chop (22/26), high damage.
- mace: 18/24, EVERY hit staggers (forceStagger bypasses the threshold).
- polearm: reach 1.9–2.0 — strike before they close; swings the spin anim.
- blades/bows/wands unchanged.
Nine new items (War Axe → Dawnhammer → Warden Halberd → Falcon Edge…), every
one with its REAL oubliette pixel icon in the grid AND on the ground
(icon glyphs light-tinted only — their own colors stay true).
Combat honors per-weapon crit, stun, and reach; strike reach auto-extends
past selection range (livelock rule); approach range = weapon reach.

### Temple depths (floors 3+)
The Temple Kit's brickwork (sampled from the kit sheet, re-baked into a
repeatable texture) fills floors/walls under a heavy cool retint —
obsidian-and-gold-vein temple halls, unmistakably deeper than the stone
crypts of floors 1–2. `?depth=N` debug param starts on any floor.
Verified live at DEPTH III: distinct theme, zero console errors.

## 2026-08-31 (iteration 10) — Critical overhaul: anims, environment, grid UI

New packs discovered on rescan: Boxes (crates), Copings, Temple Kit,
oubliette_weapons (172 pixel weapon icons).

### Animation enforcement (no half-baked mobs)
- The warrior-zombie was DISCARDED (no attack frames) → the tank is now the
  **Hollow Knight**: knight sheets tinted corrupted dusk (0x77606a, ×0.88) —
  full Run/Idle/Melee/TakeDamage/Die animations, verified mid-swing live.
- Demo skeletons (fallen/skeleton/archer) got an ANIMATED attack: slow
  walk-cycle steps through the rear-back, then a violent forward surge —
  no more frozen-statue strikes. Death/hit frames generalized to any
  frame count via `lib.anim(name).frameCount`.
- Pacing: PLAYER_SPEED 4.5→4.0 t/s; run stride 7.5→5 frames/tile (~1
  cycle per 3 tiles — grounded cadence); enemy strides −25%.

### Environment from packs
- Walls now TEXTURE-FILL the pack's stone with per-face directional shading
  (`AssetManager.buildStoneWall`) — architecture and floors share one
  material. Procedural flat walls retired (fallback only).
- Blue arcane floor runes DROPPED (palette discipline — they fought the warm
  tone); waystone glow shifted violet→warm gold; rooms gain dark-variant
  wooden crates from the Boxes pack (edge-hugging clutter, fog/lit).
- Crisp SVG data-URI cursor (dark steel blade, gold edge) replaces the
  default arrow on the canvas.

### Inventory: icon grid + extracted stats
- Equipment = labeled 3×2 slot cells; backpack = scrollable icon grid.
  Weapons show REAL oubliette pixel icons (nearest-rendered <img>); armor
  shows crisp item-colored gems; rarity colors the cell border.
- Stats moved OUT of the panel entirely: an always-visible "DMG x–y · ARM z"
  readout beside the health orb (`#char-stats`, owned by InventoryUI).

### Combat finalization
Hybrid controls + weapon-timing + hit feedback declared LOCKED. All four
mobs verified with working attack presentation; Hollow Knight caught
mid-Melee-frame at tick 23/44 in the live build. Zero console errors.

## 2026-08-31 (iteration 9) — Palette discipline, pacing, inventory, full replacement

Directive: strict palette cohesion (drop assets rather than break harmony),
slower deliberate animation, inventory overflow fix, replace ALL placeholder
characters with disciplined pack variants.

### Palette & cohesion
- Lords-of-Pain textures now load with NEAREST scaling — upscaled pixel art
  is crisp and chunky (GBA-style) instead of blurry linear smears. The stone
  floor texture stays linear (it downsamples).
- The knight is SCENE-LIT (tint = armor tint × Lighting.getTintAt, floor
  0.55): the hero no longer glows white in darkness; he sits in the same
  light language as the world.
- ALL enemies are now pack sprites with palette-disciplined identity tints
  (multiplied under scene light): Ember Fallen (warm 0xffa070 skeleton,
  ×1.9), Rotting Soldier (the armed LoP warrior at 0x94b072 rot-green,
  ×2.5, real idle frames), Risen Skeleton (bone, ×2.2), Bone Archer
  (frost 0xbcd4ff, ×2.05). Crystal markers remain only as load-failure
  fallbacks. Zombie deaths reuse the skeleton collapse (tinted) — reads as
  flesh sloughing off; no static despawns anywhere.

### Animation pacing
- Walk/run cycles advance BY DISTANCE COVERED (stride frames-per-tile), not
  per frame — foot-sliding eliminated for knight and all sprite enemies.
- Slower everything: knight idle 12→7 fps, hit 30→24; blade timing 16/22
  (0.63 s swings), bow 24/18, wand 26/20; enemy windups +4–6 ticks; death
  collapse 45→52 ticks; glint 14→10 fps; gold loop 8→5 fps. Idle sprites
  breathe (±1.5% scale) so nothing reads as a frozen prop.
- PLAYER DEATH uses the knight's Die sheet: 80 ticks of collapse where he
  fell, then respawn at the entrance. Verified frame-by-frame in-browser.

### Inventory overhaul
- Backpack lives in a dedicated SCROLLABLE compartment (max-height, styled
  thin scrollbar, item count in the header); preview + equipment + stats
  stay fixed — a full pack can no longer push content off-screen.
- Paperdoll preview now renders the ACTUAL knight (facing camera, live
  armor tint) with item-colored gems marking worn slots.

### Asset utilization
- Pack tile highlight (gold-tinted) replaced the procedural path marker.
- Rare drops fire the treasure glint at their landing spot.

### Verification (seed 1234, dedicated tab)
Crisp skeletons in combat; scene-lit knight; knight preview in the panel;
death → sprawled Die frames under "YOU HAVE FALLEN" → clean respawn (idle,
full hp, at spawn); zero console errors; strict typecheck clean.

## 2026-08-31 (iteration 8) — External asset packs, chests, run timer

### Asset packs integrated (skills/external-sprite-pipeline.md)
- **The player is now the HD Knight** ("2D HD Character Knight"): 8-direction
  15-frame sheets for idle/run/two melee swings/spin/cast/hit — sliced from
  1920×1024 grids into shared-source textures. Direction rows calibrated
  in-game (they were the exact reverse of our canonical order). Weapon
  variety is visible: blades alternate two swing anims, Doombringer does the
  spin attack, bows/wands play the cast; worn armor tints the model.
- **Skeleton enemy** ("Lords of Pain"): real 8-dir walk + a true death
  animation (collapse frames, then fade → corpse stain). No attack frames in
  the demo pack, so the procedural rear-back telegraph plays on the sprite.
  Scale 2.3 — at 1.7 the thin dark bones vanished against the stone.
- **Real stone floors**: the pack's seamless square stone texture fills our
  tile diamonds through per-variant offset matrices (crack pass kept).
- **Glint VFX, gold-pile decor (animated loop), loot indicator** wired into
  Ambience/Props; everything falls back to procedural art on load failure.
- Loading gate: "FORGING THE DEPTHS" overlay while ~150 files fetch.

### Lootable chests (`systems/Chests.ts`)
Seeded placement (~45% of rooms), bobbing loot indicator, click → walk-up →
OPEN_CHEST through the command queue → `chest:reached`/`chest:opened`
events → 2–3 guaranteed rarity-weighted drops + glint + camera kick.
Verified: chest opened, spilled plank_shield + rusty_sword, glow art swap.

### Floor run timer
`#timer` (top center) counts sim ticks since floor entry (deterministic);
resets on descend; the descend banner gains "Depth N delved in M:SS".

### Enemy roster is now 4 distinct behaviors
fallen (fast coward) / zombie (tank) / bone archer (kiting shooter) /
skeleton (sprite-animated mid-speed melee) — mixed per floor.

### Verification (seed 1234, dedicated tab)
Pack load clean (zero 404s/errors); knight runs with correct facings after
row calibration; skeleton fight: chase → telegraph → hit-flash → death
animation caught mid-collapse; chest loop end-to-end; timer at 0:29 on the
HUD; typecheck strict clean. Test-harness note: holding SPACE roots the
player through chained swings — release it in scripted tests before pathing.

## 2026-08-31 (iteration 7) — Ranged combat, minimap, live paperdoll, polish

### Player ranged combat
Weapon families (`WeaponKind`: blade/bow/wand) with per-family attack timing
(WEAPON_TIMING — shared by simulation AND animation), firing range, and
paperdoll art. ProjectileSystem generalized to factions: player arrows and
wand bolts collide with enemies (pure-sim `findEnemyAt`, NOT fog-gated),
enemy arrows with the player; rolls stay in CombatSystem
(`projectileHitEnemy`). Ranged strike frames loose toward the target's
position at release (dodgeable); air shots go along the facing. Click-attack
with a bow approaches only to firing range WITH line of sight; held SPACE
auto-targets at weapon range (fog-visibility = player LOS). New items:
Short Bow (starter), Hunter's Bow, Emberwand (magic bolt, additive glow).
`projectile:impact` event drives sparks (bolts) / dust (arrows off stone).

### Minimap (`ui/Minimap.ts`, closes the minimap sub-task)
Top-right canvas, M to toggle: renders ONLY fog-revealed tiles (explored
shadow vs currently-visible brighter), stairs in gold once discovered,
pulsing player dot. Base layer redraws only on `player:tileChanged`
(markDirty); per-frame work is one drawImage + one dot.

### Live paperdoll preview
The inventory panel renders the actual character rig (body + equipped,
tinted overlays) via `renderer.extract.canvas` on every inventory change —
equipment changes appear simultaneously in the panel preview and on the
in-world sprite. Verified with the Short Bow: both updated in one click.

### Animation polish round 2
Bow/wand DRAW animation (fast pull to full draw, tension hold, 2-tick snap
release) distinct from melee swings; footstep dust puffs on each hop
landing (`Ambience.puff`, `player.onStep`); idle breathing when standing;
crit spark bursts at the victim. Burst particles gained per-particle base
alpha (low-energy dust vs full blood).

### Verified (seed 1234, dedicated tab, deterministic steps)
Bow equip → panel preview + world sprite update together; arrows seen in
flight; a zombie shot 85→26 at range; a fallen shot to 1 hp FLED (flee AI
under arrow fire); wall-hidden enemies correctly untargetable; minimap grew
with exploration; zero console errors; strict typecheck clean.

### Sub-agent docs
sub_tasks/README gained a system-blueprint table mapping every pillar to
its owner modules + skill doc; minimap marked done; three new scoped specs:
health-potions, gamepad-support, floor-themes.

## 2026-08-31 (iteration 6) — Controls, weight, lighting math, onboarding

User directive: reject endless-click combat (hybrid BG:DA-style buttons),
fix floating/sliding animation with real weight, fix lighting that darkens
lit objects, add tutorial objects, lock the pillars down for sub-agents.

### Hybrid action controls (skills/hybrid-action-controls.md)
SPACE/F = auto-targeted swing (held = keep swinging; whiffs the air when
nothing is near), E = grab nearest loot, WASD+buttons = full keyboard play;
mouse targeting unchanged. A pulsing red target ring shows exactly which foe
is being struck at all times. New commands ride the deterministic queue.

### Animation weight (skills/animation-weight-and-impact.md)
Grounded shadows split from bodies (the root cause of "floating"); hop-cycle
walk with squash & stretch and movement lean; anticipation→whip→follow-through
swing curves; IMPACT FRAMES (5-frame pose hold on landed hits); camera kick
on every contact; blood bursts with gravity. Waystone/marker art detailed up.

### Lighting correction
Walls are now lit by the brightest ADJACENT VISIBLE FLOOR they face (south/
east neighbors), not by their own tile center — the own-tile model sat walls
~1 tile deeper in the falloff and made them read wrongly dark beside bright
floor. Enemy minimum readability light raised 0.25→0.35.

### Tutorial layer
Floor-1 waystone (glowing prop + light source) anchors proximity hints;
banner UI (ui/Tutorial.ts) shows once-per-session hints: movement, striking,
stairs, loot drop, inventory, first-wound telegraph tip.

### Combat livelocks found & fixed by deterministic testing
1. **Player perma-stunlock:** 3-damage Fallen taps chain-interrupted every
   14-tick windup — the player literally could not swing against a pack.
   Fix: player poise (stagger only from post-armor hits ≥ 8, recovery 10).
2. **Whiff-forever:** button auto-target range (1.55) exceeded strike reach
   (1.35) — a foe at 1.5 was selectable but unhittable, forever. Fix:
   STRIKE_REACH 1.7 ≥ selection range. Rule documented.
3. **Doorway deadlock:** A*'s no-corner-cut refuses the final diagonal, and
   pure straight steering wall-blocks — either alone stalls the enemy just
   out of reach. Fix: straight steering first, A* fallback on zero movement.

Verified (seed 1234, deterministic steps): full keyboard run — WASD approach,
held-SPACE engagement with target ring, poise-enabled trades, zombie killed
at ~13.5 s, player winning at 116/140; hint banner, waystone, wall lighting
and shadows confirmed on screenshots; zero console errors; typecheck clean.

## 2026-08-31 (iteration 5) — Milestone 4: classic-ARPG-grade combat + dungeon depth

User feedback (verbatim): "it doesn't look like a combat system at all, need
much more improvements" + "dungeon depth and enemies AND finally add animated
fight system, make it as complex as in the original classic ARPG game."

### Combat rewritten around the D1 action model
See skills/action-combat-model.md for the full write-up. Headlines:
- Attacks are animated WINDUP → strike-frame → RECOVERY actions on a shared
  `Entity.action` state machine; range re-checked at the strike frame makes
  telegraphed attacks dodgeable; move orders cancel windups.
- To-hit rolls, weapon min–max damage ranges, 10% ×2 crits, knockback,
  hit-recovery stunlock (per-type recovery ticks), all from a seeded stream.
- Visible language: weapon-arc swing animation on the paperdoll main hand,
  outcome-tinted slash arcs (warm/fiery/grey), rear-back enemy telegraphs,
  flinch jitter, blood particle bursts, topple-and-fade deaths leaving
  corpse stains, left/right facing via rig mirroring.

### Enemy roster (ENEMY_TYPES)
fallen (fast, weak, flees below 30% hp) / zombie (slow, 8–15 dmg, nearly
unstaggerable) / bone archer (kites to 3.2–6.5 range, real arrows via the
new pooled ProjectileSystem — dodgeable in flight). Packs of 2–4 per room;
floor scaling: hp ×(1+0.35·(floor−1)), damage +2/floor.

### Dungeon depth
Stairs (in the room farthest from spawn) descend to a fresh seeded floor.
main.ts was restructured into buildWorld/destroyWorld: the Player, HUD,
InputQueue, and GameLoop persist; everything else is per-floor and torn
down cleanly (event unsubscribes, input aborts, pool destroyAll, viewport
destroy with the player's container re-parented first). DEPTH roman-numeral
label + gold "YOU DESCEND DEEPER" banner.

### Cleanups
- utils/rng.ts is now the ONLY mulberry32 (deduped from 4 copies).
- Lighting.registerProp safe at runtime (adopts the tile's current fog
  state) — needed for corpse stains on visible tiles.
- Enemy–enemy pairwise separation (EnemyPool.separate) — no more stacking.

### Verification (dedicated second browser tab; the user kept playing in theirs)
Deterministic loop.step run-through on seed 1234: pack aggro → telegraphs →
mutual stunlock exchanges (player 85→49, zombie 85→52→22) → player death →
respawn; blood bursts and corpse stains on screen; descend → DEPTH II with
25 scaled enemies incl. archers; archer LOS-gated aggro, draw, arrow seen in
flight, arrow damage landed. Zero console errors; strict typecheck clean.

### Testing-infrastructure gotchas (for future agents)
- Synthetic PointerEvents get `offsetX = clientX / devicePixelRatio` in
  Chrome (trusted events are unaffected) — measure the scale with a probe
  event and pre-multiply, or tests silently click the wrong tile.
- A "failed" click may just be an unwalkable target: check
  `scene.isWalkable` before blaming the input path (cost 20 minutes here).

## 2026-08-31 (iteration 4) — Dramatic lighting effects + Milestone 3: Items & Paperdoll

User decisions: M3 items/paperdoll next; death stays free for now; atmosphere
should get MORE dramatic (colored sources, stronger flicker, more particles).

### Colored static light sources (`Lighting.addSource`)
Per-tile RGB contribution maps (Float32Array ×3) baked at scene build with
quadratic falloff; composed additively over the torch ramp each frame with an
independent source-flicker rhythm. `getTintAt(x,y)` now returns the fully
composed colored tint for dynamic objects (enemies, loot). Torch flicker
amplitude was also increased (~2×).

### Props (`scenes/Props.ts`)
Seeded placement: braziers (70% of rooms, corner, warm 235/110/24 source,
pulsing additive glow, ember hotspot) and arcane floor runes (35% of rooms,
cold 80/60/235 source, additive glyph + halo). Props register with Lighting
for fog gating/tinting (`registerProp`) and never block movement or sight.
Ambience motes went 40→64 with 35% biased to spawn off brazier coals.

### Milestone 3 — items, loot, inventory, paperdoll
- `items/catalog.ts`: 11 items across all 6 slots, 3 rarities (60/30/10 roll,
  60% drop chance), damage/armor stats, per-item colors. Pure data.
- `systems/Loot.ts`: ground items from a dungeonSeed-derived RNG stream
  (kill-order deterministic), rendered as rarity glow + item-colored glyph,
  bobbing, fog-gated, scene-lit. Screen-space click picking.
- Flow: click loot → PICKUP command → MovementSystem approaches →
  `item:pickupArrived` → backpack. Click priority: enemy > loot > ground.
- `systems/Inventory.ts` + `ui/Inventory.ts`: the DOM panel (I key) enqueues
  EQUIP/UNEQUIP commands — equipment changes ride the deterministic queue
  like every other intent. Includes the item stat tooltip (closes the
  item-tooltip sub-task in spirit; spec's standalone module folded here).
- Paperdoll: equipping instantly mounts a tinted overlay sprite (blade,
  shield, helm, chest band, greaves, mantle) on the body. KEY TRICK: Pixi's
  generateTexture trims to drawn bounds, so overlay canvases are pinned with
  two ~invisible corner dots to keep 1:1 alignment with the body sprite.
- Combat integration: swing damage = base + weapon; armor is flat reduction
  applied inside `dealDamage` (min 1). Player starts with a Rusty Sword.

### Verification & incidents
- Verified in-browser (seed 42): equip via panel → Damage +4 + visible blade;
  enemy killed; a magic-rarity Soldier Blade dropped with correct glow.
- Mid-verification the USER started playing the live build — enemy kills,
  deaths, and drops all happened organically with zero console errors, which
  is the best kind of test. Automation was stopped immediately to not fight
  the player for input.
- Chrome automation note: the extension's `key` action didn't trigger the
  I-key toggle (likely missing `KeyboardEvent.code`); real keyboards work.
- Known polish gap discovered in live play: enemies separate from the player
  but not from EACH OTHER (two corpses-to-be stacked on one tile). Logged in
  the checklist backlog.

## 2026-08-31 (iteration 3) — Lighting overhaul, cutaway walls, AAA HUD pass

User feedback driving this iteration: lighting incorrectly darkened lit
objects; walls must never hide the player; raise the art direction to a
handcrafted dark-fantasy standard (fonts, particles, animation); show
controls on screen; keep closing checklist items.

### Lighting rewritten: overlay → tile lightmap (`engine/Lighting.ts`)
Root cause of the "wrongly darkened" bug: the fog OVERLAY model. A black
diamond only covers its own tile's ground footprint, so any sprite taller
than one tile (every wall, every unit) was darkened by the NEIGHBOR tile's
fog diamond — lit walls rendered with black tops. Replaced with classic ARPG's
model: per-tile light values applied as sprite tints (see
skills/tile-lightmap-and-cutaway.md). Wins:
- Objects are lit exactly once, regardless of height — bug class eliminated.
- Warm→cool color ramp + torch flicker + falloff from the CONTINUOUS player
  position: light glides instead of stepping. Atmospheric by construction.
- The whole fog sprite layer (1,936 sprites + pad ring) is gone.

Follow-up fixes found by browser verification:
- HIDDEN tiles must be `visible=false`, not black-tinted — black silhouettes
  against the #07070a background leaked the dungeon layout.
- The lightmap exposed a latent pool bug: EnemyPool's priming loop did
  acquire→release on the SAME instance 8 times (LIFO pool), so preallocated
  enemies kept construction-default visibility at world (0,0). The old fog
  overlay had been hiding them since M1. Fix: Enemy constructs despawned;
  priming loop deleted.

### Cutaway vision
Walls whose depth sorts in front of the player AND whose screen rect overlaps
the player's body ease to WALL_FADE_ALPHA (and back) with exponential
damping. Scan window: 9×9 tiles around the player per frame. Verified: player
fully visible standing behind south walls.

### Combat loop completion (M2 leftovers)
- Enemies strike back: 8 dmg every 1.2 s at melee range, routed through the
  same `CombatSystem.dealDamage` via an injected `attackPlayer` dep.
- Player death → "YOU HAVE FALLEN" epitaph → respawn at the dungeon entrance
  with full hp (explored map retained). Verified in-browser.
- Entity separation: enemies push out to 0.55 tiles so bodies never stack.
- Feedback: player hit-flash, attack lunge toward the target on each swing
  (`combat:swing` event), walk-bob while moving.

### Art direction & HUD
- Fonts: Cinzel (headers/labels) + IM Fell English (body) via Google Fonts,
  with serif fallbacks. Chosen as the closest quality webfonts to classic ARPG's
  Exocet spirit.
- classic-ARPG-style health orb (CSS sphere with liquid fill + gloss + low-hp
  pulse), COMMANDS panel listing every control with kbd chips and
  active-mode highlighting, blood-red death title, cinematic vignette.
- Ambient ember motes: 40 additive-blend particles drifting up through the
  torchlight, brightness = life envelope × local light (never visible in
  darkness). Render-side only.

### Verification (seed 42, deterministic loop.step driving)
Torch gradient + flicker correct; no silhouette leaks; cutaway fade shows
the player through south walls; enemy chased, engaged, damaged the player
(orb drained live); death/respawn cycle clean; zero console errors; strict
typecheck clean.

## 2026-08-31 (later) — Milestone 2: melee combat + chase AI

User decisions (via clarification round): classic ARPG deliberate combat pacing;
art will arrive as sprite sheets + JSON atlases; combat/AI prioritized next.

### What shipped
- `ATTACK` command flow: screen-space enemy picking in InputBindings →
  MovementSystem approach (throttled re-path, stop at ATTACK_RANGE 1.2) →
  CombatSystem auto-swing (12 dmg / 48-tick cooldown) → `entity:damaged` /
  `entity:died` → EnemyPool release. `dealDamage` remains the sole hp mutator.
- Enemy AI: idle/chase state machine, aggro = radius 6 + Bresenham LOS,
  re-path at most every 30 ticks and only on goal-tile change, 3 s LOS-loss
  give-up, 60% player speed. Health bar + hit-flash visuals.
- Dev tooling: `?seed=N` pins the dungeon; `window.__game` (DEV only) exposes
  state/loop/camera; `GameLoop.step(n)` advances the sim deterministically —
  used for automated browser verification and ready for replay tests.

### Bugs caught by deterministic browser testing
1. **AI frozen by a render flag (severe).** `Enemy.update` early-returned on
   `container.visible`, which fog gating toggles at render time — hidden
   enemies never thought, and with rAF paused (occluded window) even visible
   ones froze. Exactly the sim/render coupling the architecture forbids.
   Fix: simulation-owned `spawned` flag. Rule reinforced in Enemy docblock.
2. **Ground-plane enemy picking felt broken.** First implementation measured
   click-to-feet distance in world units, so clicking the visible BODY (46 px
   tall) missed. Fix: screen-space pick against the sprite's body box via
   `Camera.worldToCanvas` — clicking any part of the enemy targets it.
3. Environment note: Chrome pauses rAF entirely for occluded windows — the
   sim halting during automation waits was NOT a game bug; `loop.step()` now
   makes tests independent of rAF.

### Verified in-browser (seed 42)
Enemy aggroed on room entry, chased to melee, click-attacked: hp 60→36 after
1 s (two swings — correct first-swing + 0.8 s cadence), despawned at 0 hp,
active pool count 5→4, zero console errors, typecheck clean.

## 2026-08-31 — Milestone 1: Core framework built from empty directory

### Architectural decisions

1. **Deterministic lockstep-ready simulation.** All player intent flows
   DOM event → `InputBindings` → serializable `InputCommand` → `InputQueue` →
   drained once per fixed tick. Simulation state is a pure function of
   (dungeon seed + ordered command stream). This is the cheapest possible road
   to 4-player co-op: the future network layer ships commands, not positions.
   Consequence: **no system may mutate entity state from a DOM handler.**

2. **Fixed timestep (60 Hz) with render interpolation** (Fiedler pattern).
   Pixi's own ticker loop is stopped; `GameLoop` drives `renderer.render()`
   manually so there is exactly one frame authority. Entities store
   `prevPos`/`pos` and render at `lerp(prev, pos, alpha)`.

3. **Single source of truth for spatial queries.** `SceneManager.isWalkable`
   / `isOpaque` are injected into Pathfinding, Collision, FogOfWar, and
   InputBindings. No module re-reads the tile grid directly.

4. **Projection math is centralized** in `src/utils/iso.ts` (4 functions).
   An early bug source in isometric projects is re-derived projection with
   sign errors; the module doc forbids re-derivation.

5. **Fog of war is event-driven, not per-frame.** Recomputes only on
   `player:tileChanged`; delta-updates only tiles entering/leaving the visible
   set. 44×44 map → worst case ~150 LOS rays per tile crossing, negligible.

6. **Walls render only when bordering floor** (~60% wall-sprite reduction).
   Interior rock is invisible by definition under fog anyway.

7. **Depth sorting** via `zIndex = (wx + wy) · TILE_H/2` in one sortable
   layer shared by walls and entities. Walls are nudged −4 so an entity
   standing on the tile just south of a wall (numerically equal depth) always
   draws in front. Documented in `utils/iso.depthKey`.

### Debugging retrospectives / error prevention

- **TS6133 unused `height` in Pathfinder** — bounds checking is fully
  delegated to `isWalkable`, so the field was dead. Removed. Lesson: strict
  `noUnusedLocals` is kept ON to catch drift between plan and implementation.
- **Corner-cutting risk:** A* forbids diagonal steps unless both orthogonal
  neighbors are walkable; collision uses a square collider sampled at 4
  corners with axis-separated resolve. Together these guarantee the path
  follower cannot wedge into a wall corner.
- **Stuck-key hazard:** `window` blur clears all held movement keys and
  enqueues STOP — alt-tabbing while holding W no longer walks you into a wall
  forever.
- **Heap overflow guard:** the A* duplicate-push strategy can exceed the
  map-sized heap only on pathological maps; pushes past capacity are dropped
  (fresher entries already ordered). No dynamic allocation on hot path.
- **NaN propagation:** `Vec2.normalize` returns zero vector for near-zero
  input instead of dividing by ~0.

### Live browser verification findings (fixed same-day)

Runtime testing in Chrome (automated: screenshots + console monitoring)
surfaced two bugs the type checker could never catch:

1. **Fog plane too small for tall sprites.** Wall blocks and unit markers
   near the map's north/west edges project up-screen past the last in-map fog
   diamond, so they rendered against the bare background while "hidden."
   Fix: `FOG_PAD = 3` ring of permanently-opaque fog sprites beyond the map
   bounds (`engine/FogOfWar.ts`).
2. **Enemies visible through shroud.** Fog diamonds alpha-occlude tiles, but
   creatures must follow the classic ARPG rule (shroud hides creatures, not
   architecture). Fix: render loop gates `enemy.container.visible` on
   `fog.isVisible(tile)`.

Verified working end-to-end in the browser: boot with zero console errors,
click-to-move pathing with destination marker + camera follow, WASD direct
mode with HUD indicator, wheel zoom (clamped), fog reveal/shroud transitions.
Note for future agents: the Chrome automation `scroll` action does not reach
canvas `wheel` listeners — test zoom by dispatching a `WheelEvent` via JS.

### Performance notes

- All textures generated once at boot via `renderer.generateTexture`; sprites
  share GPU textures (implicit batching). No Graphics objects survive boot.
- Pathfinder uses typed-array node storage + search stamps (no per-search
  clearing, no allocations except the returned waypoint array).
- Static layers have `eventMode = 'none'` — Pixi skips hit-testing ~4k nodes.
- Fog sprites: 1,936 static sprites, alpha-only mutation. If this ever shows
  in profiles, the documented upgrade path is a single Mesh with per-vertex
  alpha (see skills/fog-of-war-los.md).

### Open questions for the user (asked in status report)

- Default class archetype for solo testing (currently Warrior).
- Asset format expectations (sprite sheets? per-frame PNGs? aseprite?).
- Combat feel target: classic ARPG deliberate pace vs. faster hack-and-slash.
