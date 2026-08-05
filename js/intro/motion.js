/* ==========================================================================
   intro/motion.js
   Thin helpers over the Web Animations API. The app ships no framework and no
   build step (see the note at the top of introSequence.js), so this stands in
   for what Framer Motion would provide: a promise-returning animate(), the
   reduced-motion query, and a "settle on the final frame" fill so a finished
   animation never snaps back before the next step starts.
   ========================================================================== */

import { EASE } from './introConfig.js';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/* Animates `element` and resolves when it finishes.

   `fill: 'forwards'` holds the end state so consecutive steps compose without
   a flash; callers that keep the element around afterwards are expected to
   commit or clear the animation themselves.

   Resolves rather than rejects if the animation is cancelled — every caller
   here treats "cancelled" as "the sequence moved on", never as an error. */
function animate(element, keyframes, options = {}) {
  const animation = element.animate(keyframes, {
    duration: options.duration ?? 300,
    easing: options.easing ?? EASE,
    delay: options.delay ?? 0,
    fill: options.fill ?? 'forwards',
  });

  return animation.finished.catch(() => {}).then(() => animation);
}

/* Resolves on the next frame *after* styles have been applied — used to make
   sure a starting transform is in effect before the animation that leaves it
   is created, so the first frame is never dropped. */
function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

/* Resolves when `promise` settles or `ms` elapses, whichever comes first.
   Used to bound video buffering so a slow network can't hold the overlay up. */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), ms)),
  ]);
}

export { prefersReducedMotion, animate, nextFrame, withTimeout };
