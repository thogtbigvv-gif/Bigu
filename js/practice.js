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
   first, then items not yet met. That's the whole behavioural difference
   from the shuffle this used to do — what you see is what the schedule says
   is ready, not a random handful of whatever isn't ticked off yet.

   Each finished round is logged to the practice store, tagged with its
   deck, for dashboard.js. A small history block reads that same store back
   to list the most recent rounds, refreshed after every one.

   This file also owns the two writes to the `bigu:bridge` key — one event
   per finished round, and the status snapshot — because it already owns
   both the shared round logger and the review pool those figures are
   counted over. Home and Lessons run rounds through the same logger, so all
   three surfaces publish identically. Nothing is ever read back.
   ========================================================================== */

import { practice, settings } from './storage.js';
import { publishEvent, publishStatus } from './bridge.js';
import { getViewContainer } from './content.js';
import { buildSession, countDue, snapshotRecords } from './review.js';
import { createQuiz, createModePicker, ADAPTERS, deckKeyForItemId } from './quiz.js';
import { sessionSize } from './preferences.js';
import { currentStreak, toDateKey } from './streak.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';
import { loadLessons } from './lessons.js';

const VIEW_ID = 'practice';
const DECK_SETTING_KEY = 'practiceMode';
const QUIZ_MODE_SETTING_KEY = 'quizMode';
const HISTORY_LIMIT = 5;

/* -- The review pool ---------------------------------------------------------------
   The four content decks and the flattened everything-pool built out of
   them. This was inline in initPractice and is lifted out because two other
   places need exactly the same answer and neither should be re-deriving it:
   the bridge's status snapshot counts what's due and held over `everything`,
   and home.js asks whether anything is waiting and pulls its one line of
   Japanese out of the same three sources.

   The promise is memoized rather than the value, same reasoning as
   content.js's own loaders: the three callers start within a frame of each
   other, so caching the resolved arrays would only close the window after
   the first build had finished. One build, whoever asks first. A failure
   drops the cache so a later caller really does retry.
   ---------------------------------------------------------------------------------- */

let pendingPool = null;

function loadReviewPool() {
  if (!pendingPool) {
    pendingPool = (async () => {
      const [vocabData, grammarData, kanjiData, lessonData] = await Promise.all([
        loadVocabulary(),
        loadGrammar(),
        loadKanji(),
        loadLessons(),
      ]);

      const lessonWords = lessonData.flatMap((lesson) => lesson.words);
      const vocabulary = vocabData.words;
      const grammar = grammarData.points;
      const kanji = kanjiData.kanji;

      return {
        // The lessons as authored, not only their flattened words: Home
        // names the lesson a word came from, and a word row carries its
        // lesson only in the shape of its own id.
        lessons: lessonData,
        lessonWords,
        vocabulary,
        grammar,
        kanji,
        // Only what the quiz can actually ask about: an id whose prefix no
        // adapter claims would reach buildQuestion with no adapter behind it.
        everything: [...lessonWords, ...vocabulary, ...grammar, ...kanji]
          .filter((item) => deckKeyForItemId(item.id) !== null),
      };
    })();

    pendingPool.catch(() => { pendingPool = null; });
  }

  return pendingPool;
}

/* -- Logging a finished round -------------------------------------------------------
   The three writes every finished round in this app makes, in the order
   they have to happen: the practice store generates the id, the bridge
   republishes that same id as an event so anything reading `bigu:bridge` on
   this origin can dedupe on it, and the bridge's status snapshot is redrawn
   because a graded round is exactly what changes it.

   Lifted out of this module's own onFinish because Home and Lessons both
   run rounds of their own and have to log them *identically* — a practice
   surface that quietly skipped any of the three would be a session the
   reader did and the Review history, the Dashboard or summer-project never
   heard about. What matters is that there is one copy of them for every
   caller rather than a second contract growing beside the first.

   `eventType` is the one thing a caller varies: the same round means
   something slightly different published from Review than from a lesson, so
   the reader on the other side is told which. Everything else about the
   event is the same shape either way, because the round is the same round.

   A round ended before anything was graded logs nothing and says so by
   returning null. Same rule as before: reporting 0/0 is reporting nothing.
   ---------------------------------------------------------------------------------- */
function recordSession({ total, correct, mode, eventType = 'review.session' }) {
  if (!(total > 0)) return null;
  const record = practice.add({ total, correct, mode });
  // Neither can throw — bridge.js swallows its own storage errors — and
  // nothing here depends on either having worked.
  publishEvent({
    id: record.id,
    type: eventType,
    value: correct,
    detail: `${total} items \u00b7 ${correct} correct`,
  });
  publishStatusSnapshot();
  return record;
}

/* -- The bridge's status snapshot ----------------------------------------------------
   How things stand right now, for the separate summer-project surface
   served from the same origin: how much is waiting, when the reader last
   studied, how much they are holding, and the streak the Dashboard would
   show them. Published at boot and again after every graded round, since
   those are the two moments any of it can have changed.

   Display-ready values only, and nothing invented for the occasion. Each
   number here is one the app already counts for its own screens — the
   summed countDue() behind the Dashboard's Today card, its Memory figure,
   its streak — so the reader on the other side prints them and no more.
   There is no score, no level and no XP: Bigu does not compute one, and the
   bridge is not the place to start.

   A streak of zero is published as no streak at all rather than as 0. There
   is a difference between "your run is broken" and "you have no run", and
   only the first is worth a reader's screen space.

   Fire and forget, deliberately. It waits on the four content files, so
   awaiting it would hold whatever called it — at boot, the first paint of
   Home — behind four fetches that nothing on screen needs. It cannot throw
   into its caller: publishStatus() swallows its own storage errors, and a
   failed fetch is logged and dropped here, because a browser that cannot
   reach data/ still has an app to render.
   ---------------------------------------------------------------------------------- */
function publishStatusSnapshot() {
  loadReviewPool()
    .then((pool) => {
      const counts = countDue(pool.everything);
      const streak = currentStreak();
      // Max rather than the last element: a restored backup writes the array
      // back whole, and nothing guarantees the order it was saved in.
      const lastStudiedAt = practice.getAll()
        .reduce((latest, record) => Math.max(latest, record?.createdAt ?? 0), 0);

      publishStatus({
        dueCount: counts.due,
        learnedCount: counts.remembered,
        lastStudied: lastStudiedAt ? toDateKey(new Date(lastStudiedAt)) : undefined,
        streak: streak > 0 ? streak : undefined,
      });
    })
    .catch((error) => console.error('[Bigu]', error));
}

/* Where a finished round points next, per deck. Not a recommendation engine
   and deliberately not a guess: each deck already knows which reference view
   its own items came from, so "continue" means the shelf you were just
   drawing from. The two live pools have no shelf of their own — "Due today"
   spans the whole catalogue, so it offers the beginner on-ramp, and "Tricky
   ones" is by definition about what the reader is holding badly, so it
   offers the screen that is about exactly that. */
const DECK_NEXT = {
  lessons: '#lessons',
  vocabulary: '#vocabulary',
  grammar: '#grammar',
  kanji: '#kanji',
  due: '#lessons',
  mistakes: '#memory',
};

/* "Due today" leads: it's the deck that answers the question the Dashboard
   just asked, and the one a reader should be in on most days. The four
   content decks are the same four ADAPTERS in quiz.js; "Due today" and
   "Tricky ones" are live pools rather than decks of their own. */
const DECK_KEYS = ['due', 'lessons', 'vocabulary', 'grammar', 'kanji', 'mistakes'];

/* Exported: dashboard.js labels saved sessions with the deck they were
   drawn from, and it kept its own copy of this table. Two copies meant one
   deck under two names — "Tricky ones" on this screen, "Review mistakes" on
   the Dashboard — for the same round. */
const DECK_LABELS = {
  due: 'Due today',
  lessons: ADAPTERS.lessons.label,
  vocabulary: ADAPTERS.vocabulary.label,
  grammar: ADAPTERS.grammar.label,
  kanji: ADAPTERS.kanji.label,
  mistakes: 'Tricky ones',
};

/* Roughly how long a round takes, at a shade over ten seconds a card — the
   pace of reading a question, picking one of four and glancing at the
   answer. Rounded up to the nearest minute and never zero, because "~0 мин"
   is not an estimate.

   It is here rather than inside the quiz because this is where the reader
   decides whether to start: what a round costs belongs beside the button
   that begins one, not on the first question of it. */
function describeRound(count) {
  const minutes = Math.max(1, Math.round((count * 11) / 60));
  return `${count} асуулт · ~${minutes} мин`;
}

/* -- View ------------------------------------------------------------------------------------
   Two screens in one region: the intro (pick a deck, pick a mode, start)
   and the quiz. The quiz hides everything else while it runs — see the
   note at the top of quiz.css about why a round is the only thing on
   screen — and the intro comes back when it ends.
   ---------------------------------------------------------------------------------------------- */

function buildView(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'practice';

  /* Intro */
  const intro = document.createElement('div');
  intro.className = 'practice__intro';

  const deckLabel = document.createElement('p');
  deckLabel.className = 'practice__deck-label';
  deckLabel.id = 'practice-deck-label';
  deckLabel.textContent = 'Юуг давтмаар байна?';

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
  status.setAttribute('aria-live', 'polite');

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'button button--primary practice__start';
  startButton.textContent = 'Start review';

  // status and the start button are appended by the controller, after the
  // mode picker, so the intro reads deck -> mode -> what you'll get -> go.
  intro.append(deckLabel, deckGroup);

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
  historyEmpty.textContent = 'Дуусгасан давталт хараахан алга — нэгийг дуусгавал энд харагдана.';

  history.append(historyHeading, historyList, historyEmpty);

  wrapper.append(intro, history);
  container.replaceChildren(wrapper);

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
      recordSession({ total, correct, mode: state.deck });
      renderHistory();
      updateStatus();
    },
    // Read per round, not once at boot: changing the round length in
    // Settings should apply to the next round, not the next page load.
    onNewRound: () => buildSession(decks[state.deck].items, sessionSize()),
    /* One way onward from a finished round, so a session ends somewhere
       instead of stopping dead on a score. Read at finish time rather than
       fixed at construction, because the deck can change between rounds. */
    onNextStep: () => {
      const href = DECK_NEXT[state.deck];
      return href ? { go: () => { location.hash = href; } } : null;
    },
    onExit: showIntro,
  });

  elements.intro.append(modePicker.wrap, elements.status, elements.startButton);
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
        ? 'Одоогоор түвэгтэй юм алга — таны танилцсан зүйлсээс шатны ёроолд гацсан нь байхгүй.'
        : `${DECK_LABELS[state.deck]} дотор давтах юм хараахан алга.`;
      elements.startButton.hidden = true;
      return;
    }

    elements.startButton.hidden = false;
    const { due, new: fresh } = countDue(items);
    const size = sessionSize();

    if (state.deck === 'mistakes') {
      elements.status.textContent =
        'Бүх багцаас удаан тогтож буй зүйлс. '
        + `Энэ давталтад ${describeRound(Math.min(size, items.length))}.`;
      return;
    }

    if (due === 0 && fresh === 0) {
      elements.status.textContent =
        'Хүлээж буй юм алга — энд байгаа бүхний хугацаа хараахан болоогүй байна. '
        + 'Одоо давтвал хамгийн ойрд эргэж ирэх зүйлсийг үзнэ. '
        + `Энэ давталтад ${describeRound(Math.min(size, items.length))}.`;
      return;
    }

    /* Neither pool is counted any more. "842 зүйл хараахан эхлээгүй" is a
       fact about a JSON file worn as a fact about the reader, and it is the
       one sentence in the app guaranteed never to shrink no matter how much
       they study; "14 зүйл давтах цаг болсон" is the same shape with a
       deadline attached. What the screen before a round has to answer is what
       this round will be, and that is the size of the round itself — a number
       the reader chose, in settings, and can change.

       The order still holds: what is ready leads, what is untouched follows
       as a supply rather than a backlog. */
    const parts = [];
    if (due > 0) parts.push('Эргэж ирэхэд бэлэн зүйл байна');
    if (fresh > 0) parts.push('хараахан үзээгүй зүйл ч бий');
    elements.status.textContent =
      `${parts.join(' · ')}. Энэ давталтад ${describeRound(Math.min(size, due + fresh))}, `
      + 'бэлэн болсныг эхэлж үзнэ.';
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
    const queue = buildSession(deck.items, sessionSize());
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

  /* Sorted by when they happened, not by where they sit in the array. The
     store appends, so those agreed — right up until a restored backup or a
     hand-merged file arrived in a different order, at which point a list
     headed "Recent sessions" would quietly show the oldest five. */
  function renderHistory() {
    const recent = practice
      .getAll()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, HISTORY_LIMIT);
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

  const elements = buildView(getViewContainer(view, 'practice-content'));

  try {
    const pool = await loadReviewPool();
    const everything = pool.everything;

    const decks = {
      lessons: { items: pool.lessonWords },
      vocabulary: { items: pool.vocabulary },
      grammar: { items: pool.grammar },
      kanji: { items: pool.kanji },
    };

    // "Due today" is the whole pool, not a filtered one: buildSession() does
    // the filtering, and it re-reads the schedule every round, so what the
    // reader actually gets is due-first whatever this array holds. It was
    // written as a getter that returned `everything` unchanged, which read
    // as if it recomputed something — and made updateStatus's
    // `items.length === 0` branch unreachable for this deck, since the
    // catalogue is never empty.
    decks.due = { items: everything };

    decks.mistakes = {
      get items() {
        // One read of the store per call, not one per item: this getter is
        // wired to onGrade, so it re-runs after every card of every round
        // over the whole catalogue.
        const records = snapshotRecords();
        return everything.filter((item) => {
          const record = records.get(item.id);
          // An actual miss, not merely level 0. Taking a word back out of
          // memory with the mark on its card also parks it at level 0, and
          // a deck of things the reader deliberately un-marked is not a
          // deck of things they keep getting wrong.
          return Boolean(record?.seen) && record.level === 0 && record.lapses >= 1;
        });
      },
    };

    initController(elements, decks);
  } catch (error) {
    console.error('[Bigu]', error);
    elements.deckGroup.hidden = true;
    elements.status.textContent =
      'Давталтын багцууд ачаалагдсангүй. Тэдгээр нь data/ доторх дөрвөн JSON файлаас бүтдэг бөгөөд ядаж нэг нь ирээгүй байна — хэрэв та энэ хуудсыг файлаар нээсэн бол локал сервер дээр ажиллуулах хэрэгтэй.';
    elements.startButton.hidden = true;
  }
}

export { initPractice, loadReviewPool, recordSession, publishStatusSnapshot, DECK_LABELS };
