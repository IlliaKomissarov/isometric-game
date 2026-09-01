/**
 * @module engine/Viewport
 * Owns the world container hierarchy and layer contract.
 *
 * Layer stack (bottom → top):
 *   groundLayer   — floor tiles, blood decals, ground markers. No sorting.
 *   objectLayer   — walls + entities, depth-sorted every frame via zIndex
 *                   (painter's algorithm; zIndex = utils/iso.depthKey).
 *   ambienceLayer — additive atmosphere particles (ember motes, dust).
 *                   Fog of war is NOT a layer: engine/Lighting tints world
 *                   sprites directly.
 *
 * SUB-AGENT BOUNDARY: new world visuals go into one of these three layers.
 * Screen-space UI must NOT be added here — it belongs on the stage above the
 * world container so camera zoom never scales it.
 */

import { Container, type Application } from 'pixi.js';

export class Viewport {
  /** Root world container — the camera moves/scales this. */
  readonly world = new Container();
  readonly groundLayer = new Container();
  readonly objectLayer = new Container();
  readonly ambienceLayer = new Container();

  constructor(app: Application) {
    this.objectLayer.sortableChildren = true;

    // Static layers never re-evaluate children interactivity — skip hit testing.
    this.groundLayer.eventMode = 'none';
    this.objectLayer.eventMode = 'none';
    this.ambienceLayer.eventMode = 'none';

    this.world.addChild(this.groundLayer, this.objectLayer, this.ambienceLayer);
    app.stage.addChild(this.world);
  }

  destroy(): void {
    this.world.destroy({ children: true });
  }
}
