/* ==========================================================================
   studyControls.js
   The pair of controls that sits at the foot of every study card in the
   app: "Remember this / In memory" (schedule state) and the 栞 bookmark
   (a choice). Two questions, two controls, one row.

   This existed four times — vocabulary.js, grammar.js, kanji.js, and
   lessons.js each built the same button with the same two labels and the
   same aria-pressed sync, and they had already begun to drift: only two of
   the four accepted an onChange, only one exposed a sync() so the chip
   could be refreshed after grading happened somewhere else, and the labels
   were one edit away from disagreeing. A control that means "is this word
   in my memory?" has to say the same thing on every screen or the answer
   stops being trustworthy, so it is defined here once.

   Nothing here decides what "in memory" means; that is review.js's
   setRemembered, same as before.
   ========================================================================== */

import { isRemembered, setRemembered } from './review.js';
import { createFavoriteButton } from './favorites.js';

/* Returns the button plus its own sync(), because the state it displays can
   change from anywhere — a review round, a lesson quiz, a slip on #memory —
   and a chip that only updates when you press it is a chip that lies. */
function createMemoryChip(itemId, { onChange, className } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className ? `toggle-chip ${className}` : 'toggle-chip';

  function sync() {
    const remembered = isRemembered(itemId);
    button.setAttribute('aria-pressed', String(remembered));
    button.textContent = remembered ? 'In memory' : 'Remember this';
  }

  button.addEventListener('click', () => {
    setRemembered(itemId, !isRemembered(itemId));
    sync();
    onChange?.();
  });

  sync();
  return { button, sync };
}

/* The chip and the bookmark as one row. `className` names the row so each
   view can still place it (the vocabulary card pushes it to the card's
   foot, the kanji card centres it) without redefining what's in it. */
function createStudyControls(itemId, { onChange, className } = {}) {
  const row = document.createElement('div');
  row.className = className ? `study-controls ${className}` : 'study-controls';

  const { button, sync } = createMemoryChip(itemId, { onChange });
  row.append(button, createFavoriteButton(itemId, onChange));

  return { row, sync };
}

export { createStudyControls };
