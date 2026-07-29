/* ==========================================================================
   lessons.js
   Loads data/lessons.json and renders it as a browsable reference inside
   the #lessons view: one disclosure per lesson, opening onto a plain word
   list. Read-only — no progress tracking, no search, no ties into
   practice.js or storage.js. This sits alongside vocabulary/grammar/kanji
   as reference material, not part of the practice deck.
   ========================================================================== */

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

/* -- Word rows -----------------------------------------------------------------------
   Furigana only where the word and reading actually differ (kanji terms);
   kana-only entries (アメリカ, ここ, いくら…) render as plain text, same
   rule vocabulary.js uses for words with no kanji field.
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

function createWordRow(entry) {
  const item = document.createElement('li');
  item.className = 'lesson-word';

  const head = document.createElement('div');
  head.className = 'lesson-word__head';
  head.append(createHeadword(entry));

  const meaning = document.createElement('p');
  meaning.className = 'lesson-word__meaning meta';
  meaning.textContent = entry.english;

  item.append(head, meaning);
  return item;
}

/* -- Lesson groups ---------------------------------------------------------------------
   Native disclosure pattern: a button toggling its own aria-expanded plus
   a sibling region, no external state store. First lesson opens by
   default so the view isn't a wall of 15 closed rows on first visit.
   -------------------------------------------------------------------------------------- */

function createLessonGroup(lesson, index) {
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
  count.textContent = `${lesson.words.length} words`;

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'lesson-group__icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('d', 'M6 9l6 6 6-6');
  icon.append(iconPath);

  button.append(title, count, icon);
  heading.append(button);

  const body = document.createElement('div');
  body.id = bodyId;
  body.className = 'lesson-group__body';
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', headerId);
  body.hidden = !expanded;

  const list = document.createElement('ul');
  list.className = 'lesson-word-list';
  list.append(...lesson.words.map(createWordRow));
  body.append(list);

  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
  });

  li.append(heading, body);
  return li;
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
  list.append(...lessons.map((lesson, index) => createLessonGroup(lesson, index)));

  container.replaceChildren(intro, list);
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
