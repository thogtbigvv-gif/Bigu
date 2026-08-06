/* ==========================================================================
   favorites.js
   The one expression of "I want to keep this" in the app, and the small
   control that sets it.

   Kept items are the only collection on #memory the reader curates by hand;
   every other shelf there is derived from the schedule. That distinction is
   the point of the feature: a study system decides what you *need* to see,
   and a learner also needs somewhere to put the phrase they simply liked.
   The second kind of attention is what makes a language feel like yours
   rather than like a syllabus, and it costs one tap to record.

   Separate store, separate concept: keeping a word says nothing about
   whether you remember it, so this never touches progress/review state.
   ========================================================================== */

import { favorites } from './storage.js';
import { createIcon } from './content.js';

function isFavorite(itemId) {
  return Boolean(favorites.get(itemId, false));
}

function toggleFavorite(itemId) {
  const next = !isFavorite(itemId);
  if (next) favorites.set(itemId, true);
  else favorites.remove(itemId);
  return next;
}

function favoriteIds() {
  return new Set(Object.keys(favorites.getAll()));
}

/* -- The control ---------------------------------------------------------------------
   A 栞 (shiori — bookmark): a strip of paper with a notch cut out of the
   bottom, which is what a bookmark looks like in a Japanese book and what
   this app's paper vocabulary already suggests. Icon-only, because it sits
   beside a text chip on every card and two labelled controls in a row would
   make neither of them the obvious one.

   aria-pressed + a real label rather than a title attribute: the state has
   to be announced, and title text is skipped by most screen readers and
   never reachable by touch at all.
   -------------------------------------------------------------------------------------- */

function createFavoriteButton(itemId, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'favorite-button';

  const icon = createIcon('favorite-button__icon', [
    ['path', { d: 'M4 2.5h8v11l-4-3-4 3z' }],
  ]);

  const label = document.createElement('span');
  label.className = 'sr-only';

  button.append(icon, label);

  function sync() {
    const kept = isFavorite(itemId);
    button.setAttribute('aria-pressed', String(kept));
    label.textContent = kept ? 'Kept — remove from Kept' : 'Keep this';
  }

  button.addEventListener('click', (event) => {
    // Slips on #memory put this inside a row that is itself clickable; a
    // keep must never also open the slip.
    event.stopPropagation();
    toggleFavorite(itemId);
    sync();
    if (onChange) onChange();
  });

  sync();
  return button;
}

export { isFavorite, toggleFavorite, favoriteIds, createFavoriteButton };
