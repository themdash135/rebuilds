/* One continuous 3D world, travelled by scroll.
 *
 * Not three effects bolted onto three sections. The camera starts on the right
 * of a customer's wrecker, dollies past it, drops to skim a beading paint
 * surface built out of real displaced vertices, then rises to a customer's
 * cruiser. Scroll drives position along that single path; nothing teleports.
 *
 * Layout in world units, all on one z axis so the journey is legible:
 *
 *      z = +26 .......... 0 ......... -35 ......... -70
 *          camera start   wrecker     water         cruiser
 *
 * The two vehicles are the client's own photographs, matted and standing on a
 * reflective black floor. They are never placed inside the generated bay: that
 * plate is blurred to a lod where nothing in it is recognisable and used only
 * for the colour and direction of its light (assets/triage.json, asset_26 —
 * "never Oscar's own or Oscar's premises").
 */
window.Scene = (function () {
  'use strict';

  var IMAGES = {
    env: 'media/hero.webp',
    sweep: 'media/sweep.webp',
    flake: 'media/beads.webp',
    wrecker: 'media/wrecker.webp',
    cruiser: 'media/cruiser.webp',
  };

  // (progress, eye, target, fov degrees). Interpolated with smoothstep so the
  // camera eases through each waypoint instead of cornering at it.
  // Waypoints land on quarter turns because scroll progress is measured across
  // the five journey sections, so each one arrives as its section fills the
  // viewport: hero, fleet, beading, protection, finished work.
  // Each waypoint aims OFF the subject, not at it, so the vehicle sits in the
  // half of the frame the section's copy does not occupy: hero text left so the
  // camera looks left of the truck and pushes it right, fleet text right so it
  // looks right and pushes it left, and so on. Distances are set from the
  // frame width the fov gives at that range — a 16-unit truck seen from 19
  // units at 40 degrees does not fit, and the first pass proved it.
  var PATH = [
    { t: 0.00, eye: [14.0, 3.2, 26.0], at: [-5.5, 3.2, 0.0], fov: 42 },
    { t: 0.25, eye: [10.0, 2.4, 21.0], at: [6.0, 2.6, -2.0], fov: 40 },
    { t: 0.50, eye: [0.6, 1.90, -14.0], at: [0.0, 0.15, -38.0], fov: 55 },
    { t: 0.75, eye: [-3.5, 1.7, -51.0], at: [2.0, 2.2, -70.0], fov: 46 },
    { t: 1.00, eye: [6.0, 2.7, -55.0], at: [-2.2, 2.4, -70.0], fov: 38 },
  ];

  // Half-extents chosen from each cut-out's own aspect so nothing is stretched:
  // wrecker 944x338, cruiser 1073x808. `lo`/`hi` are the scroll window the
  // panel is visible in, with a fade either side.
  var PANELS = [
    { key: 'wrecker', x: 0.0, z: 0.0, halfWidth: 8.0, halfHeight: 2.86,
      lo: -0.10, hi: 0.40, sheenFrom: 0.00, sheenTo: 0.32 },
    { key: 'cruiser', x: 0.0, z: -70.0, halfWidth: 3.5, halfHeight: 2.64,
      lo: 0.66, hi: 1.14, sheenFrom: 0.70, sheenTo: 1.00 },
  ];

  // The aspect the camera path was framed for, and the widest vertical field
  // the projection is allowed to open to before the camera starts backing off
  // instead. Every degree the cap withholds is paid for by pulling the camera
  // away, which makes the subject smaller — at 72 degrees a phone needed a
  // 1.8x pull and the wrecker shrank to a fifth of the screen. 92 costs some
  // stretch at the top and bottom edges, where this scene has only floor and
  // void, and keeps the vehicle the size it was composed at.
  var REFERENCE_ASPECT = 1.6;
  var MAX_FOV = 92 * Math.PI / 180;

  // Below this CSS width the copy stops being a side panel and goes full bleed
  // (the 760px query in css/page.css). That is a different composition, not a
  // narrower one, so the camera recomposes for it rather than only reprojecting.
  var NARROW = 760;
  // Fraction of the reference horizontal field a narrow screen keeps. Holding
  // the field exactly, which is what the lock alone does, preserves the
  // subject's SHARE of the width — and a share composed to sit beside a column
  // of copy is half the frame, which on a phone with the copy above it is half
  // a screen of nothing. 0.62 spends the width the copy gave back.
  var PORTRAIT_FRAME = 0.62;
  // Every vehicle and the water all stand on x = 0; the waypoints aim off that
  // axis on purpose, to park the subject opposite its copy. With the copy above
  // instead of beside, that same offset is what pushed the wrecker's nose off
  // the left edge at the fleet station.
  var PORTRAIT_AXIS = 0.0;
  // How far below centre the subject is dropped, as a share of the half-frame.
  var DROP = 0.60;

  // Stops short of the cruiser at z = -70 in both extent and scroll window, so
  // the surface never has to resolve against it in depth.
  //
  // The origin sits above the deepest trough (-0.127 with the current wave sum),
  // not on the floor. At y = 0.04 every trough sank through the floor plane,
  // lost the depth test to it, and punched a lattice of hard black holes across
  // the surface — the floor showing through its own water.
  var WATER = { origin: [0, 0.25, -33.0], half: 27.0, lo: 0.28, hi: 0.86 };

  function ramp(progress, lo, hi) {
    var fade = 0.10;
    return GL.smoothstep(lo, lo + fade, progress) *
           (1.0 - GL.smoothstep(hi - fade, hi, progress));
  }

  function camera(progress) {
    var i = 0;
    while (i < PATH.length - 2 && progress > PATH[i + 1].t) { i++; }
    var a = PATH[i], b = PATH[i + 1];
    var t = GL.smoothstep(a.t, b.t, progress);
    return {
      eye: [GL.mix(a.eye[0], b.eye[0], t), GL.mix(a.eye[1], b.eye[1], t),
            GL.mix(a.eye[2], b.eye[2], t)],
      at: [GL.mix(a.at[0], b.at[0], t), GL.mix(a.at[1], b.at[1], t),
           GL.mix(a.at[2], b.at[2], t)],
      fov: GL.mix(a.fov, b.fov, t),
    };
  }

  function grid(segments, half) {
    var vertices = new Float32Array((segments + 1) * (segments + 1) * 2);
    var step = (half * 2) / segments, at = 0;
    for (var row = 0; row <= segments; row++) {
      for (var column = 0; column <= segments; column++) {
        vertices[at++] = -half + column * step;
        vertices[at++] = -half + row * step;
      }
    }
    var indices = new Uint32Array(segments * segments * 6), out = 0;
    for (var r = 0; r < segments; r++) {
      for (var c = 0; c < segments; c++) {
        var base = r * (segments + 1) + c;
        indices[out++] = base; indices[out++] = base + 1;
        indices[out++] = base + segments + 1;
        indices[out++] = base + 1; indices[out++] = base + segments + 2;
        indices[out++] = base + segments + 1;
      }
    }
    return { vertices: vertices, indices: indices, count: indices.length };
  }

  function motes(count) {
    var points = new Float32Array(count * 3), seed = 7;
    function random() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < count; i++) {
      points[i * 3] = (random() - 0.5) * 44;
      points[i * 3 + 1] = 0.4 + random() * 11;
      points[i * 3 + 2] = 26 - random() * 108;
    }
    return points;
  }

  function start(canvas, coarse) {
    var gl = canvas.getContext('webgl2', {
      antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    if (!gl) { return Promise.reject(new Error('no webgl2')); }

    return GL.load(IMAGES).then(function (images) {
      var textures = {};
      Object.keys(images).forEach(function (key) {
        // The beads plate is the only one tiled as a material, so it is the only
        // one that wraps. WebGL2 allows REPEAT on a non-power-of-two texture;
        // WebGL1 would not, which is one more reason this page requires 2.
        textures[key] = GL.texture(gl, images[key], key === 'flake');
      });

      var programs = {
        backdrop: GL.program(gl, SHADERS.QUAD_VS, SHADERS.BACKDROP_FS),
        floor: GL.program(gl, SHADERS.WORLD_VS, SHADERS.FLOOR_FS),
        panel: GL.program(gl, SHADERS.WORLD_VS, SHADERS.PANEL_FS),
        water: GL.program(gl, SHADERS.WATER_VS, SHADERS.WATER_FS),
        motes: GL.program(gl, SHADERS.MOTE_VS, SHADERS.MOTE_FS),
      };

      var screen = GL.buffer(gl, new Float32Array([-1, -1, 3, -1, -1, 3]));
      var quad = GL.buffer(gl, new Float32Array([
        -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
      ]));
      var surface = grid(coarse ? 64 : 128, WATER.half);
      var surfaceVertices = GL.buffer(gl, surface.vertices);
      var surfaceIndices = GL.buffer(gl, surface.indices, gl.ELEMENT_ARRAY_BUFFER);
      var dust = motes(coarse ? 180 : 520);
      var dustBuffer = GL.buffer(gl, dust);
      var narrow = false;

      // Maps the unit quad onto the floor: x stays x, the quad's y becomes
      // world z, and world y is pinned to 0.
      var floorModel = new Float32Array([
        140, 0, 0, 0, 0, 0, 140, 0, 0, 1, 0, 0, 0, 0, -25, 1,
      ]);

      function attribute(program, name, buffer, size) {
        var slot = program.a[name];
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(slot);
        gl.vertexAttribPointer(slot, size, gl.FLOAT, false, 0, 0);
      }

      function bind(program, name, id, unit) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, id);
        gl.uniform1i(program.u[name], unit);
      }

      function drawPanel(panel, viewProjection, progress, seconds, mirror) {
        var opacity = ramp(progress, panel.lo, panel.hi);
        if (opacity <= 0.002) { return; }
        var program = programs.panel;
        var height = panel.halfHeight;
        var model = GL.placement(panel.x, mirror ? -height : height, panel.z,
                                 panel.halfWidth, mirror ? -height : height);
        gl.useProgram(program.id);
        attribute(program, 'aPos', quad, 3);
        gl.uniformMatrix4fv(program.u.uViewProjection, false, viewProjection);
        gl.uniformMatrix4fv(program.u.uModel, false, model);
        bind(program, 'uPanel', textures[panel.key], 0);
        gl.uniform1f(program.u.uOpacity, opacity);
        gl.uniform1f(program.u.uMirror, mirror ? 1 : 0);
        gl.uniform1f(program.u.uTime, seconds);
        gl.uniform1f(program.u.uSheen, GL.mix(-0.45, 1.55,
          GL.smoothstep(panel.sheenFrom, panel.sheenTo, progress)));
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      function render(progress, seconds) {
        var view = camera(progress);
        var aspect = canvas.width / canvas.height;
        var fov = view.fov * Math.PI / 180;
        var eye = view.eye, at = view.at, falloff = 1;

        // A perspective matrix scales x by 1/aspect, so the framing authored on
        // a 1.6 laptop collapses horizontally on a 0.46 phone and crops a
        // 16-unit truck down to a fragment. Lock the HORIZONTAL field instead:
        // open the vertical fov until the horizontal one matches the reference,
        // and once that hits the limit take the rest by backing the camera off
        // along its own view vector. One authored path, no per-breakpoint
        // re-composition.
        if (aspect < REFERENCE_ASPECT) {
          // Recentre first: the eye is backed off along the eye-to-target
          // vector below, and that vector has to be the final one.
          var frame = 1;
          if (narrow) {
            at = [PORTRAIT_AXIS, at[1], at[2]];
            frame = PORTRAIT_FRAME;
          }
          var wanted = 2 * Math.atan(
            Math.tan(fov / 2) * REFERENCE_ASPECT / aspect * frame);
          fov = Math.min(wanted, MAX_FOV);
          var pull = Math.tan(wanted / 2) / Math.tan(fov / 2);
          // Everything is now further from the eye, so the haze exponents have
          // to be slackened by the same factor or the whole scene fades to
          // black on a phone purely because the camera moved.
          falloff = 1 / pull;
          eye = [at[0] + (eye[0] - at[0]) * pull,
                 at[1] + (eye[1] - at[1]) * pull,
                 at[2] + (eye[2] - at[2]) * pull];
          // Tall screens put the copy across the whole width, so the subject is
          // dropped into the lower part of the frame rather than left behind it.
          var reach = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
          var lift = (1 - aspect / REFERENCE_ASPECT) * DROP * reach * Math.tan(fov / 2);
          at = [at[0], at[1] + lift, at[2]];
        }

        var viewProjection = GL.multiply(
          GL.perspective(fov, aspect, 0.1, 400),
          GL.lookAt(eye, at, [0, 1, 0]));

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.BLEND);

        // 1. Environment. Depth off: it is behind everything by definition.
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.blendFunc(gl.ONE, gl.ZERO);
        gl.useProgram(programs.backdrop.id);
        attribute(programs.backdrop, 'aPos', screen, 2);
        bind(programs.backdrop, 'uEnv', textures.env, 0);
        bind(programs.backdrop, 'uSweep', textures.sweep, 1);
        gl.uniform1f(programs.backdrop.u.uProgress, progress);
        gl.uniform2f(programs.backdrop.u.uSize, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // 2. Floor. Opaque underfoot, so it has to be laid down before anything
        // that reflects in it.
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(programs.floor.id);
        attribute(programs.floor, 'aPos', quad, 3);
        gl.uniformMatrix4fv(programs.floor.u.uViewProjection, false, viewProjection);
        gl.uniformMatrix4fv(programs.floor.u.uModel, false, floorModel);
        gl.uniform3fv(programs.floor.u.uEye, eye);
        gl.uniform1f(programs.floor.u.uFalloff, falloff);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // 3. Reflections, painted onto the floor with the depth test off. They
        // sit below y = 0, so any depth comparison against the plane they are
        // reflecting in would reject every one of them.
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        PANELS.forEach(function (panel) {
          drawPanel(panel, viewProjection, progress, seconds, true);
        });

        // 4. The beading surface. No depth write: the cruiser is drawn after it
        // and must not be clipped by a surface it is standing beyond.
        gl.enable(gl.DEPTH_TEST);
        var wet = ramp(progress, WATER.lo, WATER.hi);
        if (wet > 0.002) {
          var water = programs.water;
          gl.useProgram(water.id);
          attribute(water, 'aGrid', surfaceVertices, 2);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, surfaceIndices);
          gl.uniformMatrix4fv(water.u.uViewProjection, false, viewProjection);
          gl.uniform3fv(water.u.uOrigin, WATER.origin);
          gl.uniform1f(water.u.uHalf, WATER.half);
          gl.uniform3fv(water.u.uEye, eye);
          gl.uniform1f(water.u.uFalloff, falloff);
          gl.uniform1f(water.u.uTime, seconds);
          gl.uniform1f(water.u.uOpacity, wet);
          gl.uniform1f(water.u.uProgress, progress);
          bind(water, 'uFlake', textures.flake, 0);
          bind(water, 'uEnv', textures.env, 1);
          bind(water, 'uSweep', textures.sweep, 2);
          gl.drawElements(gl.TRIANGLES, surface.count, gl.UNSIGNED_INT, 0);
        }

        // 5. The vehicles themselves.
        PANELS.forEach(function (panel) {
          drawPanel(panel, viewProjection, progress, seconds, false);
        });

        // 6. Haze.
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(programs.motes.id);
        attribute(programs.motes, 'aPos', dustBuffer, 3);
        gl.uniformMatrix4fv(programs.motes.u.uViewProjection, false, viewProjection);
        gl.uniform1f(programs.motes.u.uTime, seconds);
        gl.uniform1f(programs.motes.u.uScale, canvas.height / 900);
        gl.uniform1f(programs.motes.u.uFalloff, falloff);
        gl.drawArrays(gl.POINTS, 0, dust.length / 3);
      }

      function resize(width, height, ratio) {
        // CSS pixels, so this is the same number the media query tests.
        narrow = width < NARROW;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }

      return { render: render, resize: resize };
    });
  }

  return { start: start, PANELS: PANELS, PATH: PATH };
}());
