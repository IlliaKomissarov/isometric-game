# Skill: Animation Weight & Impact (Fixing "Floating" Placeholders)

## What & why
Feedback: objects "awkwardly sliding or floating in the air without proper
frame-by-frame weight." The cures are classical game-animation principles
(anticipation, squash & stretch, impact frames) applied to our procedural
rigs — no sprite sheets required, and everything here transfers 1:1 when
real sheets arrive.

## The five techniques (implementation: Player.syncRender / Enemy.syncRender)

1. **Separate grounded shadows.** The #1 floating culprit was shadows baked
   into body textures — the shadow bobbed WITH the body, so nothing ever
   touched the ground. Now every unit is `shadow sprite (static, planted)` +
   `rig (animated)`. The shadow shrinks slightly as the body rises. Any new
   entity MUST follow this split.
2. **Hop-cycle locomotion with squash & stretch.** Walking is a rhythmic
   hop: `lift = |sin(phase)| · 3.5px`, `scale.y = 1 + hop·0.07 − 0.025`
   (stretch at apex, squash into the landing), plus a small lean into the
   movement direction. Sliding at constant height reads as ice skating;
   stepping reads as weight.
3. **Anticipation → whip → follow-through swings.** The windup eases in
   slowly (`p²`), the strike arc is 3 violent ticks with a body lunge, the
   recovery eases out. Constant-speed rotations read as robotic.
4. **IMPACT FRAMES (the big one).** When a strike LANDS, hold the extended
   pose dead-still for ~5 frames before follow-through. This tiny freeze is
   what makes a hit feel like it connected with something solid. Misses skip
   the hold and swish straight through.
5. **Camera kick + particles on contact.** `Camera.addKick(strength)` — a
   decaying positional punch (2.5 on dealt hits, 5 on received, +4.5 on
   crits) — plus radial blood bursts (`Ambience.burst`) with gravity so
   droplets ARC AND FALL rather than drifting.

## Rules for sub-agents
- Animation timing constants must mirror the combat state machine's tick
  constants (Player's SWING_WINDUP/RECOVER ↔ Combat's). Drifting visuals
  lie about the dodge windows.
- All of this is RENDER-side (syncRender / event handlers). Never let a
  visual effect write simulation state.
- Rotation/mirroring happens on the `rig`, not the container — the shadow
  must never rotate, mirror, or leave the ground.
- When real sprite sheets land: keep the shadow split, map anticipation/
  impact/follow-through to sheet frames, and keep the impact-frame hold.
