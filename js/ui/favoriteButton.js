/* ==========================================================================
   ui/favoriteButton.js
   The 栞 — the small control that keeps a word.

   A 栞 (shiori) is a strip of paper with a notch cut out of the bottom,
   which is what a bookmark looks like in a Japanese book and what this
   app's paper vocabulary already suggests. Icon-only, because it sits
   beside a text chip on every card and two labelled controls in a row would
   make neither of them the obvious one.

   aria-pressed plus a real label rather than a title attribute: the state
   has to be announced, and title text is skipped by most screen readers and
   is never reachable by touch at all.

   What "kept" means is study/favorites.js. This file only draws it.
   ========================================================================== */

import { isFavorite, toggleFavorite } from '../study/favorites.js';
import { createIcon } from './content.js';

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

export { createFavoriteButton };
