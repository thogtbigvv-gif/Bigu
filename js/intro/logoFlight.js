/* ==========================================================================
   intro/logoFlight.js
   The FLIP math that carries the video onto the header logo.

   Two details make this land exactly rather than approximately:

   1. It is the *mark inside the frame* that has to hit the header logo, not
      the video element's own box. The footage is a 16:9 frame whose bubble
      mark occupies a small, off-centre sub-rect (MARK_RECT) with the wordmark
      below it, so the transform is solved for that sub-rect.

   2. transform-origin is pinned to 0 0 and the element sits at fixed 0,0.
      With a corner origin a point `p` in element space maps to
      `translate + scale * p`, so placing a known point on a measured point is
      one subtraction instead of reasoning about a moving centre origin.

   Only transform is animated — never width/height/top/left — so the whole
   flight stays on the compositor.
   ========================================================================== */

import { MARK_CENTRE, MARK_RECT } from './introConfig.js';

/* Where the mark should end up: the centre and width of the header logo's
   box, measured live so it is correct at any breakpoint. Measured while the
   app is still hidden — opacity does not affect layout, so the rect returned
   is exactly where the logo will be once revealed. */
function measureTarget(headerMark) {
  const rect = headerMark.getBoundingClientRect();
  return {
    centreX: rect.left + rect.width / 2,
    centreY: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

/* The resting state: the whole video frame centred in the viewport at 1:1. */
function restingTransform(videoSize) {
  return {
    x: (window.innerWidth - videoSize.width) / 2,
    y: (window.innerHeight - videoSize.height) / 2,
    scale: 1,
  };
}

/* The landed state: scaled so the mark matches the header logo's width, then
   translated so the mark's centre sits on the header logo's centre.

   scale  = targetWidth / (videoWidth * markWidthFraction)
   x      = targetCentreX - scale * (videoWidth  * markCentreXFraction)
   y      = targetCentreY - scale * (videoHeight * markCentreYFraction)

   Scaling is uniform. The mark is 0.973:1 rather than perfectly square, so
   matching width leaves height 2.7% off — under a pixel at a 32px logo, and
   uniform scale keeps the artwork undistorted, which a non-uniform fit would
   not. */
function landedTransform(videoSize, target) {
  const markWidth = videoSize.width * MARK_RECT.width;
  const scale = target.width / markWidth;

  return {
    x: target.centreX - scale * (videoSize.width * MARK_CENTRE.x),
    y: target.centreY - scale * (videoSize.height * MARK_CENTRE.y),
    scale,
  };
}

function toCss({ x, y, scale }) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

/* Puts the video in its resting, centred position. The stylesheet parks the
   element off-screen so nothing flashes at 0,0 before scripting runs, so this
   has to be called once playback starts — and again on resize, since the
   resting transform is derived from the viewport. */
function placeAtRest(videoElement) {
  const size = {
    width: videoElement.offsetWidth,
    height: videoElement.offsetHeight,
  };
  videoElement.style.transform = toCss(restingTransform(size));
}

/* Keeps the video centred if the viewport changes mid-intro (rotation, a
   desktop window drag). Returns an unsubscribe function; the caller stops
   listening the moment the flight begins, so a late resize can never fight
   the animation for the same property. */
function keepCentred(videoElement) {
  const onResize = () => placeAtRest(videoElement);
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

/* Both ends of the flight for a given video element and header logo. Read at
   flight time rather than at boot so a resize, a late font swap, or a
   different breakpoint can't leave the target stale. */
function computeFlight(videoElement, headerMark) {
  const videoSize = {
    width: videoElement.offsetWidth,
    height: videoElement.offsetHeight,
  };
  const target = measureTarget(headerMark);

  return {
    from: toCss(restingTransform(videoSize)),
    to: toCss(landedTransform(videoSize, target)),
  };
}

export {
  computeFlight,
  measureTarget,
  restingTransform,
  landedTransform,
  placeAtRest,
  keepCentred,
  toCss,
};
