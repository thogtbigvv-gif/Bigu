/* ==========================================================================
   lessons.js
   Loads data/lessons.json and renders it as a browsable reference inside
   the #lessons view: one disclosure per lesson, opening onto a word list.
   Sits alongside vocabulary/grammar/kanji as reference material, not part
   of the practice deck.

   Each word has its own "Mark as learned" toggle, same shape and store as
   vocabulary/grammar/kanji's mastery buttons (review.js over storage.js's
   `progress` map, keyed by each word's `id`), so a lesson's progress
   survives a reload. Each lesson group also has its own "Quiz" button: a
   round scoped to that lesson's word list, shown in place of the list.

   The quiz is js/quiz.js — the same panel, modes, and grading the Review
   deck uses, rather than the separate implementation that used to live
   here. It also grades into the shared schedule like every other grading
   surface. It deliberately didn't, once — it was kept as a separate
   quick-recall tool — but the result was that "known" meant two different
   things depending on which screen you were on: passing a word in the quiz
   left it unlearned while tapping the chip beside it marked it learned.
   One progress model is worth more than the separation was.
   ========================================================================== */

import { settings } from './storage.js';
import { isLearned, setLearned, shuffled } from './review.js';
import { createQuiz, createModePicker } from './quiz.js';
import { createContentLoader, loadIntoView, OFFLINE_HINT } from './content.js';

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

function countLearned(words) {
  return words.filter((entry) => isLearned(entry.id)).length;
}

/* -- Word rendering --------------------------------------------------------------------
   Furigana only where the word and reading actually differ (kanji terms);
   kana-only entries (アメリカ, ここ, いくら…) render as plain text, same
   rule vocabulary.js uses for words with no kanji field. quiz.js's lessons
   adapter follows the same rule for the quiz card front, so a word reads
   identically in both places.
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

/* Returns the button and its own sync(), so the row can be refreshed from
   outside \u2014 the lesson quiz grades the same words this chip reflects, and
   coming back from a round with the chips still showing the old state was
   the visible half of the two-meanings-of-"known" problem. */
function createProgressButton(entry, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip lesson-word__progress';

  const sync = () => {
    const learned = isLearned(entry.id);
    button.setAttribute('aria-pressed', String(learned));
    button.textContent = learned ? 'Learned \u2713' : 'Mark as learned';
  };

  button.addEventListener('click', () => {
    setLearned(entry.id, !isLearned(entry.id));
    sync();
    onChange();
  });

  sync();
  return { button, sync };
}

function createWordRow(entry, onProgressChange) {
  const item = document.createElement('li');
  item.className = 'lesson-word';

  const head = document.createElement('div');
  head.className = 'lesson-word__head';
  head.append(createHeadword(entry));

  const meaning = document.createElement('p');
  meaning.className = 'lesson-word__meaning meta';
  meaning.textContent = entry.english;

  const { button, sync } = createProgressButton(entry, onProgressChange);
  item.append(head, meaning, button);
  return { item, sync };
}

/* -- Lesson groups ---------------------------------------------------------------------
   Native disclosure pattern: a button toggling its own aria-expanded plus
   a sibling region, no external state store. First lesson opens by
   default so the view isn't a wall of 15 closed rows on first visit. The
   quiz trigger is a separate sibling button (not nested inside the
   disclosure button) so both stay independently clickable/focusable.
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
  button.setAttribute('aria-expanded', String(expanded));
  button.setAttribute('aria-controls', bodyId);

  const title = document.createElement('span');
  title.className = 'lesson-group__title';
  title.textContent = `${lesson.lesson}. ${lesson.title}`;

  const count = document.createElement('span');
  count.className = 'lesson-group__count meta';

  const updateCount = () => {
    const learned = countLearned(lesson.words);
    count.textContent = `${lesson.words.length} words \u00b7 ${learned} learned`;
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
  body.hidden = !expanded;

  const list = document.createElement('ul');
  list.className = 'lesson-word-list';
  const rows = lesson.words.map((entry) => createWordRow(entry, updateCount));
  list.append(...rows.map((row) => row.item));
  body.append(list);

  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
  });

  li.append(heading, body);

  return {
    element: li,
    refresh() {
      updateCount();
      for (const row of rows) row.sync();
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

function getContentContainer(view) {
  let content = view.querySelector('.lessons-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'lessons-content';
    view.append(content);
  }
  return content;
}

function renderLessons(container, lessons) {
  const intro = document.createElement('div');
  intro.className = 'lessons-intro';

  const count = document.createElement('p');
  count.className = 'lessons-meta meta';
  count.textContent = `${lessons.length} lessons · ${lessons.reduce((n, l) => n + l.words.length, 0)} words`;

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

  await loadIntoView(getContentContainer(view), {
    skeleton: 'rows',
    load: loadLessons,
    render: renderLessons,
    errorTitle: 'Lessons didn’t load.',
    errorDetail: `The lesson list is in data/lessons.json. ${OFFLINE_HINT}`,
  });
}

export { initLessons, loadLessons };
