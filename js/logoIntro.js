/* ==========================================================================
   logoIntro.js
   Plays the header logo's assembly animation: once automatically on the first
   load of a browser session, and again on demand whenever the reader clicks
   the mark.

   This replaces the previous full-screen video intro. The whole feature is now
   one class toggled on one element — there is no overlay, nothing is made
   inert, and the app is interactive from the first frame. All of the motion
   lives in css/intro.css; this module only decides when it runs.
   ========================================================================== */

const MARK_SELECTOR = '.brand__mark';
const REPLAY_SELECTOR = '.brand__replay';
const PLAYING_CLASS = 'brand__mark--playing';
const SESSION_KEY = 'biguIntroPlayed';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/* Longer than the slowest track in css/intro.css (the trailing sparkle:
   380ms delay + 380ms duration). Used only as a fallback timer — see play(). */
const SEQUENCE_MS = 900;

/* -- Session gate -------------------------------------------------------------------
   Guarded the same way storage.js guards localStorage: Safari private mode and
   locked-down browsers throw on access, and a logo animation is never worth
   breaking the boot sequence over. A failure reads as "already played", so the
   automatic run is skipped and the click-to-replay path still works.
   ---------------------------------------------------------------------------------- */

function hasPlayedThisSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    return true;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(SESSION_KEY, 'true');
  } catch {
    /* Nothing to do: the animation simply replays next load. */
  }
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/* -- Playback -------------------------------------------------------------------- */

/* The run currently in flight, so a replay that interrupts one can retire it.
   Only ever one: the mark carries a single class, so two live runs would be
   two owners of the same piece of state. */
let activeRun = null;

/* Runs the sequence once, resolving when it ends.

   Removing the class first and forcing a reflow is what makes a replay
   possible: re-adding a class the element already carries does not restart a
   CSS animation, and without the reflow the browser coalesces the removal and
   the addition into no change at all. getBoundingClientRect() rather than
   offsetWidth for that flush: offsetWidth belongs to HTMLElement, and on an
   <svg> it is a non-standard extension some engines simply do not have, so
   reading it there can flush nothing at all.

   Any run already in flight is retired first. Its backstop timer runs on its
   own schedule, and left armed it would fire partway through this sequence and
   strip the class mid-animation.

   `animationend` fires once per animated element, so it is filtered down to
   the last track rather than the first to finish. The timer is a backstop for
   the case where no animation runs at all — an unsupported property, or a
   reduced-motion rule zeroing them — so the promise can never hang. */
function play(mark) {
  // Retire the previous run before touching the class, so it cannot clear the
  // class this call is about to set.
  activeRun?.stop(false);

  mark.classList.remove(PLAYING_CLASS);
  mark.getBoundingClientRect(); // force reflow so the restart is seen as a change
  mark.classList.add(PLAYING_CLASS);

  return new Promise((resolve) => {
    /* `settle` is false when a newer run has taken over: that run owns the
       class now, so this one only disarms itself and resolves. Its awaiting
       caller still gets its `.then`, which is what records the session flag. */
    const run = {
      done: false,
      timer: 0,
      stop(settle) {
        if (run.done) return;
        run.done = true;
        mark.removeEventListener('animationend', onEnd);
        clearTimeout(run.timer);
        if (activeRun === run) activeRun = null;
        if (settle) mark.classList.remove(PLAYING_CLASS);
        resolve();
      },
    };

    const onEnd = (event) => {
      if (event.target.classList.contains('brand__mark-sparkle--trail')) run.stop(true);
    };

    mark.addEventListener('animationend', onEnd);
    run.timer = setTimeout(() => run.stop(true), SEQUENCE_MS);
    activeRun = run;
  });
}

/* -- Init ---------------------------------------------------------------------------- */

function initIntro() {
  const mark = document.querySelector(MARK_SELECTOR);
  if (!mark) return;

  const replay = document.querySelector(REPLAY_SELECTOR);

  // Click always replays, including when reduced motion is on: the reader
  // asked for it explicitly, and css/intro.css keeps that request cheap by
  // dropping the motion itself rather than the interaction.
  replay?.addEventListener('click', () => play(mark));

  // The automatic run is the part that should defer to the preference.
  if (prefersReducedMotion() || hasPlayedThisSession()) {
    markPlayed();
    return;
  }

  play(mark).then(markPlayed);
}

export { initIntro };
