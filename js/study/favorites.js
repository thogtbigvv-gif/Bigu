/* ==========================================================================
   study/favorites.js
   The one expression of "I want to keep this" in the app.

   Kept items are the only collection on #memory the reader curates by hand;
   every other shelf there is derived from the schedule. That distinction is
   the point of the feature: a study system decides what you *need* to see,
   and a learner also needs somewhere to put the phrase they simply liked.
   The second kind of attention is what makes a language feel like yours
   rather than like a syllabus, and it costs one tap to record.

   Separate store, separate concept: keeping a word says nothing about
   whether you remember it, so this never touches progress/review state.

   The control that sets it is js/ui/favoriteButton.js. The two were one
   file, which made this the only module below the UI layer that built DOM
   — and meant the study layer imported a drawing helper in order to
   express a fact about the reader's own collection.
   ========================================================================== */

import { favorites } from '../core/storage.js';

function isFavorite(itemId) {
  return Boolean(favorites.get(itemId, false));
}

/* Returns the new state, so the caller does not have to read back what it
   just wrote to know which way the toggle went. */
function toggleFavorite(itemId) {
  const next = !isFavorite(itemId);
  if (next) favorites.set(itemId, true);
  else favorites.remove(itemId);
  return next;
}

/* Every kept id in one read, for a screen that asks about many at once.
   isFavorite is right for a single card and wrong for a shelf, where it
   turns one question into hundreds of full parses of the store. */
function favoriteIds() {
  return new Set(Object.keys(favorites.getAll()));
}

export { isFavorite, toggleFavorite, favoriteIds };
