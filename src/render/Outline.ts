/**
 * @module render/Outline
 * THE RIM (it.114): a thin coloured line drawn around a sprite's alpha
 * silhouette, plus an optional soft additive glow just inside it. A dark
 * spider on a dark crypt floor is a shape the eye cannot find; a one-pixel
 * cold rim around it is a shape the eye cannot miss - and in full torchlight
 * the rim's alpha is driven to zero and the filter is taken off the sprite
 * entirely (see `Enemy.syncOutline`), so the common, lit case costs nothing.
 *
 * Pixi v8 filter on the WebGL path, written like `CrtFilter`: a GLSL 300 es
 * fragment over Pixi's default filter vertex. The rim is found by sampling
 * the alpha channel of the eight neighbours at `uThickness` input texels;
 * where a neighbour is opaque and this texel is not, the rim colour is laid
 * down (premultiplied, so it composites like any other sprite pixel). The
 * inner glow is the mirror test at twice the distance: where this texel is
 * opaque and a neighbour is not, the colour is ADDED over the sprite's own.
 *
 * Units: `thickness` is in texels of the filter's input texture, which is
 * the sprite's rendered footprint at the renderer's resolution - so a rim
 * of `1 * resolution` texels is one CSS pixel on screen no matter how small
 * the rig scale is or how far the wheel is turned. `padding` must cover the
 * rim's reach or the outline is clipped at the sprite's bounds; it is kept
 * in step with `thickness` here.
 */

import { Filter, GlProgram, defaultFilterVert } from 'pixi.js';

const fragment = /* glsl */ `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec3 uColor;
uniform float uThickness;
uniform float uAlpha;
uniform float uGlow;

float alphaAt(vec2 uv) {
  return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).a;
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec2 px = uInputSize.zw * uThickness;
  // The eight neighbours at one rim width: the widest alpha around us.
  float n = 0.0;
  n = max(n, alphaAt(vTextureCoord + vec2( px.x, 0.0)));
  n = max(n, alphaAt(vTextureCoord + vec2(-px.x, 0.0)));
  n = max(n, alphaAt(vTextureCoord + vec2(0.0,  px.y)));
  n = max(n, alphaAt(vTextureCoord + vec2(0.0, -px.y)));
  n = max(n, alphaAt(vTextureCoord + vec2( px.x,  px.y) * 0.7071));
  n = max(n, alphaAt(vTextureCoord + vec2(-px.x,  px.y) * 0.7071));
  n = max(n, alphaAt(vTextureCoord + vec2( px.x, -px.y) * 0.7071));
  n = max(n, alphaAt(vTextureCoord + vec2(-px.x, -px.y) * 0.7071));
  // Outside the body, next to it: the rim.
  float rim = clamp(n - src.a, 0.0, 1.0) * uAlpha;
  vec3 col = src.rgb + uColor * rim;
  float a = src.a + rim * (1.0 - src.a);
  // Inside the body, near its edge: the glow (additive, over two rim widths).
  if (uGlow > 0.0 && src.a > 0.05) {
    vec2 px2 = px * 2.0;
    float m = 1.0;
    m = min(m, alphaAt(vTextureCoord + vec2( px2.x, 0.0)));
    m = min(m, alphaAt(vTextureCoord + vec2(-px2.x, 0.0)));
    m = min(m, alphaAt(vTextureCoord + vec2(0.0,  px2.y)));
    m = min(m, alphaAt(vTextureCoord + vec2(0.0, -px2.y)));
    float edge = (1.0 - m) * src.a;
    col += uColor * (edge * uGlow * uAlpha);
  }
  finalColor = vec4(min(col, vec3(1.0)), a);
}
`;

type OutlineUniforms = { outlineUniforms: { uniforms: { uColor: Float32Array; uThickness: number; uAlpha: number; uGlow: number } } };

export interface OutlineOptions {
  /** 0xRRGGBB rim colour. */
  color?: number;
  /** Rim width in input texels (≈ screen px × renderer resolution). */
  thickness?: number;
  /** Rim opacity 0..1. */
  alpha?: number;
  /** Additive inner-glow strength 0..1 (0 = none). */
  glow?: number;
}

/** One CSS pixel in filter texels: the app renders at min(devicePixelRatio, 2). */
export function outlinePixelScale(): number {
  return Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
}

export class OutlineFilter extends Filter {
  private colorHex = -1;

  constructor(opts: OutlineOptions = {}) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'outline-filter' });
    const thickness = opts.thickness ?? 1.5;
    super({
      glProgram,
      resources: {
        outlineUniforms: {
          uColor: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
          uThickness: { value: thickness, type: 'f32' },
          uAlpha: { value: opts.alpha ?? 1, type: 'f32' },
          uGlow: { value: opts.glow ?? 0, type: 'f32' },
        },
      },
      // The rim reaches `thickness` texels past the silhouette and the glow
      // samples twice that inside it; padding is in screen px, so a little
      // over 2× thickness covers a resolution of 2. `antialias: off` keeps the
      // filter from allocating an MSAA target.
      padding: Math.ceil(thickness * 2 + 2),
      antialias: 'off',
      resolution: 'inherit',
    });
    this.color = opts.color ?? 0xffffff;
  }

  private get u(): OutlineUniforms['outlineUniforms']['uniforms'] {
    return (this.resources as OutlineUniforms).outlineUniforms.uniforms;
  }

  /** 0xRRGGBB rim colour (cached: same value → no uniform write). */
  set color(hex: number) {
    if (hex === this.colorHex) return;
    this.colorHex = hex;
    const c = this.u.uColor;
    c[0] = ((hex >> 16) & 0xff) / 255;
    c[1] = ((hex >> 8) & 0xff) / 255;
    c[2] = (hex & 0xff) / 255;
  }
  get color(): number {
    return this.colorHex;
  }

  set thickness(v: number) {
    this.u.uThickness = v;
    this.padding = Math.ceil(v * 2 + 2);
  }
  get thickness(): number {
    return this.u.uThickness;
  }

  set alpha(v: number) {
    this.u.uAlpha = v;
  }
  get alpha(): number {
    return this.u.uAlpha;
  }

  set glow(v: number) {
    this.u.uGlow = v;
  }
  get glow(): number {
    return this.u.uGlow;
  }
}
