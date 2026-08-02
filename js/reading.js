/* ==========================================================================
   reading.js
   Foundation for the #reading view: loads data/reading.json and renders
   each passage as a short, read-only reference card — title, then each
   sentence as Japanese text with a reading line and a Mongolian
   translation, the same jp/.reading/.meta stacking vocabulary.js and
   grammar.js already use for their example sentences.

   Skeleton only, on purpose: no lesson grouping, no comprehension quiz,
   no audio, no progress tracking. Those are separate future features —
   this just proves out the view, the data shape, and (via content.js)
   the shared loader every future content module will reuse.
   ========================================================================== */

import { createContentLoader } from './content.js';

const DATA_URL = 'data/reading.json';
const VIEW_ID = 'reading';

const loadReading = createContentLoader(DATA_URL, 'reading');

/* -- Passage rendering ------------------------------------------------------------- */

function createSentence(sentence) {
  const wrap = document.createElement('div');
  wrap.className = 'reading-card__sentence';

  const jp = document.createElement('p');
  jp.lang = 'ja';
  jp.textContent = sentence.jp;

  const reading = document.createElement('p');
  reading.className = 'reading';
  reading.lang = 'ja';
  reading.textContent = sentence.reading;

  const translation = document.createElement('p');
  translation.className = 'meta';
  translation.textContent = sentence.mn;

  wrap.append(jp, reading, translation);
  return wrap;
}

function createPassageCard(passage, level) {
  const item = document.createElement('li');
  item.className = 'reading-card';
  item.dataset.passageId = passage.id;

  const head = document.createElement('div');
  head.className = 'reading-card__head';

  const title = document.createElement('p');
  title.className = 'reading-card__title';
  title.lang = 'ja';
  title.textContent = passage.title;

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';
  tag.textContent = level;

  head.append(title, tag);

  const titleMn = document.createElement('p');
  titleMn.className = 'reading-card__title-mn meta';
  titleMn.textContent = passage.titleMn;

  const body = document.createElement('div');
  body.className = 'reading-card__body';
  body.append(...passage.sentences.map(createSentence));

  item.append(head, titleMn, body);
  return item;
}

/* -- Rendering ------------------------------------------------------------------------- */

function getContentContainer(view) {
  let content = view.querySelector('.reading-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'reading-content';
    view.append(content);
  }
  return content;
}

function renderList(container, data) {
  const summary = document.createElement('p');
  summary.className = 'reading-meta meta';
  summary.textContent = `${data.level} · ${data.passages.length} passages`;

  const list = document.createElement('ul');
  list.className = 'reading-list';
  list.append(...data.passages.map((passage) => createPassageCard(passage, data.level)));

  container.replaceChildren(summary, list);
}

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initReading() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const data = await loadReading();
    renderList(content, data);
  } catch (error) {
    console.error('[Bigu]', error);
    renderError(content, 'Reading passages could not be loaded right now.');
  }
}

export { initReading, loadReading };
