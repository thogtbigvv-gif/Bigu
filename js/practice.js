/* ==========================================================================
   practice.js
   Self-graded flashcard quiz for the #practice view. A mode selector lets
   the reader choose which deck to drill — everything due, or one of
   lessons / vocabulary / grammar / kanji, or just the items they've been
   getting wrong — each described by a small adapter in DECKS below (how to
   fill the card front, the secondary line, and the reveal-answer fields).
   Reveal → self-mark → next.

   Grading goes through review.js, which is what decides when a card comes
   back. Session contents come from the same place: due items first, oldest
   due date first, then new items to top up. This used to be a shuffle of
   whatever wasn't ticked off yet, which got less useful the more content
   the app had — the opposite of how a review system should scale.

   Each finished session is logged to the practice store, tagged with its
   mode, for dashboard.js. A small history block reads that same store back
   to list the most recent rounds (mode, score, when), refreshed after every
   finished session.
   ========================================================================== */

import { practice, settings } from './storage.js';
import { formatCount } from './content.js';
import {
  buildSession,
  countDue,
  describeNextReview,
  getRecord,
  grade as gradeItem,
} from './review.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';
import { loadLessons, createHeadword as createLessonHeadword } from './lessons.js';
import { sessionSize } from './preferences.js';

const VIEW_ID = 'practice';
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
      setField(elements.meaning, word.meaning);
      setField(elements.exampleJp, word.example?.jp);
      setField(elements.exampleReading, word.example?.reading);
      setField(elements.exampleEn, word.example?.mn);
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
      setField(elements.meaning, point.meaning);
      setField(elements.exampleJp, point.example?.jp);
      setField(elements.exampleReading, point.example?.reading);
      setField(elements.exampleEn, point.example?.mn);
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
      setField(elements.meaning, entry.meaning);
      setField(elements.exampleJp, entry.example?.word);
      setField(elements.exampleReading, entry.example?.reading);
      setField(elements.exampleEn, entry.example?.mn);
    },
  },

  lessons: {
    label: 'Lessons',
    fillFront(container, entry) {
      container.replaceChildren(createLessonHeadword(entry));
    },
    secondary() {
      // A lesson word carries no part of speech or structure line — the
      // reading is already in the furigana on the front.
      return { text: '', className: null, lang: null };
    },
    fillAnswer(elements, entry) {
      setField(elements.meaning, entry.english);
      setField(elements.exampleJp, '');
      setField(elements.exampleReading, '');
      setField(elements.exampleEn, '');
    },
  },

  /* Two pools rather than content decks of their own: "Due today" is
     everything the schedule says is ready across all four decks, and
     "Review mistakes" is everything currently sitting at level 0. Each item
     still needs its real deck's card layout, so every method here looks up
     which deck the item's id belongs to (the "l"/"n3-"/"gr-"/"kj-" prefix
     already used throughout the data) and delegates to that deck's own
     fillFront/secondary/fillAnswer. */
  due: {
    label: 'Due today',
    fillFront(container, item) {
      deckForItem(item)?.fillFront(container, item);
    },
    secondary(item) {
      return deckForItem(item)?.secondary(item) ?? { text: '', className: null, lang: null };
    },
    fillAnswer(elements, item) {
      deckForItem(item)?.fillAnswer(elements, item);
    },
  },

  mistakes: {
    label: 'Review mistakes',
    fillFront(container, item) {
      deckForItem(item)?.fillFront(container, item);
    },
    secondary(item) {
      return deckForItem(item)?.secondary(item) ?? { text: '', className: null, lang: null };
    },
    fillAnswer(elements, item) {
      deckForItem(item)?.fillAnswer(elements, item);
    },
  },
};

/* Lesson ids are l1-01, l2-14, … — checked first because "l" is a looser
   test than the three-character prefixes below it. Adding lessons here is
   what lets lesson vocabulary be reviewed at all: it's the beginner
   on-ramp, and until now it was the one deck that could be marked learned
   but never scheduled. */
function deckKeyForItemId(id) {
  if (/^l\d+-/.test(id)) return 'lessons';
  if (/^n[1-5]-/.test(id)) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

/* The mistakes pool already filters to items whose id maps to a real deck, so
   this only ever returns null if an unrecognized id slips through (a renamed
   prefix, a hand-edited progress store). Returning null instead of indexing
   DECKS with it keeps that a blank card rather than a TypeError that takes
   the whole round down. */
function deckForItem(item) {
  const key = deckKeyForItemId(item.id);
  return key ? DECKS[key] : null;
}

/* "Due today" leads: it's the deck that answers the question the Dashboard
   just asked, and the one a reader should be in most days. */
const DECK_KEYS = ['due', 'lessons', 'vocabulary', 'grammar', 'kanji', 'mistakes'];

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

  /* .toggle-chip, not a bespoke .practice__mode-button. The two were
     visually near-identical and had already drifted: the local copy was
     missing both the focus ring and the press feedback the shared chip has,
     which made this deck picker the one control in the app with no focus
     indicator at all. practice.css keeps only the row layout. */
  const modeButtons = {};
  for (const key of DECK_KEYS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip practice__mode-button';
    button.textContent = DECKS[key].label;
    button.dataset.mode = key;
    modeButtons[key] = button;
    modeGroup.append(button);
  }

  /* Intro */
  const intro = document.createElement('div');
  intro.className = 'card practice__intro';

  const introText = document.createElement('p');
  introText.className = 'practice__intro-text';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'button button--primary';
  startButton.textContent = 'Start review';

  intro.append(introText, startButton);

  /* Session */
  const session = document.createElement('div');
  session.className = 'practice__session';
  session.hidden = true;

  const status = document.createElement('p');
  status.className = 'practice__status meta';
  status.setAttribute('aria-live', 'polite');

  /* How far through the round the reader is, as a line rather than only as
     "Card 3 / 10". A round has no other sense of shape — every card looks
     like the one before it — and knowing whether the end is near is the
     difference between "I'll do a couple more" and "I don't know how long
     this is". aria-hidden because the status line above already says the
     same thing in words, and announcing it twice per card is noise. */
  const progress = document.createElement('div');
  progress.className = 'practice__progress';
  progress.setAttribute('aria-hidden', 'true');

  const progressBar = document.createElement('span');
  progressBar.className = 'practice__progress-bar';
  progress.append(progressBar);

  const card = document.createElement('div');
  card.className = 'card practice-card';

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

  /* Feedback on the last grade — "back in 3 days". The schedule is the whole
     point of grading honestly, so it shouldn't be invisible. */
  const scheduleNote = document.createElement('p');
  scheduleNote.className = 'practice__schedule-note meta';
  scheduleNote.setAttribute('aria-live', 'polite');

  const shortcutHint = document.createElement('p');
  shortcutHint.className = 'practice__shortcut-hint meta';
  shortcutHint.textContent = 'Space to reveal · 1 still learning · 2 knew it';

  /* The mode picker and history are hidden during a round on purpose, so
     switching decks can't happen mid-session — but that left no way out of
     one at all except the nav. The lessons quiz has always had its exit
     button; this is the same control, kept quiet and at the foot so it
     never competes with the two grade buttons. */
  const endButton = document.createElement('button');
  endButton.type = 'button';
  endButton.className = 'button button--secondary practice__end';
  endButton.textContent = 'End session';

  session.append(status, progress, card, revealButton, grade, scheduleNote, shortcutHint, endButton);

  /* Summary */
  const summary = document.createElement('div');
  summary.className = 'card practice__summary';
  summary.hidden = true;

  const summaryText = document.createElement('p');
  summaryText.className = 'practice__summary-text';

  const summaryActions = document.createElement('div');
  summaryActions.className = 'practice__summary-actions';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--primary';
  againButton.textContent = 'Another round';

  /* A way out of the loop. The summary used to offer exactly one action —
     start again — which reads as an app that would like you to keep going
     rather than one that thinks stopping is a fine outcome. Finishing a
     round is a good place to stop, and the Dashboard is where the reader
     can see what that round did. */
  const doneLink = document.createElement('a');
  doneLink.href = '#dashboard';
  doneLink.className = 'button button--secondary';
  doneLink.textContent = 'Done for now';

  summaryActions.append(againButton, doneLink);
  summary.append(summaryText, summaryActions);

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
    session, status, progressBar, headword, pos, answer, meaning, exampleJp, exampleReading, exampleEn,
    revealButton, grade, stillLearningButton, knewItButton, scheduleNote, endButton,
    summary, summaryText, againButton,
    history, historyList, historyEmpty,
    card,
  };
}

/* An empty field is hidden, not left blank. A lesson word carries no
   example sentence, so its three example paragraphs were rendered with
   empty text — three empty line boxes that opened a hole roughly a third of
   the card tall between the meaning and the bottom edge, on every lesson
   card, in the middle of a round. Nothing was wrong and it looked like
   something had failed to load. */
function setField(element, text) {
  element.textContent = text ?? '';
  element.hidden = !text;
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
  setField(elements.pos, text);
}

function initController(elements, decks) {
  const initialMode = DECK_KEYS.includes(settings.get(MODE_SETTING_KEY)) ? settings.get(MODE_SETTING_KEY) : 'due';
  const state = { mode: initialMode, queue: [], index: 0, correct: 0 };

  function currentDeck() {
    return decks[state.mode];
  }

  function syncModeButtons() {
    for (const key of DECK_KEYS) {
      elements.modeButtons[key].setAttribute('aria-pressed', String(key === state.mode));
    }
  }

  /* What the reader is about to get, in the schedule's own terms rather than
     "N items in the deck" \u2014 the point of the ladder is that the number that
     matters is what's ready, not how much content exists. */
  function updateIntroText() {
    const deck = currentDeck();
    const items = deck.items;

    if (items.length === 0) {
      elements.introText.textContent = state.mode === 'mistakes'
        ? 'Nothing to re-drill \u2014 nothing you\u2019ve seen is currently marked "Still learning".'
        : `No ${deck.label.toLowerCase()} available to practice with yet.`;
      elements.startButton.hidden = true;
      return;
    }

    elements.startButton.hidden = false;
    const { due, new: fresh } = countDue(items);

    const size = sessionSize();

    if (state.mode === 'mistakes') {
      elements.introText.textContent =
        `${items.length} item${items.length === 1 ? '' : 's'} sitting at the bottom of the ladder, pulled from every deck. A round covers up to ${size}.`;
      return;
    }

    if (due === 0 && fresh === 0) {
      elements.introText.textContent =
        `Nothing due in ${deck.label.toLowerCase()} \u2014 everything is scheduled ahead. Starting a round reviews the items closest to coming back.`;
      return;
    }

    /* Due first, and said in that order. "not started" is deliberately not
       given a total here: the catalogue holds well over a thousand items a
       reader has never met, and a four-figure number attached to the word
       "not" is a debt notice, not a status line. What's due is the part
       today can actually move. */
    const parts = [];
    if (due > 0) parts.push(`${due} due`);
    if (fresh > 0) parts.push(`${formatCount(fresh)} not started`);
    elements.introText.textContent =
      `${parts.join(' \u00b7 ')}. A round covers up to ${size}, due items first.`;
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
    elements.status.textContent = `Card ${state.index + 1} of ${state.queue.length} · ${state.correct} known so far`;
    elements.progressBar.style.setProperty(
      '--progress',
      (state.index / state.queue.length).toFixed(3),
    );

    deck.fillFront(elements.headword, item);
    applySecondary(elements, deck, item);
    deck.fillAnswer(elements, item);

    elements.answer.hidden = true;
    elements.grade.hidden = true;
    elements.revealButton.hidden = false;
    elements.scheduleNote.textContent = '';

    // A 120ms cross-fade on the card, so the eye tracks that one card
    // replaced another instead of the text simply being different. Restarting
    // the animation needs the class off for a frame first. See the motion
    // note in practice.css.
    elements.card.classList.remove('is-advancing');
    requestAnimationFrame(() => elements.card.classList.add('is-advancing'));
  }

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

  /* `graded` is how many cards were actually answered, which is not the queue
     length once "End session" exists — logging a 3/10 for a round the reader
     stopped after three cards would quietly punish them for stopping. */
  function finishSession(graded = state.queue.length) {
    if (graded > 0) {
      practice.add({ total: graded, correct: state.correct, mode: state.mode });
    }
    elements.progressBar.style.setProperty('--progress', '1');
    elements.summaryText.textContent = graded === 0
      ? 'Ended before any cards were graded — nothing was recorded.'
      : `${state.correct} of ${graded} marked "I knew it". The ones you missed come back today; the rest are scheduled.`;
    renderHistory();
    updateIntroText();
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

  /* One animated thing per interaction: a single flash on the card's border,
     moss for a pass and a 4px settle for a miss. The class is removed on
     animationend rather than by the next renderCard, because advance() runs
     immediately and would otherwise cancel the flash before it was seen. */
  function flashCard(kind) {
    const card = elements.card;
    card.classList.remove('is-correct', 'is-incorrect');
    // Reading offsetWidth forces the removal to take effect before the class
    // goes back on, so consecutive grades each get their own animation.
    void card.offsetWidth;
    card.classList.add(kind);
    card.addEventListener('animationend', () => card.classList.remove(kind), { once: true });
  }

  function grade(knewIt) {
    const item = state.queue[state.index];
    const record = gradeItem(item.id, knewIt);
    if (knewIt) state.correct += 1;

    flashCard(knewIt ? 'is-correct' : 'is-incorrect');
    advance();

    // Set after advance(), which clears the note as part of rendering the
    // next card — this is feedback about the grade just given, so it has to
    // survive that.
    elements.scheduleNote.textContent = describeNextReview(record) === 'again this round'
      ? 'Still learning — this one comes back today.'
      : `Marked known — ${describeNextReview(record)}.`;
  }

  function startSession() {
    const deck = currentDeck();
    // Read per round, not once at boot: changing the round length in
    // Settings should apply to the next round, not the next page load.
    state.queue = buildSession(deck.items, sessionSize());
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

  // Ends the round at whatever card the reader is on. state.index is the
  // number already graded, since renderCard shows queue[index] and grade()
  // advances past it.
  elements.endButton.addEventListener('click', () => finishSession(state.index));

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

  // Escape ends the round, matching the new "End session" button. Only while
  // a card is on screen, so it can't interfere with the mobile drawer's own
  // Escape handling on any other view.
  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (elements.session.hidden) return;
    finishSession(state.index);
  }

  document.addEventListener('keydown', handleEscape);

  document.addEventListener('keydown', handleKeydown);

  // The deck counts this screen reports go stale while the reader is on
  // another view: marking a word "Still learning" in Vocabulary changes what
  // the mistakes pool holds, and finishing a round changes the history. Both
  // are re-read on the way back in — but never mid-round, where replacing the
  // intro under an active session would be the only visible effect.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (!elements.session.hidden) return;
    updateIntroText();
    renderHistory();
  });

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
    const [vocabData, grammarData, kanjiData, lessonData] = await Promise.all([
      loadVocabulary(),
      loadGrammar(),
      loadKanji(),
      loadLessons(),
    ]);

    const lessonWords = lessonData.flatMap((lesson) => lesson.words);
    const everything = [...lessonWords, ...vocabData.words, ...grammarData.points, ...kanjiData.kanji];

    const decks = {
      lessons: { ...DECKS.lessons, items: lessonWords },
      vocabulary: { ...DECKS.vocabulary, items: vocabData.words },
      grammar: { ...DECKS.grammar, items: grammarData.points },
      kanji: { ...DECKS.kanji, items: kanjiData.kanji },
    };

    // Getters, not static arrays: what's due and what's still being missed
    // both change as the reader grades cards here and elsewhere, so each has
    // to be read fresh every time rather than computed once at load.
    decks.due = {
      ...DECKS.due,
      get items() {
        return everything.filter((item) => deckKeyForItemId(item.id) !== null);
      },
    };

    decks.mistakes = {
      ...DECKS.mistakes,
      get items() {
        return everything.filter(
          (item) => {
            const record = getRecord(item.id);
            return record.seen && record.level === 0 && deckKeyForItemId(item.id) !== null;
          },
        );
      },
    };

    initController(elements, decks);
  } catch (error) {
    console.error('[Bigu]', error);
    elements.modeGroup.hidden = true;
    elements.introText.textContent =
      'The review decks didn’t load. They’re built from the four JSON files in data/, and at least one didn’t arrive — if you opened this page as a file, it needs to run from a local server.';
    elements.startButton.hidden = true;
  }
}

export { initPractice };
