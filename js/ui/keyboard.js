/* ==========================================================================
   keyboard.js
   App-wide keyboard movement: search, list navigation, dismissal, and the
   shortcut list.

   One document-level listener, and it is deliberately the *last* word rather
   than the first. Three modules already own keys of their own — quiz.js binds
   the round, navigation.js the drawer, kanji.js the detail panel — and every
   one of them was written before this file. Nothing here re-implements or
   intercepts them: this handler acts only on keys and on states that no other
   module claims, so the round keeps its numbers, the drawer keeps its Escape,
   and adding a shortcut here can never quietly disable one over there.

   The grading keys are a case in point. The brief that asked for this file
   offered "1-4 (or J/K/L)" for grading, and the answer is that the quiz
   already grades on 1-4 in Choose and 1/2 in Flip, printed on the options and
   matching the two buttons the reader can see. Rebinding those to J/K/L would
   have invented a second vocabulary for the same act, and put J and K on a
   grade in the one view where they mean "move down a list" everywhere else.
   The shortcut list below reports what the quiz binds; it does not re-bind it.

   SELECTION IS FOCUS. J and K do not maintain a parallel "selected item"
   model with a class and an aria-activedescendant to keep in sync with it.
   They move real DOM focus, which means the app's own focus ring is the
   selection state, Enter reaches the item's own control, a screen reader
   announces the row it landed on, and there is exactly one idea of "where I
   am" rather than two that can disagree.

   Tab order is untouched: items are given tabindex="-1", which makes an
   element programmatically focusable without adding it to the tab sequence.
   A reader tabbing through the app after this file lands passes through
   exactly the controls they did before it.
   ========================================================================== */

/* Per view: the rows J and K walk, and the control Enter presses on the row it
   is standing on. `open` is optional — a vocabulary entry and a grammar point
   have nothing to open, and on those two Enter is deliberately inert rather
   than being pointed at whichever button happens to come first in the card. */
const LIST_VIEWS = {
  vocabulary: { item: '.vocab-card' },
  grammar: { item: '.grammar-card' },
  kanji: { item: '.kanji-card', open: '.kanji-card__detail-button' },
  reading: { item: '.reading-card', open: '.reading-card__open' },
  lessons: { item: '.lesson-group', open: '.lesson-group__header' },
  memory: { item: '.memory-slip', open: '.memory-slip__face' },
};

/* What Escape closes, innermost first — and only the states nobody else
   already handles. The drawer (navigation.js), the kanji detail panel
   (kanji.js) and a running round (quiz.js) are absent from this list because
   each of those modules binds Escape itself; listing them here would mean two
   handlers closing one panel on one keypress.

   `scope` is the thing that is open and `close` the control that shuts it.
   They are separate because the control is not always the thing containing
   focus: a reader inside an expanded lesson is standing in the group's body,
   several rows below the header Escape has to press. Matching the scope first
   and then reaching for its control inside is what lets Escape close the
   lesson the reader is *in* rather than the first one on the page. */
const DISMISSIBLE = [
  { scope: '.reading-stage', close: '.reading-stage__exit' },
  { scope: '.memory-slip.is-open', close: '.memory-slip__face' },
  { scope: '.lesson-group:has([aria-expanded="true"])', close: '.lesson-group__header' },
];

/* Key, then what it does. Read by the overlay and by nothing else, so the list
   a reader sees is generated from one place rather than being a second
   description of the bindings that can drift from them. The quiz rows are
   quiz.js's bindings, reported here rather than re-bound. */
const SHORTCUTS = [
  { keys: ['/'], text: 'Хайлтын талбарт очих' },
  { keys: ['J', 'K'], text: 'Жагсаалтаар доош, дээш' },
  { keys: ['Enter'], text: 'Сонгосныг нээх' },
  { keys: ['Space'], text: 'Картыг эргүүлэх' },
  { keys: ['1', '2', '3', '4'], text: 'Хариултаа сонгох' },
  { keys: ['1', '2'], text: 'Эргүүлсэн картад: дахин үзье, мэдсэн' },
  { keys: ['Enter'], text: 'Хариултын дараа үргэлжлүүлэх' },
  { keys: ['Esc'], text: 'Нээлттэй байгааг хаах' },
  { keys: ['?'], text: 'Энэ жагсаалт' },
];

/* -- Guards ------------------------------------------------------------------ */

/* A shortcut inside a text field is a typo. `closest` rather than `matches`
   because contenteditable nests, and the journal's textarea is the one surface
   in the app where every one of these letters is something the reader meant. */
function isTyping(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

function activeView() {
  return document.querySelector('.view:not([hidden])');
}

/* A round owns the whole screen and its own keys while it runs. Without this,
   J and K would walk the lesson list underneath an open quiz panel. */
function quizIsRunning() {
  const panel = document.querySelector('.quiz');
  return Boolean(panel) && !panel.hidden;
}

function drawerIsOpen() {
  return Boolean(document.querySelector('.site-nav.is-open'));
}

/* -- The shortcut list ------------------------------------------------------- */

/* A native <dialog>, opened with showModal(). The platform already does the
   three things a shortcut overlay has to get right — it traps focus while it
   is open, it closes on Escape, and it returns focus to whatever opened it —
   and every one of those is a thing this app would otherwise have to
   re-implement and keep correct. It is also why Escape needs no handling here
   for the overlay case: `cancel` is fired by the browser. */
let dialog = null;

function buildDialog() {
  const el = document.createElement('dialog');
  el.className = 'shortcuts';
  el.setAttribute('aria-labelledby', 'shortcuts-title');

  const title = document.createElement('h2');
  title.className = 'shortcuts__title';
  title.id = 'shortcuts-title';
  title.textContent = 'Shortcuts';

  const list = document.createElement('dl');
  list.className = 'shortcuts__list';

  for (const row of SHORTCUTS) {
    const dt = document.createElement('dt');
    dt.className = 'shortcuts__keys';
    row.keys.forEach((key, i) => {
      if (i) dt.append(document.createTextNode(' '));
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      dt.append(kbd);
    });

    const dd = document.createElement('dd');
    dd.className = 'shortcuts__text';
    dd.textContent = row.text;

    list.append(dt, dd);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'shortcuts__close';
  close.textContent = 'Esc';
  close.addEventListener('click', () => el.close());

  el.append(title, list, close);
  document.body.append(el);
  return el;
}

function toggleDialog() {
  if (!dialog) dialog = buildDialog();
  if (dialog.open) dialog.close();
  else dialog.showModal();
}

/* -- Search ------------------------------------------------------------------ */

/* Only the field belonging to the view on screen. Every list view builds its
   search box the same way in content.js, so one selector covers all of them
   and a view that has no field simply does not answer the key. */
function focusSearch(view) {
  const field = view && view.querySelector('input[type="search"]');
  if (!field) return false;
  field.focus();
  field.select();
  return true;
}

/* -- List movement ----------------------------------------------------------- */

function visibleItems(view, selector) {
  return [...view.querySelectorAll(selector)].filter((el) => el.offsetParent !== null);
}

/* Where the reader is now, expressed as an index into the rows. `closest`
   rather than an equality check so a reader who has tabbed *into* a row —
   onto its "Remember this" chip, say — and then presses J moves to the next
   row rather than back to the top of the list. */
function currentIndex(items) {
  const focused = document.activeElement;
  if (!focused) return -1;
  return items.findIndex((item) => item === focused || item.contains(focused));
}

function move(view, config, step) {
  const items = visibleItems(view, config.item);
  if (!items.length) return false;

  const at = currentIndex(items);
  // From nowhere, J starts at the top and K at the bottom, which is what the
  // keys mean rather than what an index of -1 would arithmetically give.
  const next = at === -1
    ? (step > 0 ? 0 : items.length - 1)
    : Math.min(Math.max(at + step, 0), items.length - 1);

  const target = items[next];
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
  // `nearest` so a row already on screen does not scroll the page under the
  // reader just because they moved onto it.
  target.scrollIntoView({ block: 'nearest' });
  return true;
}

function openSelected(view, config) {
  if (!config.open) return false;
  const items = visibleItems(view, config.item);
  const at = currentIndex(items);
  if (at === -1) return false;
  const control = items[at].querySelector(config.open);
  if (!control) return false;
  control.click();
  return true;
}

/* -- Dismissal --------------------------------------------------------------- */

/* Innermost first, and preferring whatever contains focus — see the note on
   DISMISSIBLE for why that preference is the point rather than a refinement.
   Hidden scopes are skipped: reading keeps its passage list in the document
   while the stage is open, so a plain querySelector would find a stage that
   is not on screen. */
function dismiss(view) {
  const focused = document.activeElement;
  for (const { scope, close } of DISMISSIBLE) {
    const scopes = [...view.querySelectorAll(scope)].filter((el) => el.offsetParent !== null);
    if (!scopes.length) continue;
    const target = scopes.find((el) => el.contains(focused)) ?? scopes[0];
    const control = target.matches(close) ? target : target.querySelector(close);
    if (!control) continue;
    control.click();
    return true;
  }
  return false;
}

/* -- The listener ------------------------------------------------------------ */

function handleKeydown(event) {
  if (event.repeat) return;
  // Modified keys belong to the browser and the OS. Shift is the exception and
  // only for `?`, which cannot be typed without it.
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (isTyping(event.target)) return;

  const view = activeView();
  if (!view) return;

  if (event.key === '?') {
    event.preventDefault();
    toggleDialog();
    return;
  }

  // Everything below is movement through a view, and none of it applies while
  // the shortcut list is up or the drawer is over the page.
  if (dialog && dialog.open) return;
  if (drawerIsOpen()) return;

  if (event.key === 'Escape') {
    if (dismiss(view)) event.preventDefault();
    return;
  }

  if (event.shiftKey) return;

  if (event.key === '/') {
    if (focusSearch(view)) event.preventDefault();
    return;
  }

  // A running round owns its own keys — see quiz.js.
  if (quizIsRunning()) return;

  const config = LIST_VIEWS[view.id];
  if (!config) return;

  if (event.key === 'j' || event.key === 'J') {
    if (move(view, config, 1)) event.preventDefault();
  } else if (event.key === 'k' || event.key === 'K') {
    if (move(view, config, -1)) event.preventDefault();
  } else if (event.key === 'Enter') {
    if (openSelected(view, config)) event.preventDefault();
  }
}

function initKeyboard() {
  document.addEventListener('keydown', handleKeydown);
}

export { initKeyboard };
