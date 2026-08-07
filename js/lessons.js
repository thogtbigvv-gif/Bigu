/* ==========================================================================
   lessons.js
   Loads data/lessons.json and renders it as a browsable reference inside
   the #lessons view: one disclosure per lesson, opening onto a word list.
   Sits alongside vocabulary/grammar/kanji as reference material, not part
   of the practice deck.

   Each word has its own "Remember this" toggle, same shape and store as
   vocabulary/grammar/kanji's (review.js over storage.js's `progress` map,
   keyed by each word's `id`), so a lesson's progress survives a reload.
   Each lesson group also has its own "Quiz" button: a round scoped to that
   lesson's word list, shown in place of the list.

   The quiz is js/quiz.js — the same panel, the same two study modes, and
   the same grading the Review deck uses, rather than the separate
   implementation that used to live here.

   That quiz grades into the shared schedule like every other grading
   surface. It deliberately didn't, once — it was kept as a separate
   quick-recall tool — but the result was that "in memory" meant two
   different things depending on which screen you were on: passing a word
   in the quiz left it unheld while tapping the mark beside it held it.
   One progress model is worth more than the separation was.
   ========================================================================== */

import { settings } from './storage.js';
import { isRemembered, setRemembered, shuffled } from './review.js';
import { createQuiz, createModePicker } from './quiz.js';
import { createContentLoader, createIcon, getViewContainer, loadIntoView, OFFLINE_HINT } from './content.js';

const DATA_URL = 'data/lessons.json';
const VIEW_ID = 'lessons';

/* Shared with practice.js: how you like to study is one preference, not one
   per surface, so picking "Flip" in a lesson quiz is still "Flip" the next
   time you open the Review deck. */
const QUIZ_MODE_SETTING_KEY = 'quizMode';

/* -- Data ------------------------------------------------------------------------- */

const loadLessons = createContentLoader(DATA_URL, 'lessons');

/* -- Progress ------------------------------------------------------------------------
   The shared schedule in review.js, same as every other view. Lesson word
   ids (l1-01, l1-02…) live in their own namespace, so they never collide
   with vocabulary/grammar/kanji's n3-/gr-/kj- ids in the same store — and
   practice.js routes that `l` prefix back to this module's card layout, so
   lesson words join the review pool instead of being a dead end.
   -------------------------------------------------------------------------------------- */

function countRemembered(words) {
  return words.filter((entry) => isRemembered(entry.id)).length;
}

/* -- Word rendering --------------------------------------------------------------------
   Furigana only where the word and reading actually differ (kanji terms);
   kana-only entries (アメリカ, ここ, いくら…) render as plain text, same
   rule vocabulary.js uses for words with no kanji field. Shared by the
   reference list (createWordRow). quiz.js's lessons adapter follows the
   same rule for the quiz card front, so a word reads identically in both
   places.
   -------------------------------------------------------------------------------------- */

function createHeadword(entry) {
  if (entry.word === entry.reading) {
    const span = document.createElement('span');
    span.lang = 'ja';
    span.textContent = entry.word;
    return span;
  }

  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = entry.reading;
  ruby.append(entry.word, rt);
  return ruby;
}

/* -- The per-word control -----------------------------------------------------------
   A lesson opens onto eighteen words, and every one of them used to carry a
   full-width "Remember this" chip. Eighteen identical buttons, each wider
   and heavier than the Japanese word above it, is a screen where the
   loudest thing repeated eighteen times is the *action* and the quietest is
   the vocabulary \u2014 exactly backwards for a page whose whole job is to let a
   reader read a lesson's words.

   Here it's a mark instead: an outlined circle that fills when the word is
   held. Same state, same store, same aria-pressed semantics as the chip on
   a vocabulary card \u2014 the label lives in .sr-only rather than on screen,
   because on this screen the row's meaning is carried by the word and the
   control only has to be reachable and legible at a glance. The full chip
   stays everywhere it is one of two or three things on a card.

   Returns its own sync() so the row can be refreshed from outside \u2014 the
   lesson quiz grades the same words this reflects, and coming back from a
   round with the marks showing the old state was the visible half of the
   two-meanings-of-"known" problem.
   ------------------------------------------------------------------------------------ */
function createProgressMark(entry, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lesson-word__mark';

  const icon = createIcon('lesson-word__mark-icon', [
    ['circle', { cx: '8', cy: '8', r: '5.5' }],
  ]);

  const label = document.createElement('span');
  label.className = 'sr-only';

  button.append(icon, label);

  const sync = () => {
    const remembered = isRemembered(entry.id);
    button.setAttribute('aria-pressed', String(remembered));
    label.textContent = remembered
      ? `${entry.word} is in memory \u2014 take it back out`
      : `Keep ${entry.word} in memory`;
  };

  button.addEventListener('click', () => {
    setRemembered(entry.id, !isRemembered(entry.id));
    sync();
    onChange();
  });

  sync();
  return { button, sync };
}

function createWordRow(entry, onProgressChange) {
  const item = document.createElement('li');
  item.className = 'lesson-word';

  const { button, sync } = createProgressMark(entry, onProgressChange);

  const body = document.createElement('div');
  body.className = 'lesson-word__body';

  const head = document.createElement('div');
  head.className = 'lesson-word__head';
  head.append(createHeadword(entry));

  const meaning = document.createElement('p');
  meaning.className = 'lesson-word__meaning meta';
  meaning.textContent = entry.english;

  body.append(head, meaning);
  item.append(button, body);
  return { item, sync };
}

/* -- Lesson groups ---------------------------------------------------------------------
   Native disclosure pattern: a button toggling its own aria-expanded plus
   a sibling region, no external state store. First lesson opens by
   default so the view isn't a wall of 15 closed rows on first visit. The
   quiz trigger is a separate sibling button (not nested inside the
   disclosure button) so both stay independently clickable/focusable.

   A group's word rows are built the first time it opens, not when the view
   renders. Fifteen lessons of ~18 words each meant roughly 250 word rows
   and their controls were constructed on arrival, of which fourteen
   lessons' worth — around 93% — were inside collapsed regions the reader
   might never open. The same argument app.js already makes for views ("a
   view the reader never opens never builds its DOM"), one level down.
   -------------------------------------------------------------------------------------- */

function createLessonGroup(lesson, index, onQuiz) {
  const headerId = `lesson-${lesson.lesson}-header`;
  const bodyId = `lesson-${lesson.lesson}-body`;
  const expanded = index === 0;

  const li = document.createElement('li');
  li.className = 'card card--interactive lesson-group';

  const heading = document.createElement('h2');
  heading.className = 'lesson-group__heading';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = headerId;
  button.className = 'lesson-group__header';
  button.setAttribute('aria-controls', bodyId);

  const title = document.createElement('span');
  title.className = 'lesson-group__title';
  title.textContent = `${lesson.lesson}. ${lesson.title}`;

  const count = document.createElement('span');
  count.className = 'lesson-group__count meta';

  const updateCount = () => {
    const remembered = countRemembered(lesson.words);
    count.textContent = `${lesson.words.length} words \u00b7 ${remembered} in memory`;
  };
  updateCount();

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'lesson-group__icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('d', 'M6 9l6 6 6-6');
  icon.append(iconPath);

  button.append(title, count, icon);

  const quizButton = document.createElement('button');
  quizButton.type = 'button';
  quizButton.className = 'button button--secondary lesson-group__quiz-button';
  quizButton.textContent = 'Quiz';
  quizButton.setAttribute('aria-label', `Quiz lesson ${lesson.lesson}: ${lesson.title}`);
  quizButton.addEventListener('click', () => onQuiz(lesson));

  heading.append(button, quizButton);

  const body = document.createElement('div');
  body.id = bodyId;
  body.className = 'lesson-group__body';
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', headerId);

  const list = document.createElement('ul');
  list.className = 'lesson-word-list';
  body.append(list);

  let rows = null;

  function buildRows() {
    if (rows) return;
    rows = lesson.words.map((entry) => createWordRow(entry, updateCount));
    list.append(...rows.map((row) => row.item));
  }

  function setExpanded(next) {
    if (next) buildRows();
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
  }

  button.addEventListener('click', () => {
    setExpanded(button.getAttribute('aria-expanded') !== 'true');
  });

  setExpanded(expanded);

  li.append(heading, body);

  return {
    element: li,
    // Only what's on screen needs re-syncing; a group that has never been
    // opened has no marks to correct, and will read the store when it does
    // open. The count in the header always refreshes, because that is
    // visible whether the group is open or not.
    refresh() {
      updateCount();
      if (rows) for (const row of rows) row.sync();
    },
  };
}

/* -- Quiz --------------------------------------------------------------------------------
   One lesson at a time, run by the shared quiz in js/quiz.js — the same
   panel, the same two study modes, and the same grading the Review deck
   uses. This module used to carry its own reveal/grade/summary
   implementation, near-identical to practice.js's, which is most of why
   the two quizzes felt like different features.

   The quiz's default "Choose" mode matters most here: Lessons is the
   beginner surface, and asking someone to honestly self-grade a word they
   met a minute ago is asking for a number that means nothing. Four answers
   and instant checking asks something they can actually answer.
   -------------------------------------------------------------------------------------- */

/* -- Rendering ------------------------------------------------------------------------- */

function renderLessons(container, lessons) {
  const wordCount = lessons.reduce((sum, lesson) => sum + lesson.words.length, 0);

  const intro = document.createElement('div');
  intro.className = 'lessons-intro';

  const count = document.createElement('p');
  count.className = 'lessons-meta meta';
  // The word total, not just the lesson count. "15 lessons" says nothing
  // about the size of the commitment; the two numbers together are what a
  // reader deciding whether to start actually wants.
  count.textContent = `${lessons.length} lessons \u00b7 ${wordCount} words`;

  const list = document.createElement('ul');
  list.className = 'lessons-list';

  const groups = [];

  /* The mode picker sits above the lesson list rather than inside each
     lesson: it's a preference about how you like to study, not a property
     of lesson 7, and asking once is one question instead of fifteen. */
  const modePicker = createModePicker(settings.get(QUIZ_MODE_SETTING_KEY), (mode) => {
    settings.set(QUIZ_MODE_SETTING_KEY, mode);
  });

  intro.append(count, modePicker.wrap);

  // The lesson the current round came from, so "New round" reshuffles the
  // same one rather than falling back to the quiz's generic reshuffle.
  let activeLesson = null;

  const quiz = createQuiz({
    isActive: () => location.hash.slice(1) === VIEW_ID,
    // A round changes the same records the lesson rows display, so the list
    // behind the panel is brought back into agreement as it happens rather
    // than being left showing what was true before the round.
    onGrade() {
      for (const group of groups) group.refresh();
    },
    onNewRound: () => (activeLesson ? shuffled(activeLesson.words) : null),
    onExit() {
      activeLesson = null;
      intro.hidden = false;
      list.hidden = false;
    },
  });

  groups.push(
    ...lessons.map((lesson, index) =>
      createLessonGroup(lesson, index, (chosenLesson) => {
        activeLesson = chosenLesson;
        intro.hidden = true;
        list.hidden = true;
        quiz.run(shuffled(chosenLesson.words), {
          mode: modePicker.mode,
          pool: chosenLesson.words,
          title: `${chosenLesson.lesson}. ${chosenLesson.title}`,
        });
      }),
    ),
  );

  list.append(...groups.map((group) => group.element));

  container.replaceChildren(intro, list, quiz.element);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initLessons() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'lessons-content'), {
    skeleton: 'rows',
    load: loadLessons,
    render: renderLessons,
    errorTitle: 'Lessons didn’t load.',
    errorDetail: `The lesson list is in data/lessons.json. ${OFFLINE_HINT}`,
  });
}

export { initLessons, loadLessons };
