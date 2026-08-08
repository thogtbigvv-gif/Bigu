/* ==========================================================================
   quiz.js
   The one quiz in the app. Both the Review deck and the per-lesson quiz run
   through this module — they used to be two separate implementations that
   looked similar and behaved slightly differently, which is most of why the
   quiz felt inconsistent depending on where you started it.

   Two study modes, chosen before a round:

     Choose  — a question with four answers, checked for you. This is the
               default, and it's the mode that makes the app teachable
               rather than only self-reportable: it asks something specific,
               tells you immediately whether you were right, and shows the
               answer when you weren't. A beginner has no way to fairly
               self-grade a word they've never seen; a multiple choice
               question doesn't ask them to.

     Flip    — the classic flashcard: recall it in your head, reveal, then
               say whether you knew it. Faster once the material is
               familiar, and still the honest mode for grammar patterns
               whose meanings are long enough that four of them on screen
               at once is a wall of text.

   Both grade into review.js, so either mode moves an item along the same
   schedule. Nothing here reads or writes storage directly.
   ========================================================================== */

import { grade as gradeItem, describeNextReview, shuffled } from './review.js';

/* Four is Quizlet's number and it's the right one: three distractors is
   enough that guessing is clearly worse than knowing (25%), and few enough
   that the whole set is readable at a glance on a phone. */
const CHOICE_COUNT = 4;

/* How long a correct answer sits on screen before the next question. Long
   enough to register the green, short enough that a good run feels fast.
   A wrong answer never auto-advances — see showFeedback. */
const CORRECT_PAUSE_MS = 650;

const MODES = [
  { id: 'choose', label: 'Choose', hint: 'Дөрвөн хариулт, шалгаж өгнө' },
  { id: 'flip', label: 'Flip', hint: 'Картыг эргүүлж хариултыг нь харна' },
];

/* -- Item adapters ---------------------------------------------------------------------
   One per content kind. Each knows how to draw its item's Japanese side,
   what the question about it should say, what counts as the answer, and
   what extra context is worth showing once the answer is in.

   These replace the near-identical deck adapters that lived in practice.js
   and the separate hand-rolled card in lessons.js.
   -------------------------------------------------------------------------------------- */

function jpSpan(text) {
  const span = document.createElement('span');
  span.lang = 'ja';
  span.textContent = text;
  return span;
}

function furigana(base, reading) {
  if (!reading || base === reading) return jpSpan(base);
  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = reading;
  ruby.append(base, rt);
  return ruby;
}

/* The example block shown under the feedback line. Built from whichever of
   jp/reading/mn an item actually has, so one function serves all four
   content kinds instead of four near-copies. */
function exampleBlock({ jp, reading, mn }) {
  const wrap = document.createElement('div');
  wrap.className = 'quiz__example';

  if (jp) {
    const line = document.createElement('p');
    line.lang = 'ja';
    line.className = 'quiz__example-jp';
    line.textContent = jp;
    wrap.append(line);
  }
  if (reading) {
    const line = document.createElement('p');
    line.lang = 'ja';
    line.className = 'reading';
    line.textContent = reading;
    wrap.append(line);
  }
  if (mn) {
    const line = document.createElement('p');
    line.className = 'meta';
    line.textContent = mn;
    wrap.append(line);
  }

  return wrap;
}

const ADAPTERS = {
  lessons: {
    label: 'Lessons',
    question: 'Энэ үг ямар утгатай вэ?',
    front: (item) => furigana(item.word, item.reading),
    hint: () => '',
    meaning: (item) => item.english,
    detail: () => null,
  },

  vocabulary: {
    label: 'Vocabulary',
    question: 'Энэ үг ямар утгатай вэ?',
    front: (item) => (item.kanji ? furigana(item.kanji, item.kana) : jpSpan(item.kana)),
    hint: (item) => item.partOfSpeech,
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock(item.example),
  },

  grammar: {
    label: 'Grammar',
    question: 'Энэ хэлбэр ямар утгатай вэ?',
    front: (item) => {
      const wrap = document.createElement('span');
      wrap.lang = 'ja';
      wrap.append('〜', item.patternKana ? furigana(item.pattern, item.patternKana) : item.pattern);
      return wrap;
    },
    hint: (item) => item.structure,
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock(item.example),
  },

  kanji: {
    label: 'Kanji',
    question: 'Энэ ханз ямар утгатай вэ?',
    front: (item) => jpSpan(item.character),
    hint: (item) => [item.onyomi, item.kunyomi].filter(Boolean).join(' ・ '),
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock({ jp: item.example.word, reading: item.example.reading, mn: item.example.mn }),
  },
};

/* Lesson ids are l1-01, l2-14, … — tested first because "l" is a looser
   match than the prefixes below it. Vocabulary ids carry any level prefix
   (n5-0001 … n1-…), so the pattern matches the whole ladder rather than
   the one prefix the earliest word list happened to use.

   The prefix in an id is history, not a level: an id is the key every
   progress and review record in localStorage is stored under, so it never
   changes once written, even when the entry's actual level says otherwise.
   Read the entry's own level, never its id. */
function deckKeyForItemId(id) {
  if (/^l\d+-/.test(id)) return 'lessons';
  if (/^n[1-5]-/.test(id)) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

function adapterFor(item) {
  const key = deckKeyForItemId(item.id);
  return key ? ADAPTERS[key] : null;
}

/* -- Question building -------------------------------------------------------------------
   Distractors are drawn only from items of the same kind as the question.
   A round pulled from the mixed "Due today" pool would otherwise offer a
   grammar explanation among four answers to a kanji question, and the odd
   one out gives the answer away without the reader knowing anything.

   Meanings are de-duplicated too: two entries that genuinely share a gloss
   would make a question with two right answers.
   -------------------------------------------------------------------------------------- */

function buildChoices(item, pool) {
  const adapter = adapterFor(item);
  const answer = adapter.meaning(item);
  const kind = deckKeyForItemId(item.id);

  const seen = new Set([answer]);
  const distractors = [];

  for (const candidate of shuffled(pool)) {
    if (distractors.length >= CHOICE_COUNT - 1) break;
    if (candidate.id === item.id) continue;
    if (deckKeyForItemId(candidate.id) !== kind) continue;

    const text = adapterFor(candidate).meaning(candidate);
    if (!text || seen.has(text)) continue;

    seen.add(text);
    distractors.push(text);
  }

  return shuffled([answer, ...distractors]).map((text) => ({ text, correct: text === answer }));
}

/* How far a card has to travel before letting go grades it. 72px is about a
   thumb's width: far enough that a stray drag while scrolling the page can't
   answer a question, short enough to flick without lifting the wrist. */
const SWIPE_GRADE_DISTANCE = 72;

/* How long the graded card takes to leave. Deliberately shorter than its
   arrival: a card being discarded is the reader's own decision already made,
   and every millisecond here is paid forty times a round. */
const EXIT_MS = 180;

function arrowGlyph(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'quiz__grade-arrow');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7');
  svg.append(line);
  return svg;
}

function gradeLabel(text) {
  const span = document.createElement('span');
  span.className = 'quiz__grade-label';
  span.textContent = text;
  return span;
}

/* -- Markup -------------------------------------------------------------------------------
   One panel covering both modes; the parts a mode doesn't use are hidden
   rather than rebuilt, so switching modes between rounds never rebuilds
   the DOM. Structure top to bottom: progress bar, counters + exit, the
   card, the mode's own controls, feedback.
   -------------------------------------------------------------------------------------------- */

function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'quiz';
  panel.hidden = true;

  /* Progress. aria-hidden because the counter beside it says the same thing
     in words — announcing it again on every question is noise. */
  const bar = document.createElement('div');
  bar.className = 'quiz__progress';
  bar.setAttribute('aria-hidden', 'true');

  const barFill = document.createElement('span');
  barFill.className = 'quiz__progress-bar';
  bar.append(barFill);

  const head = document.createElement('div');
  head.className = 'quiz__head';

  const title = document.createElement('p');
  title.className = 'quiz__title';

  const count = document.createElement('p');
  count.className = 'quiz__count';
  count.setAttribute('aria-live', 'polite');

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.className = 'button button--secondary quiz__exit';
  exitButton.textContent = 'End';

  head.append(title, count, exitButton);

  /* Card. Two faces of one object rather than a question with an answer
     printed underneath it: the front asks and the back answers, in both modes.

     What differs is who turns it. In Flip the reader does, before grading
     themselves — the front is a <button>, so the card is its own control,
     tappable and focusable without a second button underneath doing the same
     job. In Choose the app turns it the moment an option is picked, which is
     why the front is disabled there.

     Unifying the two is what let the feedback area below shrink to a verdict
     and a button. It used to carry the example sentence as well, so answering
     grew the page by a block and a half under the reader's thumb, pushing
     Continue towards the fold exactly when they wanted it. The answer belongs
     on the answer side of the card; there was never a second place for it.

     The front's children are <span>s, not <p>s — a <button> may only contain
     phrasing content, and they are flex items here so they lay out as blocks
     anyway. */
  const scene = document.createElement('div');
  scene.className = 'quiz__scene';

  const cardInner = document.createElement('div');
  cardInner.className = 'quiz__card-inner';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card quiz__card quiz__card--front';

  const prompt = document.createElement('span');
  prompt.className = 'quiz__prompt';

  const front = document.createElement('span');
  front.className = 'quiz__front';

  const hint = document.createElement('span');
  hint.className = 'quiz__hint';

  // Shown in Flip mode only. The card looks like every other card in the app,
  // so nothing about it says "turn me over" until this line does.
  const flipHint = document.createElement('span');
  flipHint.className = 'quiz__flip-hint';
  flipHint.textContent = 'Дарж эргүүлнэ үү';

  card.append(prompt, front, hint, flipHint);

  const cardBack = document.createElement('div');
  cardBack.className = 'card quiz__card quiz__card--back';
  // Focused when the card turns, so a screen reader hears the answer rather
  // than only the grade buttons that appear with it.
  cardBack.tabIndex = -1;

  /* The question, restated small above its own answer. A flashcard's back
     usually carries the answer alone, and for a card you are *drilling* that
     is right — but this is a language, and the one instant worth putting the
     two sides in the same eyeline is the instant the reader has just
     committed to a guess. In Choose it is also the only place the Japanese
     survives the turn at all. */
  const answerJp = document.createElement('p');
  answerJp.className = 'quiz__answer-jp';

  const answer = document.createElement('p');
  answer.className = 'quiz__answer';

  const answerDetail = document.createElement('div');
  answerDetail.className = 'quiz__answer-detail';

  cardBack.append(answerJp, answer, answerDetail);
  cardInner.append(card, cardBack);
  scene.append(cardInner);

  /* Choose mode */
  const options = document.createElement('div');
  options.className = 'quiz__options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Answers');

  /* Flip mode. No "Show answer" button any more — the card is the control,
     and two things on one screen doing the same thing reads as a bug. */
  const grade = document.createElement('div');
  grade.className = 'quiz__grade';
  grade.hidden = true;

  /* The two verdicts have directions now — left for "still learning", right
     for "I knew it" — and the card travels that way whether it was flicked or
     the button was pressed. The arrows are how the buttons teach the gesture:
     a swipe nobody knows about is a feature nobody has. They stay on the outer
     edge of each button and the row never stacks, so the button's own position
     on screen agrees with the direction it means. */
  const missButton = document.createElement('button');
  missButton.type = 'button';
  missButton.className = 'button button--secondary quiz__grade-button quiz__grade-button--left';
  missButton.append(arrowGlyph('left'), gradeLabel('Still learning'));

  const knewButton = document.createElement('button');
  knewButton.type = 'button';
  knewButton.className = 'button button--primary quiz__grade-button quiz__grade-button--right';
  knewButton.append(gradeLabel('I knew it'), arrowGlyph('right'));

  grade.append(missButton, knewButton);

  /* Feedback, shared by both modes */
  const feedback = document.createElement('div');
  feedback.className = 'quiz__feedback';
  feedback.hidden = true;

  const verdict = document.createElement('p');
  verdict.className = 'quiz__verdict';
  verdict.setAttribute('role', 'status');

  /* Choose keeps its example here rather than on the card — see the note in
     renderCard on why the answer face has to stay short in that mode. */
  const detail = document.createElement('div');
  detail.className = 'quiz__detail';

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'button button--primary quiz__continue';
  continueButton.textContent = 'Continue';

  feedback.append(verdict, detail, continueButton);

  const shortcuts = document.createElement('p');
  shortcuts.className = 'quiz__shortcuts meta';

  /* Summary */
  const summary = document.createElement('div');
  summary.className = 'quiz__summary';
  summary.hidden = true;

  const summaryScore = document.createElement('p');
  summaryScore.className = 'quiz__summary-score';

  const summaryText = document.createElement('p');
  summaryText.className = 'quiz__summary-text';

  const missedHeading = document.createElement('p');
  missedHeading.className = 'quiz__missed-heading';
  missedHeading.textContent = 'Worth another look';

  const missedList = document.createElement('ul');
  missedList.className = 'quiz__missed-list';

  const summaryActions = document.createElement('div');
  summaryActions.className = 'quiz__summary-actions';

  const retryMissedButton = document.createElement('button');
  retryMissedButton.type = 'button';
  retryMissedButton.className = 'button button--primary';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--secondary';
  againButton.textContent = 'New round';

  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'button button--secondary';
  doneButton.textContent = 'Done';

  summaryActions.append(retryMissedButton, againButton, doneButton);
  summary.append(summaryScore, summaryText, missedHeading, missedList, summaryActions);

  const round = document.createElement('div');
  round.className = 'quiz__round';
  round.append(bar, head, scene, options, grade, feedback, shortcuts);

  panel.append(round, summary);

  return {
    panel, round, bar, barFill, title, count, exitButton,
    scene, cardInner, card, prompt, front, hint, flipHint,
    cardBack, answerJp, answer, answerDetail,
    options, grade, missButton, knewButton,
    feedback, verdict, detail, continueButton, shortcuts,
    summary, summaryScore, summaryText, missedHeading, missedList,
    retryMissedButton, againButton, doneButton,
  };
}

/* -- Session ------------------------------------------------------------------------------- */

/**
 * Builds a quiz panel and returns a handle to it.
 *
 * - `onGrade`     fires after every answer, so the view behind the quiz can
 *                 refresh whatever it shows about progress.
 * - `onFinish`    fires once a round ends, with what happened, so the caller
 *                 can log the session however it logs sessions.
 * - `onNewRound`  supplies the next round's items. The caller owns what a
 *                 round contains — Review draws from the schedule, a lesson
 *                 quiz just reshuffles its own words — so the quiz asks
 *                 rather than guessing.
 * - `onExit`      fires when the reader leaves the quiz entirely.
 * - `isActive`    guards the keyboard shortcuts, so they never fire while
 *                 another view is on screen.
 */
function createQuiz({
  onGrade = () => {},
  onFinish = () => {},
  onNewRound = null,
  onExit = () => {},
  isActive = () => true,
} = {}) {
  const el = buildPanel();

  const state = {
    mode: 'choose',
    queue: [],
    pool: [],
    index: 0,
    correct: 0,
    missed: [],
    answered: false,
    flipped: false,
    // 'left' | 'right' | null — which way the last answer sent the card. Set
    // at grading time and read again at advance time, so the flick, the lean
    // it settles into, and the exit are all one continuous movement.
    direction: null,
    title: '',
  };

  /* -- Rendering ------------------------------------------------------------------------ */

  function setProgress() {
    const total = state.queue.length;
    const done = state.index;
    el.barFill.style.setProperty('--progress', total === 0 ? '0' : (done / total).toFixed(3));
    el.count.textContent = `${Math.min(done + 1, total)} of ${total} · ${state.correct} correct`;
  }

  function currentItem() {
    return state.queue[state.index];
  }

  function renderOptions(item) {
    el.options.replaceChildren();

    const choices = buildChoices(item, state.pool);

    choices.forEach((choice, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz__option';
      button.dataset.correct = String(choice.correct);

      const key = document.createElement('span');
      key.className = 'quiz__option-key';
      key.textContent = String(i + 1);
      key.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'quiz__option-text';
      text.textContent = choice.text;

      button.append(key, text);
      button.addEventListener('click', () => answer(choice.correct, button));
      el.options.append(button);
    });
  }

  /* Face the card front again with no animation at all.

     The alternative — letting it turn back on its own — plays the reveal in
     reverse with the *next* question's answer already printed on the back, so
     the reader watches a meaning they haven't been asked about yet rotate
     away. Killing the transition for one frame is the honest version: the
     previous card is gone, and the new one arrives face up on its own
     entrance animation.

     Same class-off / reflow / class-on shape as the entrance restart below. */
  function faceFront() {
    state.flipped = false;
    el.scene.classList.add('is-instant');
    el.scene.classList.remove('is-flipped');
    void el.cardInner.offsetWidth;
    el.scene.classList.remove('is-instant');
    syncFaces();
  }

  /* Only the face turned towards the reader is in the accessibility tree.
     Both are always in the DOM — the card is sized to the taller of the two
     so it doesn't resize mid-turn — and without this a screen reader would
     read the answer straight out of the back of an unturned card.

     The front is *disabled* once it has been turned away, not merely
     aria-hidden. Two reasons, and they are the same reason twice: a focusable
     element inside an aria-hidden subtree is a contradiction the spec
     forbids, and a button a reader can Tab to but cannot see is the bug this
     app already fixed once in the nav drawer. It also can't be turned twice. */
  function syncFaces() {
    el.card.disabled = state.mode !== 'flip' || state.flipped;
    el.card.setAttribute('aria-hidden', String(state.flipped));
    el.cardBack.setAttribute('aria-hidden', String(!state.flipped));
  }

  function flip() {
    if (state.mode !== 'flip' || state.flipped || state.answered) return;
    turnToAnswer();
    el.grade.hidden = false;
    // The answer, not the buttons: this is what the reader just asked for, and
    // it is what a screen reader should say before offering a verdict on it.
    el.cardBack.focus();
  }

  /* The turn itself, with no opinion about who asked for it — the reader in
     Flip, the act of answering in Choose. */
  function turnToAnswer() {
    if (state.flipped) return;
    state.flipped = true;
    el.scene.classList.add('is-flipped');
    syncFaces();
  }

  /* -- Dragging ---------------------------------------------------------------------------
     Left is "still learning", right is "I knew it", and the card goes where it
     is thrown. This is the one screen in the app a reader touches dozens of
     times in a sitting, and reaching for one of two buttons every time is the
     kind of small tax that decides whether a review habit survives the month.

     Only in Flip, and only after the card has been turned: a swipe is a
     *grade*, and grading a card whose answer you haven't seen is not a
     shortcut, it is a mis-tap with consequences for the schedule.

     The direction test is what stops it stealing scrolls — a thumb travelling
     down a page drifts sideways by tens of pixels, so the horizontal component
     has to be the larger one before this claims the gesture. Once it has, it
     calls preventDefault(), which is why the move listener cannot be passive:
     without it the page scrolls under a card the reader is trying to throw.
     ---------------------------------------------------------------------------------------- */
  function setDrag(dx) {
    el.scene.style.setProperty('--drag', `${dx}px`);
    // A hair over 2 degrees at the grading threshold: enough that the card
    // reads as pivoting about a point below the screen rather than sliding
    // flat, which is what makes it feel like an object and not a panel.
    el.scene.style.setProperty('--drag-tilt', `${(dx / SWIPE_GRADE_DISTANCE) * 2.2}deg`);
    el.scene.style.setProperty('--drag-progress', String(Math.min(Math.abs(dx) / SWIPE_GRADE_DISTANCE, 1)));
    if (dx !== 0) el.scene.dataset.toward = dx > 0 ? 'right' : 'left';
  }

  /* The two halves of a throw, separated because they end at different times.
     `--drag` and `--drag-tilt` are the card following the finger and stop
     mattering the moment the throw is graded — the lean takes the transform
     from there. `data-toward` and `--drag-progress` are the *mark*: the edge
     of the card in the colour of the verdict it went to, which stays until
     the card leaves. A card graded from the buttons gets the mark without
     ever having had the drag. */
  function clearDrag() {
    el.scene.style.removeProperty('--drag');
    el.scene.style.removeProperty('--drag-tilt');
    el.scene.classList.remove('is-dragging');
  }

  function clearMark() {
    el.scene.style.removeProperty('--drag-progress');
    delete el.scene.dataset.toward;
  }

  function initDrag() {
    let startX = null;
    let startY = null;
    let claimed = false;

    const canDrag = () => state.mode === 'flip' && state.flipped && !state.answered;

    el.scene.addEventListener('touchstart', (event) => {
      if (!canDrag() || event.touches.length !== 1) {
        startX = null;
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      claimed = false;
    }, { passive: true });

    el.scene.addEventListener('touchmove', (event) => {
      if (startX === null || !canDrag()) return;

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!claimed) {
        // Undecided until the gesture has committed to an axis. 10px of slop
        // keeps a tap that wobbles from registering as a throw.
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
        claimed = true;
        el.scene.classList.add('is-dragging');
      }

      event.preventDefault();
      setDrag(dx);
    }, { passive: false });

    const release = (event) => {
      if (startX === null) return;
      const dx = claimed ? (event.changedTouches?.[0]?.clientX ?? startX) - startX : 0;
      startX = null;

      // The class comes off first so the card animates home rather than
      // teleporting, and the custom properties go with it.
      el.scene.classList.remove('is-dragging');

      if (claimed && Math.abs(dx) >= SWIPE_GRADE_DISTANCE) {
        // Left the custom properties in place on purpose: the card is where
        // the reader left it, and the lean below takes over from there rather
        // than snapping back through centre first.
        answer(dx > 0, null);
        return;
      }
      clearDrag();
    };

    el.scene.addEventListener('touchend', release, { passive: true });
    el.scene.addEventListener('touchcancel', () => {
      startX = null;
      el.scene.classList.remove('is-dragging');
      clearDrag();
    }, { passive: true });
  }

  initDrag();

  function renderCard() {
    const item = currentItem();
    const adapter = adapterFor(item);
    const flipMode = state.mode === 'flip';
    state.answered = false;

    el.prompt.textContent = flipMode ? 'Үүнийг мэдэх үү?' : adapter.question;
    el.front.replaceChildren(adapter.front(item));

    const hintText = adapter.hint(item);
    el.hint.textContent = hintText;
    el.hint.hidden = !hintText;

    /* The back, in both modes. It always carries the question restated over
       its own meaning — the one moment worth putting the two sides of a word
       in the same eyeline is the moment the reader has just committed to a
       guess, and in Choose it is the only thing that survives the turn.

       The example is Flip's alone, and the reason is height, measured on a
       390x844 phone. Both faces share one grid cell, so whatever the back
       carries sets the card's height *for the whole round* — and an example
       block takes the card from 176px to 294px. In Flip that is free: nothing
       is below the card but two buttons. In Choose it pushes four options and
       the Continue button under the fold, so a reader would have to scroll to
       finish answering a question they can currently answer without moving.
       Choose keeps its example in the feedback area below, where it costs
       nothing until there is something to say. */
    el.answerJp.replaceChildren(adapter.front(item));
    el.answer.textContent = adapter.meaning(item);
    const back = flipMode ? adapter.detail(item) : null;
    el.answerDetail.replaceChildren(...(back ? [back] : []));
    el.flipHint.hidden = !flipMode;

    el.feedback.hidden = true;
    el.detail.replaceChildren();
    el.scene.classList.remove('is-correct', 'is-leaning-left', 'is-leaning-right');
    state.direction = null;
    clearDrag();
    clearMark();
    faceFront();

    if (flipMode) {
      el.options.hidden = true;
      el.grade.hidden = true;
      el.shortcuts.textContent = 'Space дарж эргүүлнэ · 1 сурч байна · 2 мэдсэн';
    } else {
      renderOptions(item);
      el.options.hidden = false;
      el.grade.hidden = true;
      el.shortcuts.textContent = '1–4 дарж хариулна уу';
    }

    setProgress();

    // Restart the entrance animation: the class has to come off for a frame
    // before it can take effect again.
    el.scene.classList.remove('is-entering');
    requestAnimationFrame(() => el.scene.classList.add('is-entering'));
  }

  /* -- Answering ------------------------------------------------------------------------
     One path for both modes: a choose-mode click reports whether the chosen
     option was the right one, a flip-mode grade reports what the reader
     said about themselves. Everything after that — the schedule write, the
     feedback, the pacing — is the same.
     -------------------------------------------------------------------------------------- */

  function showFeedback(knewIt, record) {
    /* Where the card has come to rest, and where it will leave from. A flicked
       card is already off-centre and the lean simply takes over its position;
       a card graded from the buttons travels there now, so the button press
       and the flick end in exactly the same place.

       This replaces the shake a wrong answer used to get. The shake said
       "wrong" — which the verdict, the colour and the highlighted option all
       say already — where a lean says *which way it went*, which nothing else
       on screen does. It is also the gentler of the two, and forty times a
       session that matters. */
    state.direction = knewIt ? 'right' : 'left';
    clearDrag();
    el.scene.dataset.toward = state.direction;
    el.scene.style.setProperty('--drag-progress', '1');
    el.scene.classList.add(`is-leaning-${state.direction}`);
    if (knewIt) el.scene.classList.add('is-correct');

    /* Two different jobs, because the two modes leave the reader looking at
       different things.

       Both modes now show the answer on the card's own back, so neither of
       them needs this line to name it. What is left is the schedule, which is
       the one thing the card cannot say — and it is worth saying, because
       "back in three days" is the only visible evidence that answering
       honestly does anything at all. */
    el.verdict.textContent = knewIt
      ? `Зөв · ${describeNextReview(record)}`
      : `Тэмдэглэлээ · ${describeNextReview(record)}`;
    el.verdict.classList.toggle('is-correct', knewIt);
    el.verdict.classList.toggle('is-incorrect', !knewIt);

    // Flip already carries it on the back of the card.
    const detail = state.mode === 'flip' ? null : adapterFor(currentItem()).detail(currentItem());
    el.detail.replaceChildren(...(detail ? [detail] : []));

    el.feedback.hidden = false;

    /* A right answer moves on by itself — being made to confirm something
       you already got right is the friction that makes a quiz feel slow.
       A wrong one waits: that's the moment there's something to read, and
       taking it away after 650ms would be taking away the only part of the
       round that teaches. */
    if (knewIt) {
      el.continueButton.hidden = true;
      window.setTimeout(() => {
        if (state.answered && !el.panel.hidden) advance();
      }, CORRECT_PAUSE_MS);
    } else {
      el.continueButton.hidden = false;
      /* preventScroll, and it is load-bearing. Focusing a button below the
         fold scrolls it into view, and on a phone that means the card — which
         has just turned to show the answer — is pushed off the top of the
         screen at the exact moment it became worth reading. Focus still moves,
         so a keyboard reader is on the right control and Enter advances; the
         page simply stays where the reader was looking. */
      el.continueButton.focus({ preventScroll: true });
    }
  }

  function answer(knewIt, chosenButton) {
    if (state.answered) return;
    state.answered = true;

    const item = currentItem();
    const record = gradeItem(item.id, knewIt);

    if (knewIt) {
      state.correct += 1;
    } else {
      state.missed.push(item);
    }

    if (state.mode === 'choose') {
      for (const button of el.options.children) {
        button.disabled = true;
        const isAnswer = button.dataset.correct === 'true';
        // The right answer is always marked, not just the one that was
        // picked — a wrong guess should end with the reader having seen
        // which one it should have been.
        if (isAnswer) button.classList.add('is-answer');
        if (button === chosenButton && !isAnswer) button.classList.add('is-wrong');
      }
      /* And the card turns, the same turn Flip makes — this is the moment
         Choose has an answer to show, and showing it on the card's own back
         is what stops the page from growing a block underneath the options
         at the exact moment the reader is reading them. The highlighted
         option says which one; the card says what it means. */
      turnToAnswer();
    } else {
      // The card stays turned: the answer is what the reader is grading
      // themselves against, and it should still be there while they read the
      // verdict underneath it.
      el.grade.hidden = true;
    }

    setProgress();
    onGrade();
    showFeedback(knewIt, record);
  }

  /* The graded card leaves the way it was thrown, and the next one arrives
     face up on its own entrance. A deck: you discard to one side or the other,
     and you draw from the top.

     Driven by `animationend` rather than a timer, because reset.css collapses
     every animation in the app to 0.01ms under prefers-reduced-motion — a
     fixed setTimeout would hold a reader who asked for less motion at a blank
     card for the full 180ms. The timer that is here is a safety net for the
     case where the animation never runs at all (an off-screen panel, a tab in
     the background) and would otherwise strand the round.

     Guarded against firing twice: `once` on the listener, and a flag the
     timeout checks, so a late animationend can't advance a second time. */
  function advance() {
    const direction = state.direction;
    if (!direction) {
      step();
      return;
    }

    /* Off first. It is the same property as the exit animation and is
       declared later in quiz.css, so leaving it on meant the card never
       actually left — `advance` fell through to its safety timeout every
       time and the discard was invisible. A class that has outlived its own
       animation is a lie either way. */
    el.scene.classList.remove('is-entering');

    let stepped = false;
    const go = () => {
      if (stepped) return;
      stepped = true;
      step();
    };

    el.scene.addEventListener('animationend', function onEnd(event) {
      // Animation events bubble, and the correct-answer ring runs on a face
      // inside this element.
      if (event.target !== el.scene) return;
      el.scene.removeEventListener('animationend', onEnd);
      go();
    });
    window.setTimeout(go, EXIT_MS + 120);

    el.scene.classList.add(`is-leaving-${direction}`);
  }

  function step() {
    el.scene.classList.remove('is-leaving-left', 'is-leaving-right');
    state.index += 1;
    if (state.index >= state.queue.length) {
      finish();
    } else {
      renderCard();
    }
  }

  /* -- Summary --------------------------------------------------------------------------- */

  function finish() {
    const total = state.queue.length;
    onFinish({ total, correct: state.correct, missed: state.missed.slice(), mode: state.mode });

    el.barFill.style.setProperty('--progress', '1');
    el.summaryScore.textContent = `${state.correct} / ${total}`;
    el.summaryScore.classList.toggle('is-perfect', total > 0 && state.missed.length === 0);

    const pct = total === 0 ? 0 : Math.round((state.correct / total) * 100);
    el.summaryText.textContent = state.missed.length === 0
      ? 'Бүгд зөв. Энэ давталтаас үлдсэн юм алга.'
      : `Энэ давталтад ${pct}%. Доорх зүйлс бусдаасаа эрт эргэж ирнэ.`;

    el.missedList.replaceChildren();
    for (const item of state.missed) {
      const adapter = adapterFor(item);
      const row = document.createElement('li');
      row.className = 'quiz__missed-item';

      const front = document.createElement('span');
      front.className = 'quiz__missed-front';
      front.append(adapter.front(item));

      const meaning = document.createElement('span');
      meaning.className = 'quiz__missed-meaning meta';
      meaning.textContent = adapter.meaning(item);

      row.append(front, meaning);
      el.missedList.append(row);
    }

    const hasMissed = state.missed.length > 0;
    el.missedHeading.hidden = !hasMissed;
    el.missedList.hidden = !hasMissed;
    el.retryMissedButton.hidden = !hasMissed;
    el.retryMissedButton.textContent =
      `Practise the ${state.missed.length} you missed`;

    el.round.hidden = true;
    el.summary.hidden = false;
    el.summary.focus?.();
  }

  /* -- Lifecycle ------------------------------------------------------------------------- */

  function run(items, { mode = state.mode, pool = items, title = state.title } = {}) {
    state.mode = mode;
    state.queue = items;
    state.pool = pool.length >= CHOICE_COUNT ? pool : items;
    state.index = 0;
    state.correct = 0;
    state.missed = [];
    state.title = title;

    el.title.textContent = title;
    el.title.hidden = !title;
    el.panel.hidden = false;
    el.summary.hidden = true;
    el.round.hidden = false;

    renderCard();
  }

  function close() {
    el.panel.hidden = true;
    onExit();
  }

  el.card.addEventListener('click', flip);

  el.missButton.addEventListener('click', () => answer(false, null));
  el.knewButton.addEventListener('click', () => answer(true, null));
  el.continueButton.addEventListener('click', advance);

  // Ending a round early still counts what was graded: the schedule already
  // has those answers, and reporting a 3/10 for a round stopped after three
  // questions would punish stopping. Leaving before answering anything is
  // just leaving — a "0 / 0" summary reports nothing and asks for a click
  // to dismiss it.
  el.exitButton.addEventListener('click', () => {
    const graded = state.index + (state.answered ? 1 : 0);
    if (graded === 0) {
      close();
      return;
    }
    state.queue = state.queue.slice(0, graded);
    finish();
  });

  el.againButton.addEventListener('click', () => {
    const next = onNewRound ? onNewRound() : shuffled(state.pool).slice(0, state.queue.length || 10);
    if (!next || next.length === 0) {
      close();
      return;
    }
    run(next, { pool: state.pool, title: state.title });
  });

  el.retryMissedButton.addEventListener('click', () => run(shuffled(state.missed), {
    pool: state.pool,
    title: state.title,
  }));

  el.doneButton.addEventListener('click', close);

  /* Keyboard: 1–4 answer in Choose, Space turns the card and 1/2 grade it in
     Flip, Enter continues past a wrong answer. Guarded by isActive() so the
     keys never fire while another view is on screen.

     Space is handled here rather than left to the card button's own native
     activation, because it has to work wherever focus happens to be — the
     grade buttons, the End button, nothing at all. When the card *does* have
     focus, preventDefault() stops the native click, so it only turns once. */
  function handleKeydown(event) {
    if (event.repeat) return;
    if (el.panel.hidden || !el.summary.hidden) return;
    if (!isActive()) return;
    if (event.target.matches('input, textarea')) return;

    if (state.answered) {
      if (event.key === 'Enter' && !el.continueButton.hidden) {
        event.preventDefault();
        advance();
      }
      return;
    }

    if (state.mode === 'choose') {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < el.options.children.length) {
        event.preventDefault();
        el.options.children[index].click();
      }
      return;
    }

    if (!state.flipped) {
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        flip();
      }
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      el.missButton.click();
    } else if (event.key === '2') {
      event.preventDefault();
      el.knewButton.click();
    }
  }

  document.addEventListener('keydown', handleKeydown);

  return {
    element: el.panel,
    run,
    close,
    get missedCount() { return state.missed.length; },
  };
}

/* -- Mode picker -------------------------------------------------------------------------
   The row of study modes shown before a round starts. Lives here rather
   than in each caller so Review and Lessons offer the same two modes with
   the same labels and the same explanation underneath.
   -------------------------------------------------------------------------------------------- */

/* Both the Review view and the Lessons view build one of these, and both
   live in the document at once (views are hidden, not removed). The label's
   id has to be unique per instance or the second group's aria-labelledby
   points at the first one's label — and duplicate ids are invalid markup
   regardless of who notices. */
let modePickerCount = 0;

function createModePicker(initialMode, onChange) {
  const labelId = `quiz-mode-label-${(modePickerCount += 1)}`;

  const wrap = document.createElement('div');
  wrap.className = 'quiz-modes';

  const label = document.createElement('p');
  label.className = 'quiz-modes__label';
  label.id = labelId;
  label.textContent = 'Хэрхэн сурмаар байна?';

  const group = document.createElement('div');
  group.className = 'quiz-modes__group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', labelId);

  const hint = document.createElement('p');
  hint.className = 'quiz-modes__hint meta';

  let current = MODES.some((m) => m.id === initialMode) ? initialMode : 'choose';

  const buttons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip quiz-modes__button';
    button.dataset.mode = mode.id;
    button.textContent = mode.label;
    button.addEventListener('click', () => {
      current = mode.id;
      sync();
      onChange(mode.id);
    });
    group.append(button);
    return button;
  });

  function sync() {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === current));
    }
    hint.textContent = MODES.find((mode) => mode.id === current).hint;
  }

  sync();
  wrap.append(label, group, hint);

  return { wrap, get mode() { return current; } };
}

export { createQuiz, createModePicker, ADAPTERS, MODES, deckKeyForItemId, adapterFor };
