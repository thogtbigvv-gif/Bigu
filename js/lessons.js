/* ==========================================================================
   lessons.js
   Loads data/lessons.json and renders it as a browsable reference inside
   the #lessons view: one disclosure per lesson, opening onto a word list.
   Sits alongside vocabulary/grammar/kanji as reference material, not part
   of the practice deck.

   Each word has its own "Mark as learned" toggle, same shape and store
   as vocabulary/grammar/kanji's mastery buttons (storage.js's `progress`
   map, keyed by each word's `id`), so a lesson's progress survives a
   reload. Each lesson group also has its own "Quiz" button: a self-graded
   flashcard round scoped to that lesson's word list (reveal → self-mark →
   next, same interaction language as practice.js's deck quizzes), shown
   in place of the lesson list — purely in-memory for the session, doesn't
   touch the progress store, kept as a separate quick-recall tool rather
   than another way to mark words learned.
   ========================================================================== */

import { progress } from './storage.js';

const DATA_URL = 'data/lessons.json';
const VIEW_ID = 'lessons';

let cachedData = null;

/* -- Data ------------------------------------------------------------------------- */

async function loadLessons() {
  if (cachedData) return cachedData;

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load lessons (${response.status})`);
  }

  cachedData = await response.json();
  return cachedData;
}

/* -- Progress ------------------------------------------------------------------------
   Same shape as vocabulary.js's isLearned/setLearned: one shared
   `progress` map store, keyed by id, `{ learned: boolean }`. Lesson word
   ids (l1-01, l1-02…) live in their own namespace, so they never collide
   with vocabulary/grammar/kanji's n3-/gr-/kj- ids in the same store.
   -------------------------------------------------------------------------------------- */

function isLearned(wordId) {
  return Boolean(progress.get(wordId)?.learned);
}

function setLearned(wordId, learned) {
  progress.set(wordId, { ...progress.get(wordId), learned });
}

function countLearned(words) {
  return words.filter((entry) => isLearned(entry.id)).length;
}

/* -- Word rendering --------------------------------------------------------------------
   Furigana only where the word and reading actually differ (kanji terms);
   kana-only entries (アメリカ, ここ, いくら…) render as plain text, same
   rule vocabulary.js uses for words with no kanji field. Shared by the
   reference list (createWordRow) and the quiz card front, so a word reads
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
  return button;
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

  item.append(head, meaning, createProgressButton(entry, onProgressChange));
  return item;
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
  li.className = 'lesson-group';

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
  list.append(...lesson.words.map((entry) => createWordRow(entry, updateCount)));
  body.append(list);

  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
  });

  li.append(heading, body);
  return li;
}

/* -- Quiz --------------------------------------------------------------------------------
   One lesson at a time: shuffle its words, walk the deck card by card
   (headword shown via the same createHeadword used in the reference
   list — readings stay visible, only the English meaning hides behind
   "Show meaning"), self-mark each as "Still learning" or "I knew it",
   then a summary with the round's score. Nothing here writes to
   storage.js; closing the quiz just returns to the lesson list.
   -------------------------------------------------------------------------------------- */

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQuizPanel() {
  const panel = document.createElement('div');
  panel.className = 'lessons-quiz';
  panel.hidden = true;

  const exitTop = document.createElement('button');
  exitTop.type = 'button';
  exitTop.className = 'button button--secondary lessons-quiz__exit';
  exitTop.textContent = '\u2190 Back to lessons';

  const title = document.createElement('p');
  title.className = 'lessons-quiz__title';

  /* Session phase: status line, card, reveal button, grade buttons. */
  const session = document.createElement('div');
  session.className = 'lessons-quiz__session';
  session.hidden = true;

  const status = document.createElement('p');
  status.className = 'lessons-quiz__status meta';
  status.setAttribute('aria-live', 'polite');

  const card = document.createElement('div');
  card.className = 'card lessons-quiz-card';

  const headword = document.createElement('p');
  headword.className = 'lessons-quiz-card__headword';

  const answer = document.createElement('div');
  answer.className = 'lessons-quiz-card__answer';
  answer.hidden = true;

  const meaning = document.createElement('p');
  meaning.className = 'lessons-quiz-card__meaning';

  answer.append(meaning);
  card.append(headword, answer);

  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'button button--secondary lessons-quiz__reveal';
  revealButton.textContent = 'Show meaning';

  const grade = document.createElement('div');
  grade.className = 'lessons-quiz__grade';
  grade.hidden = true;

  const stillLearningButton = document.createElement('button');
  stillLearningButton.type = 'button';
  stillLearningButton.className = 'button button--secondary';
  stillLearningButton.textContent = 'Still learning';

  const knewItButton = document.createElement('button');
  knewItButton.type = 'button';
  knewItButton.className = 'button button--primary';
  knewItButton.textContent = 'I knew it';

  grade.append(stillLearningButton, knewItButton);

  const shortcutHint = document.createElement('p');
  shortcutHint.className = 'lessons-quiz__shortcut-hint meta';
  shortcutHint.textContent = 'Space to reveal \u00b7 1 still learning \u00b7 2 knew it';

  session.append(status, card, revealButton, grade, shortcutHint);

  /* Summary phase. */
  const summary = document.createElement('div');
  summary.className = 'lessons-quiz__summary';
  summary.hidden = true;

  const summaryText = document.createElement('p');
  summaryText.className = 'lessons-quiz__summary-text';

  const summaryActions = document.createElement('div');
  summaryActions.className = 'lessons-quiz__summary-actions';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--primary';
  againButton.textContent = 'Quiz again';

  const exitBottom = document.createElement('button');
  exitBottom.type = 'button';
  exitBottom.className = 'button button--secondary';
  exitBottom.textContent = 'Back to lessons';

  summaryActions.append(againButton, exitBottom);
  summary.append(summaryText, summaryActions);

  panel.append(exitTop, title, session, summary);

  return {
    panel, exitTop, title,
    session, status, card, headword, answer, meaning,
    revealButton, grade, stillLearningButton, knewItButton, shortcutHint,
    summary, summaryText, againButton, exitBottom,
  };
}

function createQuizController(elements, { onExit }) {
  const state = { words: [], queue: [], index: 0, correct: 0 };

  function showPhase(phase) {
    elements.session.hidden = phase !== 'session';
    elements.summary.hidden = phase !== 'summary';
  }

  function renderCard() {
    const word = state.queue[state.index];
    elements.status.textContent =
      `Card ${state.index + 1} / ${state.queue.length} \u00b7 ${state.correct} knew it so far`;

    elements.headword.replaceChildren(createHeadword(word));
    elements.meaning.textContent = word.english;

    elements.answer.hidden = true;
    elements.grade.hidden = true;
    elements.revealButton.hidden = false;
  }

  function finish() {
    elements.summaryText.textContent =
      `${state.correct} / ${state.queue.length} marked "I knew it" this round.`;
    showPhase('summary');
  }

  function advance() {
    state.index += 1;
    if (state.index >= state.queue.length) {
      finish();
    } else {
      renderCard();
    }
  }

  function grade(knew) {
    if (knew) state.correct += 1;
    advance();
  }

  function start() {
    state.queue = shuffled(state.words);
    state.index = 0;
    state.correct = 0;
    showPhase('session');
    renderCard();
  }

  function open(lesson) {
    state.words = lesson.words;
    elements.title.textContent = `${lesson.lesson}. ${lesson.title}`;
    elements.panel.hidden = false;
    start();
  }

  elements.revealButton.addEventListener('click', () => {
    elements.answer.hidden = false;
    elements.grade.hidden = false;
    elements.revealButton.hidden = true;
  });

  elements.stillLearningButton.addEventListener('click', () => grade(false));
  elements.knewItButton.addEventListener('click', () => grade(true));
  elements.againButton.addEventListener('click', start);
  elements.exitTop.addEventListener('click', onExit);
  elements.exitBottom.addEventListener('click', onExit);

  /* Space/Enter reveals, 1/2 grade — only while a lessons quiz card is
     actually on screen (the view is active, panel open, session phase
     showing), so these keys don't hijack typing elsewhere in the app. */
  function handleKeydown(event) {
    if (event.repeat) return;
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (elements.panel.hidden || elements.session.hidden) return;

    const revealed = !elements.answer.hidden;

    if (!revealed) {
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        elements.revealButton.click();
      }
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      elements.stillLearningButton.click();
    } else if (event.key === '2') {
      event.preventDefault();
      elements.knewItButton.click();
    }
  }

  document.addEventListener('keydown', handleKeydown);

  return { open };
}

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
  const intro = document.createElement('p');
  intro.className = 'lessons-meta meta';
  intro.textContent = `${lessons.length} lessons`;

  const list = document.createElement('ul');
  list.className = 'lessons-list';

  const quizElements = buildQuizPanel();
  const quizController = createQuizController(quizElements, {
    onExit() {
      quizElements.panel.hidden = true;
      intro.hidden = false;
      list.hidden = false;
    },
  });

  list.append(
    ...lessons.map((lesson, index) =>
      createLessonGroup(lesson, index, (chosenLesson) => {
        intro.hidden = true;
        list.hidden = true;
        quizController.open(chosenLesson);
      }),
    ),
  );

  container.replaceChildren(intro, list, quizElements.panel);
}

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initLessons() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const data = await loadLessons();
    renderLessons(content, data);
  } catch (error) {
    console.error('[Bigu]', error);
    renderError(content, 'Lessons could not be loaded right now.');
  }
}

export { initLessons };
