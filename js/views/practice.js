/* ==========================================================================
   practice.js
   The #practice (Review) view. Three things live here and nothing else:
   which deck the next round draws from, what the schedule says is waiting
   in it, and a log of recent rounds.

   The quiz itself is js/ui/quiz.js — the same panel the per-lesson quiz
   uses, so a round plays identically wherever it was started from. This
   file used to carry its own card layout, reveal/grade flow, and summary,
   which was half of a second near-identical implementation in lessons.js.

   Session contents come from study/review.js: due items first, oldest due
   date first, then items not yet met. That's the whole behavioural
   difference from the shuffle this used to do — what you see is what the
   schedule says is ready, not a random handful of whatever isn't ticked off
   yet.

   Everything a *different* surface also needs has been lifted out of here,
   and the difference is worth stating because this file used to be four
   modules wearing one name. The decks it draws from are js/data/catalogue.js;
   what a deck is called and where it leads is js/study/decks.js; logging a
   finished round and republishing the bridge status is js/study/session.js.
   Three other surfaces run rounds — Home, a lesson quiz, and boot itself —
   and all three used to import this view, the Review screen, to reach them.

   What is left is the screen: pick a deck, see what the schedule says is
   waiting in it, start, and read back the last few rounds.
   ========================================================================== */

import { practice, settings } from '../core/storage.js';
import { getViewContainer } from '../ui/content.js';
import { loadReviewPool } from '../data/catalogue.js';
import { buildSession, countDue, snapshotRecords } from '../study/review.js';
import { DECK_KEYS, DECK_LABELS, DECK_NEXT } from '../study/decks.js';
import { countReviewedToday } from '../study/streak.js';
import { recordSession } from '../study/session.js';
import { createQuiz, createModePicker } from '../ui/quiz.js';
import { dailyGoal, sessionSize } from '../core/preferences.js';
import { activeViewId } from '../core/router.js';

const VIEW_ID = 'practice';
const DECK_SETTING_KEY = 'practiceMode';
const QUIZ_MODE_SETTING_KEY = 'quizMode';
const HISTORY_LIMIT = 5;

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

/* -- The daily goal ---------------------------------------------------------------------
   One line, only when the reader has asked for one. See the note on
   DAILY_GOALS in preferences.js: no goal is the default, and a goal that is
   set is reported plainly and never graded — a line of text over a hairline
   that fills, deliberately not a ring, a badge or a percentage. The point
   is to notice, not to be congratulated.

   It used to be drawn on the Dashboard, which is the screen this app took
   off its own map: a reader could set a goal in Settings and then have
   nowhere to see it, because the only surface that reported it had no nav
   row and nothing linking to it. Review is where rounds are actually run,
   so it is where the day's count belongs — and here it is redrawn as each
   round ends rather than only on the next visit.
   ------------------------------------------------------------------------------------------ */

function createGoalLine(reviewedToday, goal) {
  const wrap = document.createElement('div');
  wrap.className = 'practice__goal';

  const reached = reviewedToday >= goal;

  const label = document.createElement('p');
  label.className = 'practice__goal-label meta';
  label.textContent = reached
    ? `Өнөөдрийн зорилго биеллээ — ${reviewedToday} зүйл давтлаа.`
    : `Өнөөдөр ${reviewedToday} зүйл давтлаа — зорилт ${goal}.`;

  const track = document.createElement('div');
  track.className = 'practice__goal-track';
  track.setAttribute('aria-hidden', 'true');

  const fill = document.createElement('span');
  fill.className = 'practice__goal-fill';
  fill.style.setProperty('--progress', Math.min(reviewedToday / goal, 1).toFixed(3));
  if (reached) fill.classList.add('is-met');
  track.append(fill);

  wrap.append(label, track);
  return wrap;
}

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

  // Filled by the controller when a goal is set and left empty otherwise —
  // no goal is the default, and an empty slot draws nothing.
  const goalSlot = document.createElement('div');
  goalSlot.className = 'practice__goal-slot';

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
    wrapper, intro, deckGroup, deckButtons, status, goalSlot, startButton,
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
    isActive: () => activeViewId() === VIEW_ID,
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

  elements.intro.append(modePicker.wrap, elements.status, elements.goalSlot, elements.startButton);
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
    // First, and outside every branch below: the day's count is true whether
    // or not the chosen deck has anything in it.
    updateGoal();

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
       as a supply rather than a backlog.

       Two half-sentences, and either of them can be the one that leads. The
       second was written to follow the first and so began lowercase — which
       is what a deck with nothing due but plenty unmet said to open with, a
       reader's whole first week and every deck on their first day. It has a
       leading form now, and the joined form is unchanged. */
    const parts = [];
    if (due > 0) parts.push('Эргэж ирэхэд бэлэн зүйл байна');
    if (fresh > 0) parts.push(due > 0 ? 'хараахан үзээгүй зүйл ч бий' : 'Хараахан үзээгүй зүйл хүлээж байна');
    elements.status.textContent =
      `${parts.join(' · ')}. Энэ давталтад ${describeRound(Math.min(size, due + fresh))}, `
      + 'бэлэн болсныг эхэлж үзнэ.';
  }

  /* Read from the stores on every status update — arrival, deck change, and
     the end of a round — rather than once when the screen was built, so what
     it reports is the day's count at the moment the reader is looking at it.
     A goal of zero is no goal, which is the default, and draws nothing. */
  function updateGoal() {
    const goal = dailyGoal();
    if (goal === 0) {
      elements.goalSlot.replaceChildren();
      return;
    }
    elements.goalSlot.replaceChildren(createGoalLine(countReviewedToday(), goal));
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
    if (activeViewId() !== VIEW_ID) return;
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

export { initPractice };
