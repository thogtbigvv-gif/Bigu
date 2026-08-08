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

import {
  collectFacets,
  createContentLoader,
  createFacetChips,
  describeLevelSpan,
  levelBucketOf,
  loadIntoView,
  JLPT_LEVELS,
  NO_LEVEL,
  OFFLINE_HINT,
} from './content.js';

const DATA_URL = 'data/reading.json';
const VIEW_ID = 'reading';

const loadReading = createContentLoader(DATA_URL, 'reading');

/* Each passage carries its own `level`, optional — reading.json used to
   state one level for the whole file, which stopped being true the moment
   a second one was wanted and gave the view no way to say so. Absent means
   unleveled, which is a real answer for a passage lifted out of something
   nobody wrote an exam about. */
const LEVEL_ORDER = [...JLPT_LEVELS, NO_LEVEL];

function getPassageLevel(passage) {
  return passage.level ?? null;
}

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
      return createComingSoonPanel('Энэ бичвэрийн үгийн задаргаа удахгүй нэмэгдэнэ.');
    case 'grammar':
      return createComingSoonPanel('Энэ бичвэрийн хэл зүйн тайлбар удахгүй нэмэгдэнэ.');
    case 'questions':
      return createComingSoonPanel('Ойлголтын асуултууд удахгүй нэмэгдэнэ.');
    case 'shadowing':
      return createComingSoonPanel('Давтан хэлэх дасгал удахгүй нэмэгдэнэ.');
    default:
      return createComingSoonPanel('Энэ шат удахгүй нэмэгдэнэ.');
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

  head.append(title);

  if (level) {
    const tag = document.createElement('span');
    tag.className = 'jlpt-tag';
    tag.textContent = level;
    head.append(tag);
  }

  const titleMn = document.createElement('p');
  titleMn.className = 'reading-card__title-mn meta';
  titleMn.textContent = passage.titleMn;

  const meta = document.createElement('p');
  meta.className = 'reading-card__meta meta';
  meta.textContent = `${passage.sentences.length} өгүүлбэр`;

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
    elements.tag.textContent = currentLevel ?? '';
    elements.tag.hidden = !currentLevel;
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
  const rows = data.passages.map((passage) => ({
    passage,
    level: getPassageLevel(passage),
    bucket: levelBucketOf(getPassageLevel(passage)),
  }));

  const levelLabel = describeLevelSpan(rows.map((row) => row.bucket));
  const count = `${data.passages.length} бичвэр`;

  const summary = document.createElement('p');
  summary.className = 'reading-meta meta';
  summary.textContent = levelLabel ? `${levelLabel} · ${count}` : count;

  const list = document.createElement('ul');
  list.className = 'reading-list';

  /* The same data-driven chip row the other three views have. Two passages
     at one level means no row today — a single facet is a label, not a
     choice — and the row appears on its own the day a second level or an
     unleveled passage is added. */
  const { wrap: levelWrap, buttons: levelButtons } = createFacetChips(
    collectFacets(rows.map((row) => [row.bucket]), LEVEL_ORDER),
    { className: 'reading-filters__levels', ariaLabel: 'Filter by level' },
  );

  const stageElements = buildStageFlow();
  const stageController = createStageController(stageElements, () => {
    stageController.close();
    levelWrap.hidden = levelButtons.length === 0;
    summary.hidden = false;
    list.hidden = false;
  });

  const cards = rows.map((row) =>
    createPassageCard(row.passage, row.level, (chosenPassage) => {
      levelWrap.hidden = true;
      summary.hidden = true;
      list.hidden = true;
      stageController.open(chosenPassage, row.level);
    }),
  );

  function applyFilter() {
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );
    rows.forEach((row, index) => {
      cards[index].hidden = selected.size > 0 && !selected.has(row.bucket);
    });
  }

  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      applyFilter();
    });
  });

  list.append(...cards);
  applyFilter();

  container.replaceChildren(levelWrap, summary, list, stageElements.wrap);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initReading() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getContentContainer(view), {
    skeleton: 'card-grid',
    load: loadReading,
    render: renderList,
    errorTitle: 'Reading ачаалагдсангүй.',
    errorDetail: `Бичвэрийн багц data/reading.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

/* Unlike the other four content loaders, this one has no second caller:
   passages aren't part of the review pool, so neither the Dashboard nor
   Review nor Memory reads them. */
export { initReading };
