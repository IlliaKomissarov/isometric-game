/**
 * @module core/config
 * Global, immutable game configuration constants.
 *
 * SUB-AGENT BOUNDARY: Tuning values (speeds, radii, colors) may be edited here.
 * Structural constants (TILE_W/TILE_H ratio, FIXED_DT) must NOT change without
 * a core-architecture review — every system depends on them.
 */

/** Isometric tile footprint in screen pixels (2:1 classic diamond). */
export const TILE_W = 64;
export const TILE_H = 32;

/** Wall block visual height in pixels (extruded above the tile diamond). */
export const WALL_Z = 40;

/** Fixed simulation timestep (seconds). 60 Hz deterministic tick. */
export const FIXED_DT = 1 / 60;

/** Maximum frame time clamp to avoid spiral-of-death on tab refocus (seconds). */
export const MAX_FRAME_TIME = 0.25;

/** Dungeon grid dimensions (tiles). */
export const MAP_W = 44;
export const MAP_H = 44;

/** Player movement speed in tiles/second (grid space). Responsive but weighty. */
export const PLAYER_SPEED = 4.3;
/** COMBAT ACCELERATION (it.53): every swing, strike and shot runs this much faster. */
export const COMBAT_SPEED = 1.25;

/** Entity collision radius in tile units (used for wall sliding). */
export const COLLIDER_RADIUS = 0.28;

/** Fog of war / torchlight: sight radius around the player (tiles). */
export const FOG_RADIUS = 9;

/** Distance (tiles) within which light is at full intensity before falloff. */
export const LIGHT_FULL_RADIUS = 4.5;

/** The deepest floor; its Warden's fall conquers the dungeon. */
export const MAX_DEPTH = 20;

/** Shadow tone (cool blue-grey) tiles fade to at zero light / explored state. */
export const LIGHT_SHADOW_RGB: readonly [number, number, number] = [36, 38, 54];

/** Warm torchlight tone at full intensity. */
export const LIGHT_WARM_RGB: readonly [number, number, number] = [255, 241, 216];

/** Alpha for walls faded out because they occlude the player (cutaway vision). */
export const WALL_FADE_ALPHA = 0.32;

/** Camera smoothing factor — fraction of remaining distance closed per second. */
export const CAMERA_LERP = 6.0;

/** Camera zoom limits (mouse wheel). Rotation is permanently disabled. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.2;
export const ZOOM_STEP = 0.12;

/** Dark-fantasy palette for procedural placeholder assets. */
export const PALETTE = {
  background: 0x07070a,
  floorBase: 0x2e2a26,
  floorLight: 0x3a342e,
  floorDark: 0x232019,
  floorLine: 0x17140f,
  wallTop: 0x37333c,
  wallLeft: 0x211e26,
  wallRight: 0x2a2630,
  wallEdge: 0x121016,
  fog: 0x000000,
  pathMarker: 0x8a6f3c,
  playerWarrior: 0xb3402e,
  playerMage: 0x4a6db3,
  playerRanger: 0x4d8a4a,
  playerRogue: 0x8a5fa8,
  enemy: 0x6e1f1f,
  enemyEye: 0xd8b04a,
} as const;
