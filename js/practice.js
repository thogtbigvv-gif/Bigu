/* ==========================================================================
   practice.js
   Self-graded flashcard quiz for the #practice view. A mode selector lets
   the reader choose which deck to drill — vocabulary, grammar, or kanji —
   each described by a small adapter in DECKS below (how to fill the card
   front, the secondary line, and the reveal-answer fields). Reveal → self-
   mark → next. Marking a card writes to the same progress store every
   list view uses (so a card graded "I knew it" here shows as
   learned/mastered there too), and each finished session is logged to the
   practice store, tagged with its mode, for dashboard.js. A small history
   block reads that same store back to list the most recent rounds (mode,
   score, when), refreshed after every finished session.
   ========================================================================== */

import { progress, practice, settings } from './storage.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';

const VIEW_ID = 'practice';
const SESSION_SIZE = 10;
const MODE_SETTING_KEY = 'practiceMode';
const HISTORY_LIMIT = 5;

/* -- Deck adapters ---------------------------------------------------------------------
   Each deck knows how to: fill the big headword slot, describe the
   secondary line beneath it (part of speech / structure / readings, with
   whichever class and lang it needs), and fill the four reveal-answer
   fields from that item's own field names.
   -------------------------------------------------------------------------------------- */
const DECKS = {
  vocabulary: {
    label: 'Vocabulary',
    fillFront(container, word) {
      container.replaceChildren();
      if (!word.kanji) {
        const span = document.createElement('span');
        span.lang = 'ja';
        span.textContent = word.kana;
        container.append(span);
        return;
      }
      const ruby = document.createElement('ruby');
      ruby.lang = 'ja';
      const rt = document.createElement('rt');
      rt.textContent = word.kana;
      ruby.append(word.kanji, rt);
      container.append(ruby);
    },
    secondary(word) {
      return { text: word.partOfSpeech, className: 'practice-card__pos--capitalize', lang: null };
    },
    fillAnswer(elements, word) {
      elements.meaning.textContent = word.meaning;
      elements.exampleJp.textContent = word.example.jp;
      elements.exampleReading.textContent = word.example.reading;
      elements.exampleEn.textContent = word.example.mn;
    },
  },

  grammar: {
    label: 'Grammar',
    fillFront(container, point) {
      container.replaceChildren();
      if (point.patternKana) {
        const ruby = document.createElement('ruby');
        ruby.lang = 'ja';
        const rt = document.createElement('rt');
        rt.textContent = point.patternKana;
        ruby.append(point.pattern, rt);
        container.append('〜', ruby);
      } else {
        const span = document.createElement('span');
        span.lang = 'ja';
        span.textContent = `〜${point.pattern}`;
        container.append(span);
      }
    },
    secondary(point) {
      return { text: point.structure, className: 'reading', lang: null };
    },
    fillAnswer(elements, point) {
      elements.meaning.textContent = point.meaning;
      elements.exampleJp.textContent = point.example.jp;
      elements.exampleReading.textContent = point.example.reading;
      elements.exampleEn.textContent = point.example.mn;
    },
  },

  kanji: {
    label: 'Kanji',
    fillFront(container, entry) {
      container.replaceChildren();
      const span = document.createElement('span');
      span.lang = 'ja';
      span.textContent = entry.character;
      container.append(span);
    },
    secondary(entry) {
      const parts = [];
      if (entry.onyomi) parts.push(entry.onyomi);
      if (entry.kunyomi) parts.push(entry.kunyomi);
      return { text: parts.join(' ・ '), className: 'reading', lang: 'ja' };
    },
    fillAnswer(elements, entry) {
      elements.meaning.textContent = entry.meaning;
      elements.exampleJp.textContent = entry.example.word;
      elements.exampleReading.textContent = entry.example.reading;
      elements.exampleEn.textContent = entry.example.mn;
    },
  },

  /* "Review mistakes" isn't a content deck of its own — it's a live pool of
     whatever's currently marked "Still learning" across vocabulary, grammar,
     and kanji together. Each item still needs its real deck's card layout,
     so every method here just looks up which deck the item's id belongs to
     (the "n3-"/"gr-"/"kj-" prefix already used throughout the data) and
     delegates to that deck's own fillFront/secondary/fillAnswer. */
  mistakes: {
    label: 'Review mistakes',
    fillFront(container, item) {
      DECKS[deckKeyForItemId(item.id)].fillFront(container, item);
    },
    secondary(item) {
      return DECKS[deckKeyForItemId(item.id)].secondary(item);
    },
    fillAnswer(elements, item) {
      DECKS[deckKeyForItemId(item.id)].fillAnswer(elements, item);
    },
  },
};

function deckKeyForItemId(id) {
  if (id.startsWith('n3-')) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

const DECK_KEYS = Object.keys(DECKS);

/* -- Session selection ------------------------------------------------------------------
   Unlearned items are prioritized so practice time goes where it's useful;
   once everything is learned (or there simply aren't SESSION_SIZE unlearned
   items left) the pool tops up from the full set instead of running short.
   -------------------------------------------------------------------------------------------- */

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isLearned(itemId) {
  return Boolean(progress.get(itemId)?.learned);
}

function buildSession(items) {
  const unlearned = shuffled(items.filter((item) => !isLearned(item.id)));
  if (unlearned.length >= SESSION_SIZE) return unlearned.slice(0, SESSION_SIZE);

  const learned = shuffled(items.filter((item) => isLearned(item.id)));
  return [...unlearned, ...learned].slice(0, Math.min(SESSION_SIZE, items.length));
}

/* -- View controller ------------------------------------------------------------------------
   Three phases live in the same markup, toggled with `hidden`: an intro
   screen (mode selector + start button) to start a session, the card
   itself, and a summary once the queue is empty. The mode selector is a
   sibling of all three phases so it also stays visible on the summary
   screen — the reader can switch decks before starting the next round
   without it being available mid-session, where switching would be
   confusing. `state` tracks the chosen mode plus position and score.
   ---------------------------------------------------------------------------------------------- */

function buildView(view) {
  const wrapper = document.createElement('div');
  wrapper.className = 'practice';

  /* Mode selector */
  const modeGroup = document.createElement('div');
  modeGroup.className = 'practice__mode-group';
  modeGroup.setAttribute('role', 'group');
  modeGroup.setAttribute('aria-label', 'Choose what to practice');

  const modeButtons = {};
  for (const key of DECK_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'practice__mode-button';
    button.textContent = DECKS[key].label;
    button.dataset.mode = key;
    modeButtons[key] = button;
    modeGroup.append(button);
  }

  /* Intro */
  const intro = document.createElement('div');
  intro.className = 'practice__intro';

  const introText = document.createElement('p');
  introText.className = 'practice__intro-text';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'button button--primary';
  startButton.textContent = 'Start practice';

  intro.append(introText, startButton);

  /* Session */
  const session = document.createElement('div');
  session.className = 'practice__session';
  session.hidden = true;

  const status = document.createElement('p');
  status.className = 'practice__status meta';
  status.setAttribute('aria-live', 'polite');

  const card = document.createElement('div');
  card.className = 'practice-card';

  const headword = document.createElement('p');
  headword.className = 'practice-card__headword';

  const pos = document.createElement('p');
  pos.className = 'practice-card__pos';

  const answer = document.createElement('div');
  answer.className = 'practice-card__answer';
  answer.hidden = true;

  const meaning = document.createElement('p');
  meaning.className = 'practice-card__meaning';

  const exampleJp = document.createElement('p');
  exampleJp.lang = 'ja';

  const exampleReading = document.createElement('p');
  exampleReading.className = 'reading';
  exampleReading.lang = 'ja';

  const exampleEn = document.createElement('p');
  exampleEn.className = 'meta';

  answer.append(meaning, exampleJp, exampleReading, exampleEn);
  card.append(headword, pos, answer);

  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'button button--secondary practice__reveal';
  revealButton.textContent = 'Show answer';

  const grade = document.createElement('div');
  grade.className = 'practice__grade';
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
  shortcutHint.className = 'practice__shortcut-hint meta';
  shortcutHint.textContent = 'Space to reveal · 1 still learning · 2 knew it';

  session.append(status, card, revealButton, grade, shortcutHint);

  /* Summary */
  const summary = document.createElement('div');
  summary.className = 'practice__summary';
  summary.hidden = true;

  const summaryText = document.createElement('p');
  summaryText.className = 'practice__summary-text';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--primary';
  againButton.textContent = 'Practice again';

  summary.append(summaryText, againButton);

  /* History */
  const history = document.createElement('div');
  history.className = 'practice__history';

  const historyHeading = document.createElement('h2');
  historyHeading.className = 'practice__history-heading';
  historyHeading.textContent = 'Recent sessions';

  const historyList = document.createElement('ul');
  historyList.className = 'practice__history-list';

  const historyEmpty = document.createElement('p');
  historyEmpty.className = 'empty-state';
  historyEmpty.textContent = 'No sessions yet — finish a round to see it here.';

  history.append(historyHeading, historyList, historyEmpty);

  wrapper.append(modeGroup, intro, session, summary, history);
  view.append(wrapper);

  return {
    modeGroup, modeButtons,
    intro, introText, startButton,
    session, status, headword, pos, answer, meaning, exampleJp, exampleReading, exampleEn,
    revealButton, grade, stillLearningButton, knewItButton,
    summary, summaryText, againButton,
    history, historyList, historyEmpty,
  };
}

function applySecondary(elements, deck, item) {
  const { text, className, lang } = deck.secondary(item);
  elements.pos.className = 'practice-card__pos';
  if (className) elements.pos.classList.add(className);
  if (lang) {
    elements.pos.lang = lang;
  } else {
    elements.pos.removeAttribute('lang');
  }
  elements.pos.textContent = text;
}

function initController(elements, decks) {
  const initialMode = DECK_KEYS.includes(settings.get(MODE_SETTING_KEY)) ? settings.get(MODE_SETTING_KEY) : 'vocabulary';
  const state = { mode: initialMode, queue: [], index: 0, correct: 0 };

  function currentDeck() {
    return decks[state.mode];
  }

  function syncModeButtons() {
    for (const key of DECK_KEYS) {
      elements.modeButtons[key].setAttribute('aria-pressed', String(key === state.mode));
    }
  }

  function updateIntroText() {
    const deck = currentDeck();
    const count = deck.items.length;

    if (state.mode === 'mistakes') {
      if (count === 0) {
        elements.introText.textContent =
          'No mistakes to review right now \u2014 everything you\u2019ve seen so far is marked "I knew it".';
        elements.startButton.hidden = true;
        return;
      }
      elements.startButton.hidden = false;
      elements.introText.textContent =
        `${count} item${count === 1 ? '' : 's'} marked "Still learning", pulled from every deck. A round covers up to ${SESSION_SIZE}.`;
      return;
    }

    if (count === 0) {
      elements.introText.textContent = `No ${deck.label.toLowerCase()} available to practice with yet.`;
      elements.startButton.hidden = true;
      return;
    }
    elements.startButton.hidden = false;
    elements.introText.textContent =
      `${count} ${deck.label.toLowerCase()} items in the deck. A round covers up to ${SESSION_SIZE}, unlearned items first.`;
  }

  function selectMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    settings.set(MODE_SETTING_KEY, mode);
    syncModeButtons();
    updateIntroText();
  }

  function showPhase(phase) {
    elements.modeGroup.hidden = phase === 'session';
    elements.intro.hidden = phase !== 'intro';
    elements.session.hidden = phase !== 'session';
    elements.summary.hidden = phase !== 'summary';
    elements.history.hidden = phase === 'session';
  }

  function renderCard() {
    const deck = currentDeck();
    const item = state.queue[state.index];
    elements.status.textContent = `Card ${state.index + 1} / ${state.queue.length} · ${state.correct} known so far`;

    deck.fillFront(elements.headword, item);
    applySecondary(elements, deck, item);
    deck.fillAnswer(elements, item);

    elements.answer.hidden = true;
    elements.grade.hidden = true;
    elements.revealButton.hidden = false;
  }

  function formatSessionDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function renderHistory() {
    const recent = practice.getAll().slice(-HISTORY_LIMIT).reverse();
    elements.historyList.replaceChildren();

    elements.historyEmpty.hidden = recent.length > 0;
    elements.historyList.hidden = recent.length === 0;

    for (const entry of recent) {
      const item = document.createElement('li');
      item.className = 'practice__history-item';

      const mode = document.createElement('span');
      mode.className = 'practice__history-mode';
      mode.textContent = decks[entry.mode]?.label ?? entry.mode;

      const score = document.createElement('span');
      score.className = 'practice__history-score';
      score.textContent = `${entry.correct} / ${entry.total}`;

      const date = document.createElement('time');
      date.className = 'practice__history-date meta';
      date.textContent = formatSessionDate(entry.createdAt);

      item.append(mode, score, date);
      elements.historyList.append(item);
    }
  }

  function finishSession() {
    practice.add({ total: state.queue.length, correct: state.correct, mode: state.mode });
    elements.summaryText.textContent =
      `${state.correct} / ${state.queue.length} marked "I knew it" this round.`;
    renderHistory();
    showPhase('summary');
  }

  function advance() {
    state.index += 1;
    if (state.index >= state.queue.length) {
      finishSession();
    } else {
      renderCard();
    }
  }

  function grade(learned) {
    const item = state.queue[state.index];
    progress.set(item.id, { ...progress.get(item.id), learned });
    if (learned) state.correct += 1;
    advance();
  }

  function startSession() {
    const deck = currentDeck();
    state.queue = buildSession(deck.items);
    state.index = 0;
    state.correct = 0;

    if (state.queue.length === 0) {
      updateIntroText();
      showPhase('intro');
      return;
    }

    showPhase('session');
    renderCard();
  }

  for (const key of DECK_KEYS) {
    elements.modeButtons[key].addEventListener('click', () => selectMode(key));
  }

  elements.startButton.addEventListener('click', startSession);
  elements.againButton.addEventListener('click', startSession);

  elements.revealButton.addEventListener('click', () => {
    elements.answer.hidden = false;
    elements.grade.hidden = false;
    elements.revealButton.hidden = true;
  });

  elements.stillLearningButton.addEventListener('click', () => grade(false));
  elements.knewItButton.addEventListener('click', () => grade(true));

  /* Keyboard shortcuts: Space/Enter reveals, 1/2 grade — only while the
     practice view is the active hash and a card is actually on screen, so
     these keys don't hijack typing elsewhere in the app (e.g. the journal
     composer). `event.repeat` is ignored so holding a key can't rapid-fire
     through several cards at once. */
  function handleKeydown(event) {
    if (event.repeat) return;
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (elements.session.hidden) return;

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

  syncModeButtons();
  updateIntroText();
  renderHistory();
  showPhase('intro');
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initPractice() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const elements = buildView(view);

  try {
    const [vocabData, grammarData, kanjiData] = await Promise.all([
      loadVocabulary(),
      loadGrammar(),
      loadKanji(),
    ]);

    const decks = {
      vocabulary: { ...DECKS.vocabulary, items: vocabData.words },
      grammar: { ...DECKS.grammar, items: grammarData.points },
      kanji: { ...DECKS.kanji, items: kanjiData.kanji },
    };
    // A getter, not a static array: what counts as "still learning" changes
    // as the reader grades cards elsewhere, so this has to be read fresh
    // every time rather than computed once at load.
    decks.mistakes = {
      ...DECKS.mistakes,
      get items() {
        return [...vocabData.words, ...grammarData.points, ...kanjiData.kanji].filter(
          (item) => progress.get(item.id)?.learned === false,
        );
      },
    };

    initController(elements, decks);
  } catch (error) {
    console.error('[Bigu]', error);
    elements.modeGroup.hidden = true;
    elements.introText.textContent = 'Practice decks could not be loaded right now.';
    elements.startButton.hidden = true;
  }
}

export { initPractice };
