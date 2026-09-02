/* GLSL for the five passes. Kept out of scene.js so neither file is a wall.
 *
 * Every pass is deliberately cheap: no shadow maps, no post chain, no
 * framebuffer ping-pong. The most expensive thing in here is a 128x128 grid
 * with an analytic normal, which is arithmetic, not bandwidth. That is the
 * whole answer to R-027 — the page is 3D because the geometry is 3D, not
 * because it is throwing pixels around.
 *
 * The generated bay plate is used here as an ENVIRONMENT: blurred to a lod
 * where nothing in it is recognisable, and read for the colour and direction of
 * its light. It is never presented as a photograph of a place. That distinction
 * is the reason the client's two real vehicles stand in a black void instead of
 * inside it (assets/triage.json, asset_26: "never Oscar's own or Oscar's
 * premises").
 */
window.SHADERS = (function () {
  'use strict';

  var HEAD = '#version 300 es\nprecision highp float;\n';

  /* A screen-space light streak from sweep.webp, shared by the backdrop and the
   * water so the same light appears to cross the whole scene. */
  var STREAK = [
    'vec3 streak(sampler2D tex, vec2 uv, float phase, float strength) {',
    '  vec2 p = vec2(uv.x - phase, uv.y);',
    '  if (p.x < -0.5 || p.x > 1.5) return vec3(0.0);',
    '  vec3 s = texture(tex, fract(vec2(p.x, p.y))).rgb;',
    '  float edge = smoothstep(0.0, 0.25, p.x) * (1.0 - smoothstep(0.75, 1.0, p.x));',
    '  return s * edge * strength;',
    '}',
  ].join('\n');

  var QUAD_VS = HEAD + [
    'in vec2 aPos;',
    'out vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}',
  ].join('\n');

  var BACKDROP_FS = HEAD + STREAK + '\n' + [
    'uniform sampler2D uEnv;',
    'uniform sampler2D uSweep;',
    'uniform float uProgress;',
    'uniform vec2 uSize;',
    'in vec2 vUv;',
    'out vec4 outColor;',
    'void main() {',
    // Blurred past recognition and pushed almost to black: what survives is the
    // shape and colour of the light, which is all this plate is here to supply.
    '  vec2 uv = vUv * 0.82 + 0.09 + vec2(uProgress * 0.06, uProgress * -0.04);',
    '  vec3 env = textureLod(uEnv, uv, 4.5).rgb;',
    '  float luma = dot(env, vec3(0.299, 0.587, 0.114));',
    '  vec3 base = mix(vec3(luma), env, 0.35) * 0.34;',
    '  base *= vec3(0.86, 0.90, 1.08);',
    '  base += streak(uSweep, vUv, uProgress * 2.1 - 0.55, 0.30);',
    '  float aspect = uSize.x / uSize.y;',
    '  vec2 v = (vUv - 0.5) * vec2(aspect, 1.0);',
    '  base *= 1.0 - smoothstep(0.28, 0.86, length(v));',
    '  outColor = vec4(base, 1.0);',
    '}',
  ].join('\n');

  var WORLD_VS = HEAD + [
    'in vec3 aPos;',
    'uniform mat4 uViewProjection;',
    'uniform mat4 uModel;',
    'out vec3 vWorld;',
    'out vec2 vUv;',
    'void main() {',
    '  vec4 world = uModel * vec4(aPos, 1.0);',
    '  vWorld = world.xyz;',
    '  vUv = aPos.xy * 0.5 + 0.5;',
    '  gl_Position = uViewProjection * world;',
    '}',
  ].join('\n');

  var FLOOR_FS = HEAD + [
    'uniform vec3 uEye;',
    // 1 on a landscape viewport; below 1 when the camera has been backed off to
    // hold the horizontal field on a portrait one, so the haze does not thicken
    // just because the eye moved.
    'uniform float uFalloff;',
    'in vec3 vWorld;',
    'out vec4 outColor;',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453);',
    '}',
    'void main() {',
    '  float dist = length(vWorld - uEye);',
    // Two soft columns of reflected shop light running down the floor, the same
    // two bars the environment plate is lit by. Broken up by a stretched noise
    // so the concrete reads wet rather than polished.
    '  float bars = exp(-abs(vWorld.x - 6.5) * 0.55) + exp(-abs(vWorld.x + 6.5) * 0.55);',
    '  float wet = 0.55 + 0.45 * hash(floor(vec2(vWorld.x * 3.0, vWorld.z * 0.35)));',
    '  float speckle = hash(floor(vWorld.xz * 5.0)) * 0.06;',
    '  float fade = exp(-dist * 0.030 * uFalloff);',
    '  vec3 color = vec3(0.52, 0.58, 0.78) * bars * wet * 0.20 * fade;',
    '  color += vec3(0.10, 0.11, 0.16) * speckle * fade;',
    // Nearly opaque underfoot and dissolving into the environment haze at
    // distance, which is what gives the scene a horizon instead of a seam.
    '  outColor = vec4(color, 0.94 * fade);',
    '}',
  ].join('\n');

  /* One program draws each vehicle twice: upright, then mirrored through the
   * floor. A mirror is what a wet detailing-bay floor does, and doing it with a
   * second draw of the same quad costs one extra call rather than a render
   * target. */
  var PANEL_FS = HEAD + [
    'uniform sampler2D uPanel;',
    'uniform float uOpacity;',
    'uniform float uSheen;',
    'uniform float uMirror;',
    'uniform float uTime;',
    'in vec3 vWorld;',
    'in vec2 vUv;',
    'out vec4 outColor;',
    'void main() {',
    '  vec2 uv = vUv;',
    '  float alpha = uOpacity;',
    '  if (uMirror > 0.5) {',
    // Ripple sideways with depth, and drop off fast: a reflection in standing
    // water is broken and short, not a second copy of the truck.
    '    uv.x += sin(vWorld.y * 7.0 - uTime * 1.3) * 0.006;',
    '    alpha *= 0.30 * smoothstep(-4.2, -0.1, vWorld.y);',
    '  }',
    '  vec4 texel = texture(uPanel, uv);',
    '  if (texel.a < 0.004) discard;',
    '  vec3 color = texel.rgb;',
    // Sheen: a soft diagonal band travelling across the paint with the scroll,
    // biased to the glossy parts by their own brightness. Premultiplied, so the
    // added light is scaled by alpha like everything else in the texel.
    '  float luma = dot(color, vec3(0.299, 0.587, 0.114)) / max(texel.a, 0.004);',
    '  float gloss = smoothstep(0.13, 0.72, luma);',
    '  float band = exp(-pow((vUv.x + vUv.y * 0.42 - uSheen) * 3.6, 2.0));',
    '  color += gloss * band * 0.50 * texel.a * vec3(0.88, 0.91, 1.0);',
    '  if (uMirror > 0.5) { color *= vec3(0.62, 0.66, 0.86); }',
    '  outColor = vec4(color * alpha, texel.a * alpha);',
    '}',
  ].join('\n');

  /* Real geometry: a subdivided plane displaced in the vertex stage, with the
   * normal taken from the analytic derivative of the same wave sum rather than
   * from finite differences. Water beading on paint is the literal product the
   * business sells, so it is the one thing on the page worth building out of
   * vertices instead of faking with a texture. */
  var WATER_VS = HEAD + [
    'in vec2 aGrid;',
    'uniform mat4 uViewProjection;',
    'uniform vec3 uOrigin;',
    'uniform float uTime;',
    'uniform float uHalf;',
    'out vec3 vWorld;',
    'out vec3 vNormal;',
    'out vec2 vUv;',
    'out vec2 vFlake;',
    'out float vEdge;',
    'void main() {',
    // Wavelengths of about three units and amplitudes under a tenth of one.
    // The first pass used eleven-unit swells half a metre tall, which from an
    // eye 1.1 units above the surface occluded their own troughs and read as
    // sand dunes. Water sitting on wax is a shimmer, not a sea: the slopes stay
    // steep enough to break up the light, the silhouettes go away.
    '  vec2 p = aGrid;',
    '  float a = p.x * 2.10 + uTime * 1.60;',
    '  float b = p.y * 2.60 - uTime * 1.25;',
    '  float c = (p.x + p.y) * 3.80 + uTime * 2.40;',
    '  float height = 0.060 * sin(a) + 0.045 * sin(b) + 0.022 * sin(c);',
    '  float dx = 0.060 * 2.10 * cos(a) + 0.022 * 3.80 * cos(c);',
    '  float dz = 0.045 * 2.60 * cos(b) + 0.022 * 3.80 * cos(c);',
    '  vNormal = normalize(vec3(-dx, 1.0, -dz));',
    // Plane coordinate, near 0..1, for the screen-wide light streak only.
    '  vUv = p * 0.045 + 0.5;',
    // The beads plate is a MATERIAL, so it is tiled in world units — roughly one
    // 900 px plate every 1.8 units — not stretched across the whole surface. At
    // the earlier 0.045 scale a single droplet covered five world units and read
    // as a black blob, which is the opposite of what the client sells.
    '  vFlake = p * 0.55;',
    // The plane has to end somewhere; dissolve it rather than showing an edge.
    '  vEdge = 1.0 - smoothstep(0.55, 1.0, max(abs(p.x), abs(p.y)) / uHalf);',
    '  vWorld = uOrigin + vec3(p.x, height, p.y);',
    '  gl_Position = uViewProjection * vec4(vWorld, 1.0);',
    '}',
  ].join('\n');

  var WATER_FS = HEAD + STREAK + '\n' + [
    'uniform sampler2D uFlake;',
    'uniform sampler2D uEnv;',
    'uniform sampler2D uSweep;',
    'uniform vec3 uEye;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'uniform float uProgress;',
    'uniform float uFalloff;',
    'in vec3 vWorld;',
    'in vec3 vNormal;',
    'in vec2 vUv;',
    'in vec2 vFlake;',
    'in float vEdge;',
    'out vec4 outColor;',
    'void main() {',
    '  vec3 normal = normalize(vNormal);',
    '  vec3 view = normalize(uEye - vWorld);',
    '  vec3 light = normalize(vec3(sin(uTime * 0.30) * 0.9, 0.85, cos(uTime * 0.30) * 0.7));',
    '  vec3 flake = texture(uFlake, vFlake).rgb;',
    '  float sparkle = pow(max(flake.r, flake.b), 3.0);',
    // Violet metallic, the client's own fleet colour, read off the plate rather
    // than typed in as a guess. The flake only tints it — the range is kept well
    // clear of black so a dark droplet never punches a hole in the paint.
    '  vec3 base = vec3(0.21, 0.085, 0.42) * (0.85 + flake.b * 0.30);',
    '  float diffuse = max(dot(normal, light), 0.0);',
    // `half` is reserved in GLSL ES, hence the spelt-out name.
    '  vec3 halfway = normalize(light + view);',
    '  float lobe = max(dot(normal, halfway), 0.0);',
    // Two lobes: a tight one for the beads themselves and a broad one for the
    // clearcoat under them. One alone reads either as glitter or as plastic.
    '  float specular = pow(lobe, 110.0);',
    '  float sheen = pow(lobe, 16.0);',
    '  float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);',
    '  vec3 reflected = reflect(-view, normal);',
    // xz, not xy: at the grazing angle this surface is seen from, the reflected
    // ray is almost horizontal, so its y carries no information and the lookup
    // collapsed to a single row of the plate.
    '  vec3 env = textureLod(uEnv, reflected.xz * 0.42 + 0.5, 3.0).rgb;',
    '  vec3 color = base * (0.30 + diffuse * 0.70);',
    '  color += vec3(0.95, 0.96, 1.0) * specular * 1.35;',
    '  color += vec3(0.95, 0.96, 1.0) * specular * sparkle * 2.4;',
    // Kept below 1.0 in the blue-violet so the broad lobe stays coloured paint
    // rather than clipping to a white pool the size of a headlight.
    '  color += vec3(0.62, 0.55, 0.85) * sheen * (0.11 + sparkle * 0.30);',
    '  color += env * fresnel * 1.25;',
    '  color += streak(uSweep, vUv * 1.4, uProgress * 2.4 - 0.7, 0.16) * fresnel;',
    '  float fade = exp(-length(vWorld - uEye) * 0.026 * uFalloff) * vEdge;',
    '  outColor = vec4(color * fade * uOpacity, uOpacity * fade);',
    '}',
  ].join('\n');

  /* Haze. The bay plate has visible atmosphere in it and a black void does not,
   * so without these the scene reads as flat cut-outs on a background. */
  var MOTE_VS = HEAD + [
    'in vec3 aPos;',
    'uniform mat4 uViewProjection;',
    'uniform float uTime;',
    'uniform float uScale;',
    'uniform float uFalloff;',
    'out float vAlpha;',
    'void main() {',
    '  vec3 p = aPos;',
    '  p.y += sin(uTime * 0.22 + p.x * 0.5) * 0.85;',
    '  p.x += cos(uTime * 0.17 + p.z * 0.3) * 0.70;',
    '  vec4 clip = uViewProjection * vec4(p, 1.0);',
    '  gl_Position = clip;',
    // Same correction as the haze: without it a backed-off portrait camera
    // shrinks every mote to a pixel and fades the lot to nothing.
    '  float depth = clip.w * uFalloff;',
    '  gl_PointSize = clamp(uScale * 26.0 / max(depth, 1.0), 1.0, 9.0);',
    '  vAlpha = clamp(1.0 - depth * 0.011, 0.0, 1.0) * 0.5;',
    '}',
  ].join('\n');

  var MOTE_FS = HEAD + [
    'in float vAlpha;',
    'out vec4 outColor;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float soft = smoothstep(0.5, 0.05, d);',
    '  outColor = vec4(vec3(0.72, 0.78, 1.0) * soft * vAlpha, 1.0);',
    '}',
  ].join('\n');

  return {
    QUAD_VS: QUAD_VS, BACKDROP_FS: BACKDROP_FS,
    WORLD_VS: WORLD_VS, FLOOR_FS: FLOOR_FS, PANEL_FS: PANEL_FS,
    WATER_VS: WATER_VS, WATER_FS: WATER_FS,
    MOTE_VS: MOTE_VS, MOTE_FS: MOTE_FS,
  };
}());
