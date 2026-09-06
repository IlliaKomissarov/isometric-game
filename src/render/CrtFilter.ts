/**
 * @module render/CrtFilter
 * THE RETRO CRT (it.85): one full-screen pass over everything Pixi draws —
 * scanlines on the screen's own pixel rows, a gentle barrel curve with a
 * dark bezel where the glass turns away, a hair of colour fringing at the
 * edges, a soft phosphor glow, a slow flicker. The DOM HUD is untouched, so
 * the numbers stay crisp; only the crypt goes through the tube. Toggled in
 * SETTINGS · VISUALS (`visuals.crt`), off by default.
 *
 * Written against the WebGL path (the app asks for `preference: 'webgl'`):
 * a GLSL 300 es fragment on Pixi's default filter vertex. The time uniform
 * is fed in `apply`, so the filter needs no ticker of its own.
 */

import { Filter, GlProgram, defaultFilterVert, type FilterSystem, type RenderSurface, type Texture } from 'pixi.js';

const fragment = /* glsl */ `
// highp, not Pixi's mediump default: the vertex declares uInputSize highp, and a
// uniform declared at two precisions will not link.
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform float uTime;
uniform float uStrength;

// A mild barrel curve: the corners bend away, the middle stays true.
vec2 curve(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  vec2 off = abs(c.yx) / vec2(6.0, 4.5);
  c = c + c * off * off;
  return c * 0.5 + 0.5;
}

void main() {
  // Work in the filter's own 0..1 frame, then back to texture space.
  vec2 frame = (vTextureCoord - uInputClamp.xy) / (uInputClamp.zw - uInputClamp.xy);
  vec2 uv = mix(frame, curve(frame), 0.85 * uStrength);
  // Off the glass: the bezel.
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    finalColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 tc = uInputClamp.xy + uv * (uInputClamp.zw - uInputClamp.xy);
  // Colour fringing grows toward the edges.
  vec2 dir = (uv - 0.5) * 0.0028 * uStrength;
  float r = texture(uTexture, clamp(tc + dir, uInputClamp.xy, uInputClamp.zw)).r;
  float g = texture(uTexture, tc).g;
  float b = texture(uTexture, clamp(tc - dir, uInputClamp.xy, uInputClamp.zw)).b;
  vec3 col = vec3(r, g, b);
  // Scanlines on the output's pixel rows, a hair of phosphor mask across.
  float py = uv.y * uInputSize.y;
  float px = uv.x * uInputSize.x;
  float scan = 0.82 + 0.18 * sin(py * 3.14159265 + uTime * 0.5);
  float mask = 0.94 + 0.06 * sin(px * 2.0943951);
  col *= mix(1.0, scan * mask, 0.9 * uStrength);
  // A soft glow: the same picture, blurred by two taps, lifted a little.
  vec2 px1 = uInputSize.zw * 1.5;
  vec3 glow = texture(uTexture, clamp(tc + vec2(px1.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb
            + texture(uTexture, clamp(tc - vec2(px1.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb
            + texture(uTexture, clamp(tc + vec2(0.0, px1.y), uInputClamp.xy, uInputClamp.zw)).rgb
            + texture(uTexture, clamp(tc - vec2(0.0, px1.y), uInputClamp.xy, uInputClamp.zw)).rgb;
  col += glow * 0.06 * uStrength;
  // The vignette of the tube and a slow flicker.
  vec2 v = uv * (1.0 - uv.yx);
  float vig = pow(v.x * v.y * 18.0, 0.22);
  col *= mix(1.0, vig, 0.55 * uStrength);
  col *= 1.0 - 0.015 * uStrength * sin(uTime * 37.0);
  finalColor = vec4(col, 1.0);
}
`;

export class CrtFilter extends Filter {
  constructor(strength = 1) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'crt-filter' });
    super({
      glProgram,
      resources: {
        crtUniforms: {
          uTime: { value: 0, type: 'f32' },
          uStrength: { value: strength, type: 'f32' },
        },
      },
    });
  }

  set strength(v: number) {
    (this.resources as { crtUniforms: { uniforms: { uStrength: number } } }).crtUniforms.uniforms.uStrength = v;
  }

  override apply(filterManager: FilterSystem, input: Texture, output: RenderSurface, clearMode: boolean): void {
    (this.resources as { crtUniforms: { uniforms: { uTime: number } } }).crtUniforms.uniforms.uTime = (performance.now() / 1000) % 1000;
    super.apply(filterManager, input, output, clearMode);
  }
}
