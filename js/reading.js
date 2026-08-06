/* ==========================================================================
   reading.js
   Loads data/reading.json and renders it as a browsable passage list
   inside the #reading view. Selecting a passage opens a per-passage study
   flow — Article, Vocabulary, Grammar, Questions, Translation, Shadowing —
   as a tab row over a single swapped panel, same list-to-detail swap
   lessons.js already uses for its quiz (list/summary hidden, detail panel
   shown; a "back" button reverses it).

   Only Article and Translation have real content today; both reuse the
   same sentence data (Article hides the Mongolian line so it stays a
   reading exercise, not a lookup table). Vocabulary, Grammar, Questions,
   and Shadowing render a "coming soon" note — same empty-state language
   already used for the Listening/Conversation/Shadowing view stubs in
   index.html — so a not-yet-built stage never looks broken. Each is a
   future, separate task: linking passage words to vocabulary.json,
   linking sentences to grammar.json patterns, a comprehension quiz, and
   an audio shadowing recorder.
   ========================================================================== */

import { createContentLoader, loadIntoView, OFFLINE_HINT } from './content.js';

const DATA_URL = 'data/reading.json';
const VIEW_ID = 'reading';

const loadReading = createContentLoader(DATA_URL, 'reading');

const STAGES = [
  { id: 'article', label: 'Article' },
  { id: 'vocabulary', label: 'Vocabulary' },
  { id: 'grammar', label: 'Grammar' },
  { id: 'questions', label: 'Questions' },
  { id: 'translation', label: 'Translation' },
  { id: 'shadowing', label: 'Shadowing' },
];

/* -- Sentence rendering ----------------------------------------------------------------
   Shared by the Article and Translation panels — same jp/.reading stack
   every other module's example sentences use, with the Mongolian line
   only added when the panel calling it wants it.
   -------------------------------------------------------------------------------------- */

function createSentenceLine(sentence, { showTranslation }) {
  const wrap = document.createElement('div');
  wrap.className = 'reading-stage__sentence';

  const jp = document.createElement('p');
  jp.lang = 'ja';
  jp.textContent = sentence.jp;

  const reading = document.createElement('p');
  reading.className = 'reading';
  reading.lang = 'ja';
  reading.textContent = sentence.reading;

  wrap.append(jp, reading);

  if (showTranslation) {
    const translation = document.createElement('p');
    translation.className = 'meta';
    translation.textContent = sentence.mn;
    wrap.append(translation);
  }

  return wrap;
}

function createSentenceGroup(passage, { showTranslation }) {
  const wrap = document.createElement('div');
  wrap.className = 'reading-stage__body';
  wrap.append(...passage.sentences.map((sentence) => createSentenceLine(sentence, { showTranslation })));
  return wrap;
}

function createComingSoonPanel(message) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = message;
  return p;
}

function buildStagePanel(stageId, passage) {
  switch (stageId) {
    case 'article':
      return createSentenceGroup(passage, { showTranslation: false });
    case 'translation':
      return createSentenceGroup(passage, { showTranslation: true });
    case 'vocabulary':
      return createComingSoonPanel('Vocabulary breakdown for this passage is coming soon.');
    case 'grammar':
      return createComingSoonPanel('Grammar notes for this passage are coming soon.');
    case 'questions':
      return createComingSoonPanel('Comprehension questions are coming soon.');
    case 'shadowing':
      return createComingSoonPanel('Shadowing practice is coming soon.');
    default:
      return createComingSoonPanel('This stage is coming soon.');
  }
}

/* -- Passage list ------------------------------------------------------------------- */

function createPassageCard(passage, level, onOpen) {
  const item = document.createElement('li');
  item.className = 'card reading-card';
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

  const meta = document.createElement('p');
  meta.className = 'reading-card__meta meta';
  meta.textContent = `${passage.sentences.length} sentences`;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'button button--secondary reading-card__open';
  openButton.textContent = 'Read';
  openButton.addEventListener('click', () => onOpen(passage));

  item.append(head, titleMn, meta, openButton);
  return item;
}

/* -- Stage flow --------------------------------------------------------------------------
   A tab row (role="tablist") over one shared tabpanel. All tabs share a
   single fixed panel id in aria-controls — there's only ever one panel on
   screen at a time, so a roving id would just churn without adding
   correctness — and the panel's aria-labelledby is repointed to whichever
   tab is currently selected.
   ------------------------------------------------------------------------------------------ */

function buildStageFlow() {
  const wrap = document.createElement('div');
  wrap.className = 'reading-stage';
  wrap.hidden = true;

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'button button--secondary reading-stage__exit';
  exit.textContent = '← Back to passages';

  const head = document.createElement('div');
  head.className = 'reading-stage__head';

  const title = document.createElement('p');
  title.className = 'reading-stage__title';
  title.lang = 'ja';

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';

  head.append(title, tag);

  const tabs = document.createElement('div');
  tabs.className = 'reading-stage__tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Reading stages');

  const panel = document.createElement('div');
  panel.className = 'card reading-stage__panel';
  panel.id = 'reading-stage-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = 0;

  const tabButtons = STAGES.map((stage) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip reading-stage__tab';
    button.id = `reading-tab-${stage.id}`;
    button.dataset.stage = stage.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', panel.id);
    button.textContent = stage.label;
    tabs.append(button);
    return button;
  });

  wrap.append(exit, head, tabs, panel);

  return { wrap, exit, title, tag, tabButtons, panel };
}

function createStageController(elements, onExit) {
  let currentPassage = null;
  let currentLevel = '';

  function selectStage(stageId) {
    elements.tabButtons.forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.stage === stageId));
    });
    elements.panel.setAttribute('aria-labelledby', `reading-tab-${stageId}`);
    elements.panel.replaceChildren(buildStagePanel(stageId, currentPassage));
  }

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => selectStage(button.dataset.stage));
  });

  elements.exit.addEventListener('click', onExit);

  function open(passage, level) {
    currentPassage = passage;
    currentLevel = level;
    elements.title.textContent = passage.title;
    elements.tag.textContent = currentLevel;
    elements.wrap.hidden = false;
    selectStage(STAGES[0].id);
  }

  function close() {
    elements.wrap.hidden = true;
  }

  return { open, close };
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

  const stageElements = buildStageFlow();
  const stageController = createStageController(stageElements, () => {
    stageController.close();
    summary.hidden = false;
    list.hidden = false;
  });

  list.append(
    ...data.passages.map((passage) =>
      createPassageCard(passage, data.level, (chosenPassage) => {
        summary.hidden = true;
        list.hidden = true;
        stageController.open(chosenPassage, data.level);
      }),
    ),
  );

  container.replaceChildren(summary, list, stageElements.wrap);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initReading() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getContentContainer(view), {
    skeleton: 'card-grid',
    load: loadReading,
    render: renderList,
    errorTitle: 'Reading passages didn’t load.',
    errorDetail: `The passage set is in data/reading.json. ${OFFLINE_HINT}`,
  });
}

/* Unlike the other four content loaders, this one has no second caller:
   passages aren't part of the review pool, so neither the Dashboard nor
   Review nor Memory reads them. */
export { initReading };
