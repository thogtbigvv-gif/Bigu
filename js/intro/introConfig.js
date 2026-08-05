/* ==========================================================================
   intro/introConfig.js
   Every tunable the intro sequence reads, in one place — timings, easing,
   and the geometry that makes the logo hand-off land pixel-perfectly.
   ========================================================================== */

/* The video frame is 16:9, but only the bubble mark flies to the header —
   the "Bigu / ビグ" wordmark below it fades with the overlay. These are that
   bubble's bounds inside the video frame, as fractions of frame width/height,
   measured from the footage's own alpha channel by tools/build-intro-video.py.
   Re-run that script and paste its output here if the animation is replaced. */
const MARK_RECT = {
  x: 0.387500,
  y: 0.161111,
  width: 0.225000,
  height: 0.409722,
};

/* Centre of the mark inside the frame, derived once so the flight math reads
   as "put this point on that point" rather than repeating the arithmetic. */
const MARK_CENTRE = {
  x: MARK_RECT.x + MARK_RECT.width / 2,
  y: MARK_RECT.y + MARK_RECT.height / 2,
};

const TIMING = {
  /* How far before the video ends the hand-off starts. The brief's 300–500ms
     window; by this point the logo has long since settled, so the mark is
     visually static while it flies and the motion reads as one object moving
     rather than a video being shrunk. */
  handoffLeadMs: 450,

  /* The flight outlives the video by design — it starts at `handoffLeadMs`
     before the end and keeps going, holding on the final frame. */
  flightMs: 900,
  /* Deliberately most of the flight rather than half of it. The footage's mark
     is white, so once the dark ground is gone it has almost no contrast
     against the light theme's washi background — holding the backdrop for
     longer keeps the logo readable for nearly the whole trip, and the last
     stretch is covered by the cross-fade into the header mark. */
  overlayFadeMs: 760,
  appRevealMs: 700,

  /* The final beat: the flown video fades into the real header mark. See the
     note in introSequence.js about why a cross-fade is needed at all. */
  crossfadeMs: 200,

  /* prefers-reduced-motion, autoplay refusal, decode failure, or Skip all
     land here: no flight, just a short fade. */
  quickFadeMs: 240,

  /* If the video has not buffered enough to play by then, give up and quick-
     fade rather than hold a blank overlay in front of the reader. */
  loadTimeoutMs: 2600,
};

/* The brief's premium ease-out. Same curve for every part of the sequence so
   the overlay, the app, and the logo all decelerate together. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const SELECTORS = {
  overlay: '#intro',
  /* The dark ground — faded on its own so the video above it does not
     inherit the fade. See the note in index.html. */
  backdrop: '#intro-backdrop',
  video: '#intro-video',
  skip: '#intro-skip',
  /* The permanent logo the video hands off to. */
  headerMark: '.brand__mark',
  /* Faded as one unit; opacity only — a transform here would become the
     containing block for the position:fixed nav drawer and its backdrop. */
  appShell: '.app-shell',
  /* Safe to scale: the fixed-position drawer and backdrop are siblings of
     this element, not descendants. */
  appContent: '.app-shell__content',
};

export { MARK_RECT, MARK_CENTRE, TIMING, EASE, SELECTORS };
