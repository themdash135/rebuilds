/* The WebGL2 and matrix primitives the scene needs, and nothing else.
 *
 * Three.js is not here on purpose. R-027 rates the performance damage of 3D on
 * a small-business page High/High, and that risk is the stated reason
 * AMENDMENT_002 B19 pushed the whole capability out of V1. Vendoring ~600 KB of
 * engine to draw four textured quads, a displaced grid and a point cloud would
 * concede the objection instead of answering it. This file plus shaders.js and
 * scene.js is about 15 KB.
 *
 * Column-major throughout, matching what WebGL uniformMatrix4fv expects with
 * transpose = false. No matrix stack, no scene graph: every object here knows
 * its own world position, so a graph would be indirection with no user.
 */
window.GL = (function () {
  'use strict';

  function perspective(fovyRadians, aspect, near, far) {
    var f = 1 / Math.tan(fovyRadians / 2), d = near - far;
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / d, -1,
      0, 0, (2 * far * near) / d, 0,
    ]);
  }

  function normalize(v) {
    var l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }

  function lookAt(eye, center, up) {
    var z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
    var x = normalize(cross(up, z));
    var y = cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1,
    ]);
  }

  function multiply(a, b) {
    var out = new Float32Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                         a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  /* Axis-aligned billboard: a unit quad scaled to half-extents and moved into
   * place. `flipY` negative mirrors it through the floor for the reflection
   * pass, which is why scale is applied signed rather than absolute. */
  function placement(x, y, z, halfWidth, halfHeight) {
    return new Float32Array([
      halfWidth, 0, 0, 0,
      0, halfHeight, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1,
    ]);
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) + '\n' + source);
    }
    return shader;
  }

  /* Returns the program with its uniform and attribute locations already
   * resolved onto it, because looking them up per frame is the single easiest
   * way to make a small renderer slow. */
  function program(gl, vertexSource, fragmentSource) {
    var id = gl.createProgram();
    gl.attachShader(id, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(id, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(id);
    if (!gl.getProgramParameter(id, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(id));
    }
    var slots = { id: id, u: {}, a: {} };
    var uniforms = gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniforms; i++) {
      var name = gl.getActiveUniform(id, i).name.replace('[0]', '');
      slots.u[name] = gl.getUniformLocation(id, name);
    }
    var attributes = gl.getProgramParameter(id, gl.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < attributes; j++) {
      var attribute = gl.getActiveAttrib(id, j).name;
      slots.a[attribute] = gl.getAttribLocation(id, attribute);
    }
    return slots;
  }

  function buffer(gl, data, target) {
    var id = gl.createBuffer();
    var kind = target || gl.ARRAY_BUFFER;
    gl.bindBuffer(kind, id);
    gl.bufferData(kind, data, gl.STATIC_DRAW);
    return id;
  }

  /* The cut-outs are stored with alpha already multiplied into RGB, so
   * UNPACK_PREMULTIPLY_ALPHA_WEBGL stays off — turning it on would multiply a
   * second time and eat the edges. Mipmaps matter here: without them a 1600 px
   * truck drawn 500 px wide aliases into glitter along every chrome line. */
  function texture(gl, image, repeat) {
    var id = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, id);
    // Flipped because the shaders derive UV from quad position, so v = 0 is the
    // bottom of the quad while row 0 of a decoded image is its top.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    var wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return id;
  }

  function load(sources) {
    return Promise.all(Object.keys(sources).map(function (key) {
      return new Promise(function (resolve, reject) {
        var image = new Image();
        image.onload = function () { resolve([key, image]); };
        image.onerror = function () { reject(new Error('missing ' + sources[key])); };
        image.src = sources[key];
      });
    })).then(function (pairs) {
      return pairs.reduce(function (all, pair) { all[pair[0]] = pair[1]; return all; }, {});
    });
  }

  function smoothstep(edge0, edge1, x) {
    var t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  function mix(a, b, t) { return a + (b - a) * t; }

  return {
    perspective: perspective, lookAt: lookAt, multiply: multiply,
    placement: placement, program: program, buffer: buffer, texture: texture,
    load: load, smoothstep: smoothstep, mix: mix,
  };
}());
