/* ==========================================================================
   updateBanner.js
   The one line of UI the service worker needs: a new version of Bigu has
   been downloaded, do you want it now?

   It exists because of what installing changes. In a tab, a deploy arrives
   the next time the reader opens the site and nobody has to be told
   anything. On a home screen, the same reader resumes an app that has been
   open since last week and whose router never navigates — so the new build
   would sit in the cache, complete and unused, indefinitely. This is the
   only way it gets asked for.

   Deliberately not a modal, and deliberately dismissible. Nothing about an
   update is urgent enough to interrupt a round of review, and a reader who
   says "not now" has given an answer that should last — so a dismissal
   holds for the rest of the session and the offer comes back on the next
   open, by which time the update usually applied itself anyway (an idle
   worker takes over as soon as every tab holding the old one is gone).
   ========================================================================== */

import { applyUpdate, onUpdateReady } from '../core/serviceWorker.js';

let banner = null;
let dismissed = false;

function createBanner() {
  const element = document.createElement('div');
  element.className = 'app-update';
  /* status, not alert: it is worth announcing when the reader next comes up
     for air, and not worth interrupting them mid-sentence for. */
  element.setAttribute('role', 'status');
  element.hidden = true;

  const message = document.createElement('p');
  message.className = 'app-update__message';
  message.textContent = 'Bigu-гийн шинэ хувилбар бэлэн байна.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'button button--primary app-update__action';
  reload.textContent = 'Шинэчлэх';
  reload.addEventListener('click', () => {
    reload.disabled = true;
    /* The reload is not ours to do — core/serviceWorker.js does it on
       controllerchange, once the new worker is actually in charge. If there
       is nothing waiting any more (it took over while the banner sat there),
       the banner has nothing left to offer. */
    if (!applyUpdate()) hide();
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'button button--secondary app-update__action';
  later.textContent = 'Дараа';
  later.addEventListener('click', () => {
    dismissed = true;
    hide();
  });

  const actions = document.createElement('div');
  actions.className = 'app-update__actions';
  actions.append(reload, later);

  element.append(message, actions);
  return element;
}

function hide() {
  if (banner) banner.hidden = true;
}

/* -- Init -----------------------------------------------------------------
   Called once from app.js. The banner is built lazily — most sessions never
   have an update waiting, and an app that draws a hidden bar on every boot
   is an app with one more thing in its accessibility tree for no reason.
   -------------------------------------------------------------------------- */
function initUpdateBanner() {
  onUpdateReady((ready) => {
    if (!ready || dismissed) {
      hide();
      return;
    }

    if (!banner) {
      banner = createBanner();
      document.body.append(banner);
    }
    banner.hidden = false;
  });
}

export { initUpdateBanner };
