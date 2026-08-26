/* ==========================================================================
   ui/doors.js
   A row of doors, and what happens at the other end of one.

   "Everything is a door" was the app's second principle and its longest
   standing debt: an entry that leads nowhere is a page in a book, and until
   this file existed every entry in Bigu was a page in a book. The catalogue
   knew that 駅 is inside ～駅 (data/links.js reads that off the headword) and
   the router learned how to address one entry rather than one screen
   (`#vocabulary/n5-001`), but neither of those is visible. This is the part
   the reader touches.

   A door is a link, not a button, and that is worth one paragraph. The
   destination is an address — it can be copied, opened in a new tab, come
   back to with the browser's own Back — and every one of those is free from
   an <a href>, while a button would have had to reimplement the lot and
   would still not be a thing you can middle-click. The click handler is
   there only for the one case the browser cannot help with: a door pointing
   at the entry the reader is already looking at changes no hash, fires no
   hashchange, and would otherwise do nothing at all.

   WHAT A DOOR ROW NEVER DOES IS APOLOGISE. It draws the doors there are, and
   when there are none it does not render — no heading over an empty box, no
   "no related entries", no disabled chip standing for a room that isn't
   there. The same rule kanji.js already applies to its Related Kanji
   section, kept in one place now that six surfaces draw one of these.
   ========================================================================== */

import { routeTo } from '../core/router.js';

/* How many doors a row shows before the rest go behind "show all". Twelve is
   two comfortable rows at a card's width, and it is a real cap rather than a
   cosmetic one: 日 is inside 47 words, and a wall of 47 chips under one
   character is the same wall the vocabulary list was paged to avoid. The
   count on the button says how many are behind it, so the cap never hides
   the size of the answer. */
const DEFAULT_LIMIT = 12;

/* -- One door ---------------------------------------------------------------
   The headword large enough to read as Japanese, the gloss underneath it in
   meta. Both are optional in the sense that a caller may pass only the
   headword — a kanji door is one character and needs no second line.
   -------------------------------------------------------------------------- */

function createDoor({ view, target, headword, gloss, lang = 'ja' }) {
  const link = document.createElement('a');
  link.className = 'door';
  link.href = `#${view}/${target}`;

  const face = document.createElement('span');
  face.className = 'door__face';
  face.lang = lang;
  face.textContent = headword;
  link.append(face);

  if (gloss) {
    const note = document.createElement('span');
    note.className = 'door__gloss';
    note.textContent = gloss;
    link.append(note);
  }

  link.addEventListener('click', (event) => {
    // Anything that isn't a plain left click is the reader asking the browser
    // for something this app should stay out of: a new tab, a new window, a
    // download. The href is already correct for all of them.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    routeTo(view, target);
  });

  return link;
}

/* -- The row ----------------------------------------------------------------
   Returns null when there is nothing to draw, so the caller drops the whole
   section rather than heading an empty one. Every caller of this function
   reads as `const row = createDoorRow(...); if (row) …`, which is the shape
   that makes "no doors" and "no section" the same statement.
   -------------------------------------------------------------------------- */

function createDoorRow({ label, doors, limit = DEFAULT_LIMIT }) {
  if (!doors || doors.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'doors';

  if (label) {
    const heading = document.createElement('p');
    heading.className = 'doors__label';
    heading.textContent = doors.length > limit ? `${label} · ${doors.length}` : label;
    wrap.append(heading);
  }

  const row = document.createElement('div');
  row.className = 'doors__row';
  row.append(...doors.slice(0, limit).map(createDoor));
  wrap.append(row);

  /* The rest, on request, appended in place. Not a link to a filtered list
     somewhere else: the reader is looking at one character and asking to see
     the rest of what uses it, and taking them to another screen to answer
     that would be closing the door they just opened. */
  if (doors.length > limit) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'button button--secondary doors__more';
    more.textContent = `Show ${doors.length - limit} more`;

    more.addEventListener('click', () => {
      row.append(...doors.slice(limit).map(createDoor));
      more.remove();
      // Focus would otherwise fall to the body when the button leaves the
      // document, which on a phone scrolls the reader back to the top.
      row.lastElementChild?.focus();
    });

    wrap.append(more);
  }

  return wrap;
}

/* -- Arriving ---------------------------------------------------------------
   The other end of a door. A deep link that only scrolls leaves the reader
   in front of a list with no indication of which row they came for — on the
   Vocabulary screen that is one card among a page of near-identical ones —
   so the entry says so for a moment and then stops saying it.

   The mark is a static outline rather than a fade, and that is deliberate.
   reset.css collapses every animation to 0.01ms under prefers-reduced-motion,
   which for an animated highlight means the readers most likely to need the
   signal are the ones who never see it. A class removed by a timer is the
   same three seconds for everybody.

   It also clears on the reader's next move — a key, a tap — because by then
   they have found what they came for and the mark is just a decoration on
   the thing they are trying to read.
   -------------------------------------------------------------------------- */

const ARRIVAL_CLASS = 'is-arrival';
const ARRIVAL_MS = 3000;

let clearArrival = null;

function revealEntry(element) {
  if (!element) return;

  clearArrival?.();

  element.classList.add(ARRIVAL_CLASS);
  // `instant`, for the same reason router.js scrolls that way: this is an
  // arrival, not a jump within a page the reader is already reading, and a
  // smooth scroll across 800 cards is a long ride to nowhere.
  element.scrollIntoView({ block: 'start', behavior: 'instant' });

  /* Focus, so a keyboard or screen-reader reader arrives where a sighted one
     does. tabindex="-1" rather than a real tab stop: the entry is a
     destination, not a control, and it should not turn up in the tab order
     of every reader who never used a door. */
  element.setAttribute('tabindex', '-1');
  element.focus({ preventScroll: true });

  const done = () => {
    window.clearTimeout(timer);
    document.removeEventListener('keydown', done);
    document.removeEventListener('pointerdown', done);
    element.classList.remove(ARRIVAL_CLASS);
    if (clearArrival === done) clearArrival = null;
  };

  const timer = window.setTimeout(done, ARRIVAL_MS);
  document.addEventListener('keydown', done);
  document.addEventListener('pointerdown', done);
  clearArrival = done;
}

export { createDoorRow, revealEntry };
