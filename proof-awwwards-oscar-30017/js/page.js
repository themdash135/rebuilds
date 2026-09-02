/* Scroll, degradation and the three ways this page is allowed to give up.
 *
 * The whole experience is optional by construction. `prefers-reduced-motion`,
 * no WebGL2, and a device that measurably cannot hold frame rate each fall back
 * to the same static layout, which is real markup with real images rather than
 * a blank screen — every fact and price on the page is in the DOM whether or
 * not a single shader ever runs. That is the answer to R-027 (3D/video
 * performance damage rated High/High) and to `08` §2's mobile >= 9 gate: the
 * effect is additive, so there is nothing for it to break.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var canvas = document.getElementById('stage');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
  var saveData = (navigator.connection || {}).saveData === true;

  function fallBack(reason) {
    root.classList.add('static');
    root.classList.remove('live');
    if (canvas) { canvas.setAttribute('hidden', ''); }
    if (window.console && reason) { console.info('proof: static layout —', reason); }
  }

  /* Videos are ambient loops. They are never the carrier of information, so
   * anything that says "not now" — narrow screen, data saver, reduced motion,
   * off screen — simply gets the poster frame instead. */
  function ambientVideo() {
    var videos = [].slice.call(document.querySelectorAll('video[data-ambient]'));
    if (!videos.length) { return; }
    if (reduced || saveData || window.innerWidth < 760) {
      videos.forEach(function (video) { video.removeAttribute('autoplay'); });
      return;
    }
    var watcher = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (entry.isIntersecting) {
          if (!video.getAttribute('src')) { video.setAttribute('src', video.dataset.ambient); }
          var playing = video.play();
          if (playing && playing.catch) { playing.catch(function () {}); }
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.2 });
    videos.forEach(function (video) { watcher.observe(video); });
  }

  function reveals() {
    var blocks = [].slice.call(document.querySelectorAll('[data-reveal]'));
    if (!blocks.length) { return; }
    var watcher = new IntersectionObserver(function (entries, self) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) { return; }
        entry.target.classList.add('shown');
        self.unobserve(entry.target);
      });
    }, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
    blocks.forEach(function (block) { watcher.observe(block); });
  }

  function drive(scene) {
    var ratio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    var target = 0, smoothed = 0, frames = 0, budget = 0, degraded = false;
    var started = performance.now(), last = started;

    function measure() {
      scene.resize(window.innerWidth, window.innerHeight, ratio);
    }

    /* Measured across the journey sections, not the document. The price list
     * and the contact details come after them and must not push the camera —
     * the scene reaches its last waypoint as the finished-work section fills
     * the viewport and holds there while the rest of the page is read. */
    var journey = document.getElementById('journey');
    function progress() {
      var box = journey.getBoundingClientRect();
      var span = box.height - window.innerHeight;
      return span > 0 ? Math.min(1, Math.max(0, -box.top / span)) : 0;
    }

    /* Two strikes. First a resolution cut, which recovers most cases because
     * these shaders are fragment-bound; if that is not enough the scene is shut
     * down and the static layout takes over. Better an honest still page than a
     * stuttering one. */
    function watchdog(delta) {
      frames++;
      if (frames < 45) { return true; }
      budget += (delta - budget) * 0.05;
      if (!degraded && frames > 110 && budget > 23) {
        degraded = true; ratio = 1; measure();
        return true;
      }
      if (degraded && frames > 300 && budget > 34) {
        fallBack('frame budget ' + budget.toFixed(1) + 'ms');
        return false;
      }
      return true;
    }

    function frame(now) {
      if (document.hidden) { last = now; requestAnimationFrame(frame); return; }
      var delta = Math.min(now - last, 100);
      last = now;
      smoothed += (target - smoothed) * 0.085;
      scene.render(smoothed, (now - started) / 1000);
      if (watchdog(delta)) { requestAnimationFrame(frame); }
    }

    target = smoothed = progress();
    measure();
    window.addEventListener('scroll', function () { target = progress(); }, { passive: true });
    window.addEventListener('resize', function () { target = progress(); measure(); });
    requestAnimationFrame(frame);
  }

  reveals();
  ambientVideo();

  if (reduced) {
    fallBack('prefers-reduced-motion');
  } else if (!canvas || !document.getElementById('journey')) {
    fallBack('page is missing the stage or the journey wrapper');
  } else {
    Scene.start(canvas, coarse).then(function (scene) {
      // Static is the document's default class, so the page is complete before
      // a line of this file runs and the swap only ever happens on success.
      root.classList.remove('static');
      root.classList.add('live');
      drive(scene);
    }).catch(function (error) {
      fallBack(error && error.message);
    });
  }
}());
