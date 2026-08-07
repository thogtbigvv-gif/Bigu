/* ==========================================================================
   practice.js
   The #practice (Review) view. Three things live here and nothing else:
   which deck the next round draws from, what the schedule says is waiting
   in it, and a log of recent rounds.

   The quiz itself is js/quiz.js — the same panel the per-lesson quiz uses,
   so a round plays identically wherever it was started from. This file used
   to carry its own card layout, reveal/grade flow, and summary, which was
   half of a second near-identical implementation in lessons.js.

   Session contents come from review.js: due items first, oldest due date
   first, then items not yet started. That's the whole behavioural
   difference from the shuffle this used to do — what you see is what the
   schedule says is ready, not a random handful of whatever isn't ticked
   off yet.
   ========================================================================== */

import { practice, settings } from './storage.js';
import { buildSession, countDue, getRecord } from './review.js';
import { createQuiz, createModePicker, ADAPTERS, deckKeyForItemId } from './quiz.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';
import { loadLessons } from './lessons.js';

const VIEW_ID = 'practice';
const SESSION_SIZE = 10;
const DECK_SETTING_KEY = 'practiceMode';
const QUIZ_MODE_SETTING_KEY = 'quizMode';
const HISTORY_LIMIT = 5;

/* "Due today" leads: it's the deck that answers the question the Dashboard
   just asked, and the one a reader should be in on most days. The four
   content decks are the same four ADAPTERS in quiz.js; "mistakes" is a
   live pool rather than a deck of its own. */
const DECK_KEYS = ['due', 'lessons', 'vocabulary', 'grammar', 'kanji', 'mistakes'];

const DECK_LABELS = {
  due: 'Due today',
  lessons: ADAPTERS.lessons.label,
  vocabulary: ADAPTERS.vocabulary.label,
  grammar: ADAPTERS.grammar.label,
  kanji: ADAPTERS.kanji.label,
  mistakes: 'Tricky ones',
};

/* -- View ------------------------------------------------------------------------------------
   Two screens in one region: the intro (pick a deck, pick a mode, start)
   and the quiz. The quiz hides everything else while it runs — see the
   note at the top of quiz.css about why a round is the only thing on
   screen — and the intro comes back when it ends.
   ---------------------------------------------------------------------------------------------- */

function buildView(view) {
  const wrapper = document.createElement('div');
  wrapper.className = 'practice';

  /* Intro */
  const intro = document.createElement('div');
  intro.className = 'practice__intro';

  const deckLabel = document.createElement('p');
  deckLabel.className = 'practice__deck-label';
  deckLabel.id = 'practice-deck-label';
  deckLabel.textContent = 'What do you want to review?';

  const deckGroup = document.createElement('div');
  deckGroup.className = 'practice__deck-group';
  deckGroup.setAttribute('role', 'group');
  deckGroup.setAttribute('aria-labelledby', 'practice-deck-label');

  const deckButtons = {};
  for (const key of DECK_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip practice__deck-button';
    button.textContent = DECK_LABELS[key];
    button.dataset.deck = key;
    deckButtons[key] = button;
    deckGroup.append(button);
  }

  const status = document.createElement('p');
  status.className = 'practice__status';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'button button--primary practice__start';
  startButton.textContent = 'Start review';

  intro.append(deckLabel, deckGroup, status);

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

  wrapper.append(intro, history);
  view.append(wrapper);

  return {
    wrapper, intro, deckGroup, deckButtons, status, startButton,
    history, historyList, historyEmpty,
  };
}

/* -- Controller ------------------------------------------------------------------------------ */

function initController(elements, decks) {
  const storedDeck = settings.get(DECK_SETTING_KEY);
  const state = { deck: DECK_KEYS.includes(storedDeck) ? storedDeck : 'due' };

  const modePicker = createModePicker(settings.get(QUIZ_MODE_SETTING_KEY), (mode) => {
    settings.set(QUIZ_MODE_SETTING_KEY, mode);
  });

  const quiz = createQuiz({
    isActive: () => location.hash.slice(1) === VIEW_ID,
    onGrade: updateStatus,
    onFinish({ total, correct }) {
      // A round ended early still counts what was graded — the schedule
      // already has those answers, and logging a 3/10 for a round stopped
      // after three questions would punish stopping.
      if (total > 0) {
        practice.add({ total, correct, mode: state.deck });
      }
      renderHistory();
      updateStatus();
    },
    onNewRound: () => buildSession(decks[state.deck].items, SESSION_SIZE),
    onExit: showIntro,
  });

  elements.intro.append(modePicker.wrap, elements.startButton);
  elements.wrapper.insertBefore(quiz.element, elements.history);

  /* -- Intro ---------------------------------------------------------------------------- */

  function syncDeckButtons() {
    for (const key of DECK_KEYS) {
      elements.deckButtons[key].setAttribute('aria-pressed', String(key === state.deck));
    }
  }

  /* What the reader is about to get, in the schedule's own terms rather
     than "N items in the deck" — the point of the ladder is that the
     number that matters is what's ready, not how much content exists. */
  function updateStatus() {
    const deck = decks[state.deck];
    const items = deck.items;

    if (items.length === 0) {
      elements.status.textContent = state.deck === 'mistakes'
        ? 'Nothing tricky right now — nothing you’ve seen is stuck at the bottom of the ladder.'
        : `No ${DECK_LABELS[state.deck].toLowerCase()} available to review yet.`;
      elements.startButton.hidden = true;
      return;
    }

    elements.startButton.hidden = false;
    const { due, new: fresh } = countDue(items);

    if (state.deck === 'mistakes') {
      elements.status.textContent =
        `${items.length} item${items.length === 1 ? '' : 's'} you’ve been getting wrong, from every deck. A round covers up to ${SESSION_SIZE}.`;
      return;
    }

    if (due === 0 && fresh === 0) {
      elements.status.textContent =
        `Nothing due — everything here is scheduled ahead. A round now reviews whatever comes back soonest.`;
      return;
    }

    const parts = [];
    if (due > 0) parts.push(`${due} due`);
    if (fresh > 0) parts.push(`${fresh} not started`);
    elements.status.textContent =
      `${parts.join(' · ')}. A round covers up to ${SESSION_SIZE}, due items first.`;
  }

  function selectDeck(key) {
    if (key === state.deck) return;
    state.deck = key;
    settings.set(DECK_SETTING_KEY, key);
    syncDeckButtons();
    updateStatus();
  }

  function showIntro() {
    elements.intro.hidden = false;
    elements.history.hidden = false;
    updateStatus();
    renderHistory();
  }

  function startSession() {
    const deck = decks[state.deck];
    const queue = buildSession(deck.items, SESSION_SIZE);
    if (queue.length === 0) {
      updateStatus();
      return;
    }

    elements.intro.hidden = true;
    elements.history.hidden = true;
    quiz.run(queue, {
      mode: modePicker.mode,
      pool: deck.items,
      title: DECK_LABELS[state.deck],
    });
  }

  /* -- History ----------------------------------------------------------------------------- */

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
      item.className = 'card practice__history-item';

      const mode = document.createElement('span');
      mode.className = 'practice__history-mode';
      mode.textContent = DECK_LABELS[entry.mode] ?? entry.mode;

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

  /* -- Wiring ------------------------------------------------------------------------------- */

  for (const key of DECK_KEYS) {
    elements.deckButtons[key].addEventListener('click', () => selectDeck(key));
  }

  elements.startButton.addEventListener('click', startSession);

  // What's due and what's in the history both change while the reader is on
  // another view — grading a card in a lesson quiz moves its due date. Both
  // are re-read on the way back in, but never mid-round, where replacing
  // the intro under an active quiz would be the only visible effect.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (!quiz.element.hidden) return;
    updateStatus();
    renderHistory();
  });

  syncDeckButtons();
  showIntro();
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initPractice() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const elements = buildView(view);

  try {
    const [vocabData, grammarData, kanjiData, lessonData] = await Promise.all([
      loadVocabulary(),
      loadGrammar(),
      loadKanji(),
      loadLessons(),
    ]);

    const lessonWords = lessonData.flatMap((lesson) => lesson.words);
    const everything = [...lessonWords, ...vocabData.words, ...grammarData.points, ...kanjiData.kanji]
      .filter((item) => deckKeyForItemId(item.id) !== null);

    const decks = {
      lessons: { items: lessonWords },
      vocabulary: { items: vocabData.words },
      grammar: { items: grammarData.points },
      kanji: { items: kanjiData.kanji },
    };

    // Getters, not static arrays: what's due and what's still being missed
    // both change as the reader grades cards here and elsewhere, so each is
    // read fresh every time rather than computed once at load.
    decks.due = { get items() { return everything; } };

    decks.mistakes = {
      get items() {
        return everything.filter((item) => {
          const record = getRecord(item.id);
          return record.seen && record.level === 0;
        });
      },
    };

    initController(elements, decks);
  } catch (error) {
    console.error('[Bigu]', error);
    elements.deckGroup.hidden = true;
    elements.status.textContent =
      'The review decks didn’t load. They’re built from the four JSON files in data/, and at least one didn’t arrive — if you opened this page as a file, it needs to run from a local server.';
    elements.startButton.hidden = true;
  }
}

export { initPractice };
