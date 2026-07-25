/* ==========================================================================
   practice.js
   Self-graded flashcard quiz for the #practice view, drawn from the same
   vocabulary data vocabulary.js renders as a study list. Reveal → self-mark
   → next. Marking a card writes to the same progress store vocabulary.js
   uses (so a card graded "I knew it" here shows as learned there too), and
   each finished session is logged to the practice store for dashboard.js.
   ========================================================================== */

import { progress, practice } from './storage.js';
import { loadVocabulary } from './vocabulary.js';

const VIEW_ID = 'practice';
const SESSION_SIZE = 10;

/* -- Session selection ------------------------------------------------------------------
   Unlearned words are prioritized so practice time goes where it's useful;
   once everything is learned (or there simply aren't SESSION_SIZE unlearned
   words left) the pool tops up from the full set instead of running short.
   -------------------------------------------------------------------------------------------- */

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isLearned(wordId) {
  return Boolean(progress.get(wordId)?.learned);
}

function buildSession(words) {
  const unlearned = shuffled(words.filter((word) => !isLearned(word.id)));
  if (unlearned.length >= SESSION_SIZE) return unlearned.slice(0, SESSION_SIZE);

  const learned = shuffled(words.filter((word) => isLearned(word.id)));
  return [...unlearned, ...learned].slice(0, Math.min(SESSION_SIZE, words.length));
}

/* -- Card content ------------------------------------------------------------------------- */

function fillHeadword(container, word) {
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
}

/* -- View controller ------------------------------------------------------------------------
   Three phases live in the same markup, toggled with `hidden`: an intro
   screen to start a session, the card itself, and a summary once the
   queue is empty. `state` tracks position in the queue and running score.
   ---------------------------------------------------------------------------------------------- */

function buildView(view) {
  const wrapper = document.createElement('div');
  wrapper.className = 'practice';

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
  pos.className = 'practice-card__pos meta';

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
  session.append(status, card, revealButton, grade);

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

  wrapper.append(intro, session, summary);
  view.append(wrapper);

  return {
    intro, introText, startButton,
    session, status, headword, pos, answer, meaning, exampleJp, exampleReading, exampleEn,
    revealButton, grade, stillLearningButton, knewItButton,
    summary, summaryText, againButton,
  };
}

function initController(elements, words) {
  const state = { queue: [], index: 0, correct: 0 };

  function showPhase(phase) {
    elements.intro.hidden = phase !== 'intro';
    elements.session.hidden = phase !== 'session';
    elements.summary.hidden = phase !== 'summary';
  }

  function renderCard() {
    const word = state.queue[state.index];
    elements.status.textContent = `Card ${state.index + 1} / ${state.queue.length} · ${state.correct} known so far`;

    fillHeadword(elements.headword, word);
    elements.pos.textContent = word.partOfSpeech;
    elements.meaning.textContent = word.meaning;
    elements.exampleJp.textContent = word.example.jp;
    elements.exampleReading.textContent = word.example.reading;
    elements.exampleEn.textContent = word.example.en;

    elements.answer.hidden = true;
    elements.grade.hidden = true;
    elements.revealButton.hidden = false;
  }

  function finishSession() {
    practice.add({ total: state.queue.length, correct: state.correct });
    elements.summaryText.textContent =
      `${state.correct} / ${state.queue.length} marked "I knew it" this round.`;
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
    const word = state.queue[state.index];
    progress.set(word.id, { ...progress.get(word.id), learned });
    if (learned) state.correct += 1;
    advance();
  }

  function startSession() {
    state.queue = buildSession(words);
    state.index = 0;
    state.correct = 0;

    if (state.queue.length === 0) {
      elements.introText.textContent = 'No vocabulary is available to practice with yet.';
      elements.startButton.hidden = true;
      showPhase('intro');
      return;
    }

    showPhase('session');
    renderCard();
  }

  elements.introText.textContent =
    `${words.length} words in the deck. A round covers up to ${SESSION_SIZE}, unlearned words first.`;

  elements.startButton.addEventListener('click', startSession);
  elements.againButton.addEventListener('click', startSession);

  elements.revealButton.addEventListener('click', () => {
    elements.answer.hidden = false;
    elements.grade.hidden = false;
    elements.revealButton.hidden = true;
  });

  elements.stillLearningButton.addEventListener('click', () => grade(false));
  elements.knewItButton.addEventListener('click', () => grade(true));

  showPhase('intro');
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initPractice() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const elements = buildView(view);

  try {
    const data = await loadVocabulary();
    initController(elements, data.words);
  } catch (error) {
    console.error('[Nagi]', error);
    elements.introText.textContent = 'Practice vocabulary could not be loaded right now.';
    elements.startButton.hidden = true;
  }
}

export { initPractice };
