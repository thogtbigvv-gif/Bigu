/* ==========================================================================
   reading.js
   Loads data/reading.json and renders it as a browsable passage list
   inside the #reading view. Selecting a passage opens a per-passage study
   flow — Article, Vocabulary, Grammar, Questions, Translation, Shadowing —
   as a tab row over a single swapped panel, same list-to-detail swap
   lessons.js already uses for its quiz (list/summary hidden, detail panel
   shown; a "back" button reverses it).

   Only Article and Translation have real content today; both reuse the
   same sentence data. Vocabulary, Grammar, Questions, and Shadowing render
   a "coming soon" note — same empty-state language already used for the
   Listening/Conversation/Shadowing view stubs in index.html — so a
   not-yet-built stage never looks broken. Each is a future, separate task:
   linking passage words to vocabulary.json, linking sentences to
   grammar.json patterns, a comprehension quiz, and an audio shadowing
   recorder. Those four are marked `ready: false` below and the tab row says
   so, rather than offering six identical-looking doors of which four are
   shut.

   -- On the Article panel ------------------------------------------------
   The Article used to print every sentence with its full hiragana reading
   underneath, permanently. The file's own comment called that "a reading
   exercise, not a lookup table" — but a reading exercise whose answer is
   already printed under every line is exactly a lookup table. You cannot
   fail to read the kana, so you never test the kanji.

   So the reading and the meaning are now *behind* the sentence: the passage
   is Japanese and nothing else until the reader asks. Asking is one tap on
   the sentence, and what comes back is the sentence's own reading and
   translation, in place, under the line it belongs to. Nothing is lost —
   "Show all readings" restores the old always-open article in one press,
   and the Translation tab is untouched and still shows everything at once.

   That single change is also where the view's progress comes from. A
   passage's position is how far down it the reader has worked, which is
   information the app now has for free and did not have before. It is held
   in memory for the open passage only: no store, no schema, nothing
   persisted, and deliberately no streak, score, or badge attached to it.
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
  { id: 'article', label: 'Article', ready: true },
  { id: 'vocabulary', label: 'Vocabulary', ready: false },
  { id: 'grammar', label: 'Grammar', ready: false },
  { id: 'questions', label: 'Questions', ready: false },
  { id: 'translation', label: 'Translation', ready: true },
  { id: 'shadowing', label: 'Shadowing', ready: false },
];

/* -- What the passage itself can tell us -------------------------------------------
   Every figure below is counted off the sentences already in the file. No
   new field, no schema change, nothing an editor has to remember to fill
   in — which is the only reason it is safe to show them on every card.

   CJK_RANGE is the Unified Ideographs block. Counting *distinct* kanji
   rather than every occurrence is the number that means something to a
   reader deciding whether to open a passage: a text that says 季節 four
   times is not four kanji harder than one that says it once.

   CHARS_PER_MINUTE is an estimate and is meant to read as one. A native
   adult manages roughly 400-600 characters a minute; someone working
   through a JLPT passage with intent is far slower, and 200 is a deliberate
   middle that errs toward "this will take a moment" rather than flattering
   the reader. The figure is always rounded up and never shows 0 minutes.
   ---------------------------------------------------------------------------------- */
const CJK_RANGE = /[一-鿿㐀-䶿]/gu;
const CHARS_PER_MINUTE = 200;

function passageStats(passage) {
  const sentences = passage.sentences ?? [];
  const body = sentences.map((sentence) => sentence.jp ?? '').join('');
  const kanji = new Set(body.match(CJK_RANGE) ?? []);

  return {
    sentences: sentences.length,
    characters: body.length,
    kanji: kanji.size,
    minutes: Math.max(1, Math.ceil(body.length / CHARS_PER_MINUTE)),
  };
}

/* The metadata line, as one string of `·`-separated facts — the same
   separator every other summary line in the app uses. Ordered by what a
   reader deciding whether to open this actually asks: how long is it, how
   hard does it look, how much of it is kanji. */
function describeStats(stats, level) {
  return [
    level,
    `${stats.sentences} өгүүлбэр`,
    `${stats.kanji} ханз`,
    `~${stats.minutes} мин`,
  ].filter(Boolean).join(' · ');
}

/* -- Sentences ---------------------------------------------------------------------- */

/* One sentence, closed. The row is a button so the whole line is the target
   — on a phone that is the difference between a comfortable tap and aiming
   at a glyph — and `user-select: text` in reading.css keeps the Japanese
   selectable inside it, which matters on a surface whose entire purpose is
   text you might want to copy into a dictionary.

   Selecting text inside a button still fires a click on release, so a reader
   dragging across a line to copy it would toggle the gloss every time. The
   guard in the handler is the whole fix: if the release left a selection,
   the reader was selecting, not pressing. */
function createSentence(sentence, index, onToggle) {
  const item = document.createElement('li');
  item.className = 'reading-sentence';

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'reading-sentence__face';
  face.setAttribute('aria-expanded', 'false');

  const number = document.createElement('span');
  number.className = 'reading-sentence__index';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1);

  const jp = document.createElement('span');
  jp.className = 'reading-sentence__jp';
  jp.lang = 'ja';
  jp.textContent = sentence.jp;

  face.append(number, jp);

  const gloss = document.createElement('div');
  gloss.className = 'reading-sentence__gloss';
  gloss.hidden = true;

  const reading = document.createElement('p');
  reading.className = 'reading-sentence__reading reading';
  reading.lang = 'ja';
  reading.textContent = sentence.reading;

  const mn = document.createElement('p');
  mn.className = 'reading-sentence__mn';
  mn.textContent = sentence.mn;

  gloss.append(reading, mn);

  face.addEventListener('click', () => {
    // A drag that ended inside the button was a selection, not a press.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && face.contains(selection.anchorNode)) return;
    onToggle(index);
  });

  item.append(face, gloss);

  /* Opening and closing is an attribute flip on two nodes that already
     exist, deliberately not a re-render. The panel's children carry a
     fade-in (see reading.css), so rebuilding the article to open one line
     would fade the entire passage out and back in every time the reader
     asked what a word meant — the single most repeated action on this
     screen, and the one place a transition must not draw attention.

     The gloss's own rise still plays on every open without any help,
     because going from `hidden` (display:none) to shown is the frame its box
     first exists on and CSS starts the animation there. Same free hook the
     lesson disclosure and the drawer backdrop use. */
  return {
    element: item,
    setOpen(open) {
      face.setAttribute('aria-expanded', String(open));
      gloss.hidden = !open;
    },
  };
}

/* -- Article ---------------------------------------------------------------------------
   The reading surface proper: the passage, a control for opening every
   gloss at once, and — once the reader has been through all of it — one
   quiet line saying so.

   `seen` only ever grows. Collapsing a sentence puts the gloss away but
   does not un-read it, so the progress rule never runs backwards while the
   reader tidies up behind themselves. A passage the reader has finished
   still reads as finished after they close the lines they opened.
   ---------------------------------------------------------------------------------------- */

function createArticlePanel(passage, state, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'reading-article';

  /* The hint erases itself. It exists to say the sheet answers to being
     touched, and the dotted rule under every sentence now says that on its
     own once you have seen it work — so the moment the reader opens their
     first line the sentence has done its whole job and becomes one more
     thing to read past on every passage after it. Instruction text that
     outstays the instruction is the commonest kind of clutter there is. */
  const hint = document.createElement('p');
  hint.className = 'reading-article__hint';
  hint.textContent = 'Өгүүлбэр дээр дарвал орчуулга нээгдэнэ.';

  const list = document.createElement('ol');
  list.className = 'reading-article__sentences';

  const total = passage.sentences.length;

  function open(index) {
    state.open.add(index);
    state.seen.add(index);
  }

  const sentences = passage.sentences.map((sentence, index) =>
    createSentence(sentence, index, (i) => {
      if (state.open.has(i)) state.open.delete(i);
      else open(i);
      sync();
    }),
  );

  list.append(...sentences.map((s) => s.element));

  /* The completed line. Deliberately the quietest thing on the page it
     appears on: one Japanese word, one sentence, a hairline above it. There
     is no score to report and nothing to press — the reader knows what they
     did, and the only useful thing the app can add is where to go next,
     which the pager at the foot of the stage already offers.

     Built once and hidden, so the frame it is un-hidden on is the frame its
     animation starts — the same display:none hook the glosses use. Which
     means it arrives once, when the last line is opened, rather than being
     re-created and re-animated on every press after that. */
  const done = document.createElement('p');
  done.className = 'reading-article__done';
  done.hidden = true;

  const mark = document.createElement('span');
  mark.className = 'reading-article__done-mark';
  mark.lang = 'ja';
  mark.textContent = '読了';

  /* The same completion prefix the quiz summary uses. Finishing a passage
     and finishing a round are the same event as far as the reader is
     concerned — something ended — and until now each screen said so in its
     own words. The sentence after it stays specific to a passage; only the
     mark is shared. */
  const doneText = document.createElement('span');
  doneText.textContent = 'Дууссан ✓ · энэ бичвэрийг бүтэн үзлээ.';

  done.append(mark, doneText);

  /* Back inside the article and below the passage, as ambient text rather
     than a chip. V2 moved it out of the panel to get it off the top of the
     sheet, which was right, but a bordered control on a rail beside the
     progress was still a widget on a page that is meant to read as a printed
     sheet. At the foot it is in the order the reader meets it — try the
     lines, then give up on all of them at once — and it costs the top of the
     page nothing. */
  const showAll = document.createElement('button');
  showAll.type = 'button';
  showAll.className = 'reading-article__reveal';

  showAll.addEventListener('click', () => {
    if (state.allOpen) state.open.clear();
    else passage.sentences.forEach((_, i) => open(i));
    sync();
  });

  /* One place that reads the state and writes the DOM, called after every
     change. Cheaper than it looks — it touches two attributes per sentence
     and nothing reflows — and it means the chip, the lines, the completed
     note and the progress rule can never disagree about what is open. */
  function sync() {
    state.allOpen = total > 0 && state.open.size === total;

    sentences.forEach((sentence, index) => sentence.setOpen(state.open.has(index)));

    showAll.setAttribute('aria-pressed', String(state.allOpen));
    showAll.textContent = state.allOpen ? 'Hide readings' : 'Show all readings';
    hint.hidden = state.seen.size > 0;
    done.hidden = !(total > 0 && state.seen.size >= total);

    onChange();
  }

  wrap.append(hint, list, showAll, done);
  sync();

  return wrap;
}

/* -- Translation -------------------------------------------------------------------------
   Unchanged in substance: every sentence with its reading and its Mongolian,
   all at once, which is what this tab is for. It is the reference view the
   Article deliberately is not, and it is why hiding the glosses over there
   costs the reader nothing.
   ------------------------------------------------------------------------------------------ */

function createTranslationPanel(passage) {
  const wrap = document.createElement('div');
  wrap.className = 'reading-stage__body';

  passage.sentences.forEach((sentence) => {
    const block = document.createElement('div');
    block.className = 'reading-stage__sentence';

    const jp = document.createElement('p');
    jp.className = 'reading-stage__sentence-jp';
    jp.lang = 'ja';
    jp.textContent = sentence.jp;

    const reading = document.createElement('p');
    reading.className = 'reading';
    reading.lang = 'ja';
    reading.textContent = sentence.reading;

    const mn = document.createElement('p');
    mn.className = 'meta';
    mn.textContent = sentence.mn;

    block.append(jp, reading, mn);
    wrap.append(block);
  });

  return wrap;
}

function createComingSoonPanel(message) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = message;
  return p;
}

function buildStagePanel(stageId, passage, state, onChange) {
  switch (stageId) {
    case 'article':
      return createArticlePanel(passage, state, onChange);
    case 'translation':
      return createTranslationPanel(passage);
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
  item.className = 'card card--interactive reading-card';
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
  titleMn.className = 'reading-card__title-mn';
  titleMn.textContent = passage.titleMn;

  /* The passage's opening line, greyed and clipped to one line. A list of
     titles tells the reader what a passage is *called*; the first sentence
     tells them what it sounds like, which is the thing they are actually
     choosing between. Costs nothing — the sentence is already loaded. */
  const lede = document.createElement('p');
  lede.className = 'reading-card__lede';
  lede.lang = 'ja';
  lede.textContent = passage.sentences[0]?.jp ?? '';

  const stats = passageStats(passage);

  const meta = document.createElement('p');
  meta.className = 'reading-card__meta';
  meta.textContent = describeStats(stats);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'button button--secondary reading-card__open';
  openButton.textContent = 'Read';
  openButton.addEventListener('click', () => onOpen(passage));

  item.append(head, titleMn, lede, meta, openButton);
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

  /* A quiet text control, not a button-shaped one. Going back is the escape
     hatch on this screen, not an action anybody came here to take — and as a
     full .button--secondary it carried exactly the same weight as Previous
     and Next at the foot, so the page offered three identical grey doors and
     no opinion about which one mattered. reading.css keeps it at the app's
     44px touch floor on a phone; only the chrome goes. */
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'reading-stage__exit';
  exit.textContent = '← Back to passages';

  /* The masthead of a printed sheet: what this is, then what it is called,
     then what it is about — centred, in that order, with the level folded
     into the top line instead of riding beside the title as a bordered gold
     badge. The badge was a UI widget sitting a few millimetres from the one
     piece of Japanese the page is built around, and the level is a fact
     about the passage, not a label on the title. It reads the same and draws
     nothing.

     The list keeps its badges: there, a level is something you scan a column
     for, which is exactly what a badge is good at. */
  const head = document.createElement('div');
  head.className = 'reading-stage__head';

  const meta = document.createElement('p');
  meta.className = 'reading-stage__meta';

  const title = document.createElement('h2');
  title.className = 'reading-stage__title';
  title.lang = 'ja';

  const subtitle = document.createElement('p');
  subtitle.className = 'reading-stage__subtitle';

  head.append(meta, title, subtitle);

  /* -- Progress ---------------------------------------------------------------
     Moved below the sheet and shrunk to a colophon: a short centred rule and
     one line of discrete text, in the place a printed page puts its number.

     It was a full-width hairline across the top of the reading surface with
     a rail of figures under it, which is the wrong end of the page for it —
     "how far am I" is a question you ask having read something, and putting
     the answer above the text meant the reader crossed a progress bar to
     reach the first sentence every time. Down here it is out of the way of
     the reading and exactly where the eye lands when the passage runs out. */
  const progress = document.createElement('div');
  progress.className = 'reading-progress';

  const track = document.createElement('div');
  track.className = 'reading-progress__track';
  track.setAttribute('aria-hidden', 'true');

  const fill = document.createElement('span');
  fill.className = 'reading-progress__fill';
  track.append(fill);

  const progressLabel = document.createElement('p');
  progressLabel.className = 'reading-progress__label';
  progressLabel.setAttribute('aria-live', 'polite');

  progress.append(track, progressLabel);

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
    /* No .toggle-chip any more. The tabs are text on a line now — see the
       note in reading.css — and carrying the chip class only to override
       eight of its declarations would leave the next reader unsure which
       file owned the look. */
    button.className = 'reading-stage__tab';
    button.id = `reading-tab-${stage.id}`;
    button.dataset.stage = stage.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('aria-controls', panel.id);
    button.textContent = stage.label;

    /* A stage with nothing behind it says so on the tab rather than only
       after it has been opened. Four of the six were stubs and all six
       looked identical, so every reader discovered the same four dead ends
       one at a time. The dot is drawn in CSS; the label carries the same
       fact for a screen reader. */
    if (!stage.ready) {
      button.classList.add('reading-stage__tab--pending');
      button.setAttribute('aria-description', 'Удахгүй нэмэгдэнэ');
    }

    tabs.append(button);
    return button;
  });

  /* -- Pager -------------------------------------------------------------------
     Where to go when the passage is finished. Reading is the one view in the
     app whose items are *sequential* — a list of passages is a table of
     contents, not a grid of cards — and until now the only way from the end
     of one to the start of the next was back out to the list and in again. */
  const pager = document.createElement('nav');
  pager.className = 'reading-pager';
  pager.setAttribute('aria-label', 'Passage navigation');

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'button button--secondary reading-pager__button reading-pager__button--prev';

  const position = document.createElement('p');
  position.className = 'reading-pager__position';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'button button--secondary reading-pager__button reading-pager__button--next';

  pager.append(prev, position, next);

  wrap.append(exit, head, tabs, panel, progress, pager);

  return {
    wrap, exit, title, subtitle, meta,
    fill, progressLabel, tabButtons, panel,
    pager, prev, position, next,
  };
}

function createStageController(elements, rows, onExit) {
  let index = -1;
  let stageId = STAGES[0].id;

  /* Per-passage reading state, rebuilt on every open. `open` is what is
     currently expanded on screen; `seen` is what has ever been expanded and
     only grows. Nothing here outlives the passage, and nothing is written
     anywhere. */
  let state = { open: new Set(), seen: new Set(), allOpen: false };

  function currentPassage() {
    return rows[index]?.passage ?? null;
  }

  function renderProgress() {
    const passage = currentPassage();
    if (!passage) return;

    const total = passage.sentences.length;
    const seen = state.seen.size;
    const ratio = total > 0 ? Math.min(seen / total, 1) : 0;
    const complete = total > 0 && seen >= total;

    elements.fill.style.setProperty('--progress', ratio.toFixed(3));
    elements.fill.classList.toggle('is-complete', complete);
    elements.progressLabel.textContent = `${seen} / ${total} үзсэн`;

    /* Finishing a passage is the one moment this screen has an opinion about
       what to do next, so that is the one moment a control changes weight.
       Next becomes the filled button and stays filled; nothing else on the
       page moves. If there is no next passage there is nothing to promote —
       the completed line in the article is the whole ending, and the reader
       leaves the way they came.

       It changes its wording with its weight, to the app's own word for
       this: a promoted Next is no longer one of two pager arrows, it is the
       way onward from a finished session, and that is called
       "Үргэлжлүүлэх →" wherever a session ends here. Unpromoted it goes
       back to being a pager arrow and reads like one — the pager is still
       an ordinary way to move around a list you have not read.

       Passages have no word list in the data and the per-passage Vocabulary
       stage is still a stub, so there is nothing honest to point at beyond
       the next passage. When that stage ships, this is where "review the
       words from this passage" belongs. */
    const hasNext = Boolean(rows[index + 1]);
    const promote = complete && hasNext;
    elements.next.classList.toggle('button--primary', promote);
    elements.next.classList.toggle('button--secondary', !promote);
    elements.next.textContent = promote ? 'Үргэлжлүүлэх →' : 'Next →';
  }

  /* Moving to another passage sets progress back to zero, and a plain write
     would send the rule sliding the full width of the page backwards — an
     animation of something un-happening, on the one screen where motion is
     supposed to be almost invisible. The class suppresses the transition, the
     offsetWidth read makes the browser adopt the zero while it is suppressed,
     and only then does the transition come back for the reader's own
     progress. Same is-instant idea quiz.css uses to face a card front. */
  function resetProgress() {
    elements.fill.classList.add('is-instant');
    elements.fill.classList.remove('is-complete');
    elements.fill.style.setProperty('--progress', '0');
    void elements.fill.offsetWidth;
    elements.fill.classList.remove('is-instant');
  }

  /* The panel is rebuilt only when the *stage* changes — a tab press, or the
     pager moving to another passage. Opening a line inside the Article does
     not come through here; the article updates itself in place and calls
     renderProgress through onChange. See the note in createSentence. */
  function renderPanel() {
    const passage = currentPassage();
    if (!passage) return;

    elements.panel.replaceChildren(
      buildStagePanel(stageId, passage, state, renderProgress),
    );
  }

  function selectStage(nextStageId) {
    stageId = nextStageId;
    elements.tabButtons.forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.stage === stageId));
    });
    elements.panel.setAttribute('aria-labelledby', `reading-tab-${stageId}`);
    renderPanel();
  }

  function renderPager() {
    const total = rows.length;
    const prevRow = rows[index - 1];
    const nextRow = rows[index + 1];

    elements.prev.disabled = !prevRow;
    elements.next.disabled = !nextRow;
    elements.prev.textContent = '← Previous';
    elements.next.textContent = 'Next →';
    elements.prev.title = prevRow ? prevRow.passage.titleMn : '';
    elements.next.title = nextRow ? nextRow.passage.titleMn : '';
    elements.position.textContent = `${index + 1} / ${total}`;
    elements.pager.hidden = total < 2;
  }

  function show(nextIndex) {
    index = nextIndex;
    const row = rows[index];
    if (!row) return;

    state = { open: new Set(), seen: new Set(), allOpen: false };

    const stats = passageStats(row.passage);
    elements.title.textContent = row.passage.title;
    elements.subtitle.textContent = row.passage.titleMn;
    elements.meta.textContent = describeStats(stats, row.level);
    elements.wrap.hidden = false;

    resetProgress();
    renderPager();
    renderProgress();
    selectStage(STAGES[0].id);
  }

  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => selectStage(button.dataset.stage));
  });

  /* Moving between passages re-runs the same open() the list does, so a
     passage reached with Next is in exactly the state it would be in if it
     had been picked off the list — Article tab, nothing revealed, progress
     at zero. The heading takes focus so a keyboard or screen-reader user is
     told they have arrived somewhere new rather than silently having the
     page swapped under them; preventScroll keeps the position, since the
     stage frame itself has not moved. */
  function step(delta) {
    const nextIndex = index + delta;
    if (!rows[nextIndex]) return;
    show(nextIndex);
    elements.title.setAttribute('tabindex', '-1');
    elements.title.focus({ preventScroll: true });
  }

  elements.prev.addEventListener('click', () => step(-1));
  elements.next.addEventListener('click', () => step(1));
  elements.exit.addEventListener('click', onExit);

  return {
    open(passage) {
      show(rows.findIndex((row) => row.passage === passage));
    },
    close() {
      elements.wrap.hidden = true;
    },
  };
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

  /* Shown when every passage has been filtered out. The list used to simply
     empty itself, which reads as a failed load rather than as a filter doing
     its job — and the chips that caused it were the only thing left on
     screen to say otherwise. */
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'Энэ түвшинд тохирох бичвэр алга. Өөр түвшин сонгож үзнэ үү.';
  empty.hidden = true;

  /* The same data-driven chip row the other three views have. Two passages
     at one level means no row today — a single facet is a label, not a
     choice — and the row appears on its own the day a second level or an
     unleveled passage is added. */
  const { wrap: levelWrap, buttons: levelButtons } = createFacetChips(
    collectFacets(rows.map((row) => [row.bucket]), LEVEL_ORDER),
    { className: 'reading-filters__levels', ariaLabel: 'Filter by level' },
  );

  const stageElements = buildStageFlow();
  const stageController = createStageController(stageElements, rows, () => {
    stageController.close();
    levelWrap.hidden = levelButtons.length === 0;
    summary.hidden = false;
    list.hidden = false;
    applyFilter();
  });

  const cards = rows.map((row) =>
    createPassageCard(row.passage, row.level, (chosenPassage) => {
      levelWrap.hidden = true;
      summary.hidden = true;
      list.hidden = true;
      empty.hidden = true;
      stageController.open(chosenPassage);
    }),
  );

  function applyFilter() {
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );
    let visible = 0;
    rows.forEach((row, index) => {
      const hidden = selected.size > 0 && !selected.has(row.bucket);
      cards[index].hidden = hidden;
      if (!hidden) visible += 1;
    });
    empty.hidden = visible > 0 || list.hidden;
  }

  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      applyFilter();
    });
  });

  list.append(...cards);
  applyFilter();

  container.replaceChildren(levelWrap, summary, list, empty, stageElements.wrap);
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

/* Passages aren't part of the review pool, so nothing that grades or
   schedules reads them. The one other caller is js/home.js, which pulls its
   single line of Japanese from four sources and this is the fourth: a
   sentence out of a passage is the only one of them that is a fragment of
   something longer, which is exactly what makes it worth having there. */
export { initReading, loadReading };
