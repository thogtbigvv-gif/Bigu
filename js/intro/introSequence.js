/* ==========================================================================
   intro/introSequence.js
   The cinematic first-visit intro: a fullscreen overlay, the logo animation
   playing centred, then a single continuous motion where the logo flies onto
   the header mark while the overlay fades and the app scales up underneath.

   ON THE STACK
   ------------
   The brief asked for React + Framer Motion. This app has neither, and no
   build step or package.json to add them with — its README's first
   constraint is "No frameworks". Introducing React here would mean rewriting
   the shell before a single frame of intro could run, so the sequence is
   built in the app's own idiom instead, decomposed the way the React version
   would have been: introConfig (tokens), motion (the animate/reduced-motion
   primitives Framer Motion would supply), logoFlight (FLIP math),
   introOverlay (the element + its side effects), introSession (the gate), and
   this file as the orchestrator. Porting to React later is a mechanical
   translation — the maths and the timings are already isolated.

   ON THE CROSS-FADE
   -----------------
   The brief asks that the video *become* the header logo rather than being
   swapped for it, and the flight does exactly that — the video is measured
   onto the header mark's box and moves there under one transform. But the
   footage ends on a white speech-bubble mark, while the header's permanent
   logo is the outlined ビグ square; they are different artwork. So the last
   200ms cross-fades between them at the point where they are the same size in
   the same place, which is as close to seamless as two different marks can
   get. Making it a true zero-cross-fade morph means the header adopting the
   video's bubble mark as the real logo — a brand decision, not a code one.
   ========================================================================== */

import { TIMING, EASE } from './introConfig.js';
import { prefersReducedMotion, animate, nextFrame, withTimeout } from './motion.js';
import { computeFlight, placeAtRest, keepCentred } from './logoFlight.js';
import { queryOverlay, lockApp, teardown } from './introOverlay.js';
import { markPlayed } from './introSession.js';

/* -- Video readiness ----------------------------------------------------------------
   Autoplay only survives if the element is muted and inline, both set in the
   markup. Even then a browser may refuse, the codec may be unsupported (VP9
   with alpha is not universal), or the network may stall — every one of those
   resolves to a falsy "cannot play", and the caller quick-fades instead.
   ---------------------------------------------------------------------------------- */

function whenPlayable(video) {
  if (video.readyState >= 3) return Promise.resolve(true);

  return new Promise((resolve) => {
    const done = (ok) => {
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('error', onError);
      resolve(ok);
    };
    const onCanPlay = () => done(true);
    const onError = () => done(false);

    video.addEventListener('canplay', onCanPlay, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

async function startVideo(video) {
  const ready = await withTimeout(whenPlayable(video), TIMING.loadTimeoutMs);
  if (ready !== true) return false;

  // The stylesheet parks the element off-screen so it can't flash at 0,0
  // before scripting runs; this is the moment it takes its centred position.
  placeAtRest(video);

  try {
    await video.play();
    return true;
  } catch {
    return false; // autoplay blocked
  }
}

/* Resolves `handoffLeadMs` before the video ends.

   timeupdate fires only every ~250ms, which is too coarse to open a 450ms
   window reliably, so this polls on rAF — cheap, frame-aligned, and it also
   covers the case where the video ends early or stalls, via `ended`. */
function whenHandoffDue(video) {
  return new Promise((resolve) => {
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      video.removeEventListener('ended', stop);
      resolve();
    };

    const tick = () => {
      if (stopped) return;
      const { duration, currentTime } = video;
      if (Number.isFinite(duration) && duration > 0 &&
          currentTime >= duration - TIMING.handoffLeadMs / 1000) {
        stop();
        return;
      }
      requestAnimationFrame(tick);
    };

    video.addEventListener('ended', stop, { once: true });
    requestAnimationFrame(tick);
  });
}

/* -- The reveal ---------------------------------------------------------------------
   Overlay out, app in, logo across — all started in the same tick on the same
   easing curve so they read as one motion rather than three animations that
   happen to overlap.
   ---------------------------------------------------------------------------------- */

function revealApp(elements) {
  const { appShell, appContent } = elements;

  // Opacity on the shell, scale on the content: see introConfig's note on why
  // the transform must not go on .app-shell itself.
  appContent.style.willChange = 'transform';

  return Promise.all([
    animate(appShell, [{ opacity: 0 }, { opacity: 1 }], {
      duration: TIMING.appRevealMs,
      easing: EASE,
    }),
    animate(appContent, [{ transform: 'scale(0.985)' }, { transform: 'scale(1)' }], {
      duration: TIMING.appRevealMs,
      easing: EASE,
    }),
  ]);
}

async function flyLogoHome(elements) {
  const { video, headerMark, backdrop } = elements;
  const { from, to } = computeFlight(video, headerMark);

  video.style.willChange = 'transform, opacity';
  video.style.transform = from;
  await nextFrame(); // guarantee the start transform is committed

  const flight = animate(video, [{ transform: from }, { transform: to }], {
    duration: TIMING.flightMs,
    easing: EASE,
  });

  // The ground fades, not the container — the video is a child and would
  // otherwise inherit the fade and vanish before it arrived.
  const overlayFade = animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], {
    duration: TIMING.overlayFadeMs,
    easing: EASE,
  });

  // The hand-off itself, timed to the tail of the flight: the video dissolves
  // exactly as the header mark resolves, both at the same size and position.
  const handoffDelay = Math.max(0, TIMING.flightMs - TIMING.crossfadeMs);
  const videoOut = animate(video, [{ opacity: 1 }, { opacity: 0 }], {
    duration: TIMING.crossfadeMs,
    delay: handoffDelay,
    easing: 'linear',
  });
  const markIn = animate(headerMark, [{ opacity: 0 }, { opacity: 1 }], {
    duration: TIMING.crossfadeMs,
    delay: handoffDelay,
    easing: 'linear',
  });

  await Promise.all([flight, overlayFade, videoOut, markIn, revealApp(elements)]);
}

/* The reduced-motion, autoplay-blocked, and Skip path: no flight, no travel,
   just a short cross-dissolve to the app. */
async function quickFade(elements) {
  const { overlay, appShell, headerMark } = elements;

  headerMark.style.opacity = '';
  await Promise.all([
    animate(overlay, [{ opacity: 1 }, { opacity: 0 }], {
      duration: TIMING.quickFadeMs,
      easing: EASE,
    }),
    animate(appShell, [{ opacity: 0 }, { opacity: 1 }], {
      duration: TIMING.quickFadeMs,
      easing: EASE,
    }),
  ]);
}

/* -- Entry point --------------------------------------------------------------------- */

async function initIntro() {
  // The inline script in index.html decides whether the overlay exists at all;
  // if it isn't there, this session has already seen the intro (or there is no
  // sessionStorage, or scripting ran too late) and the app just renders.
  const elements = queryOverlay();
  if (!elements) return;

  const { video, skip } = elements;
  let finished = false;

  /* One exit for every path — normal end, Skip, Escape, or a failure — so the
     session flag, the teardown, and interaction are restored exactly once. */
  const finish = async (mode) => {
    if (finished) return;
    finished = true;

    try {
      if (mode === 'quick') await quickFade(elements);
    } finally {
      video.pause();
      markPlayed();
      teardown(elements);
    }
  };

  lockApp(elements);

  const bailOut = () => { finish('quick'); };
  skip?.addEventListener('click', bailOut);
  const onKeydown = (event) => {
    if (event.key === 'Escape') bailOut();
  };
  document.addEventListener('keydown', onKeydown);

  try {
    if (prefersReducedMotion()) {
      await finish('quick');
      return;
    }

    const playing = await startVideo(video);
    if (!playing || finished) {
      await finish('quick');
      return;
    }

    // Re-centre on rotation or a window drag, but only until the flight
    // starts — after that the animation owns the transform.
    const stopCentring = keepCentred(video);
    await whenHandoffDue(video);
    stopCentring();
    if (finished) return;

    await flyLogoHome(elements);
    await finish('flight');
  } catch (error) {
    console.error('[Bigu] intro failed, revealing the app', error);
    await finish('quick');
  } finally {
    document.removeEventListener('keydown', onKeydown);
    skip?.removeEventListener('click', bailOut);
  }
}

export { initIntro };
