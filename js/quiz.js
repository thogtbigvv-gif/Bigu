/* ==========================================================================
   quiz.js
   The one quiz in the app. Both the Review deck and the per-lesson quiz run
   through this module — they used to be two separate implementations that
   looked similar and behaved slightly differently, which is most of why the
   quiz felt inconsistent depending on where you started it.

   Two study modes, chosen before a round:

     Choose  — a question with four answers, checked for you. This is the
               default, and it's the mode that makes the app teachable
               rather than only self-reportable: it asks something specific,
               tells you immediately whether you were right, and shows the
               answer when you weren't. A beginner has no way to fairly
               self-grade a word they've never seen; a multiple choice
               question doesn't ask them to.

     Flip    — the classic flashcard: recall it in your head, reveal, then
               say whether you knew it. Faster once the material is
               familiar, and still the honest mode for grammar patterns
               whose meanings are long enough that four of them on screen
               at once is a wall of text.

   Both grade into review.js, so either mode moves an item along the same
   schedule. Nothing here reads or writes storage directly.
   ========================================================================== */

import { grade as gradeItem, describeNextReview, shuffled } from './review.js';

/* Four is Quizlet's number and it's the right one: three distractors is
   enough that guessing is clearly worse than knowing (25%), and few enough
   that the whole set is readable at a glance on a phone. */
const CHOICE_COUNT = 4;

/* How long a correct answer sits on screen before the next question. Long
   enough to register the green, short enough that a good run feels fast.
   A wrong answer never auto-advances — see showFeedback. */
const CORRECT_PAUSE_MS = 650;

const MODES = [
  { id: 'choose', label: 'Choose', hint: 'Дөрвөн хариулт, шалгаж өгнө' },
  { id: 'flip', label: 'Flip', hint: 'Санаж үзээд, өөрөө өөрийгөө дүгнэнэ' },
];

/* -- Item adapters ---------------------------------------------------------------------
   One per content kind. Each knows how to draw its item's Japanese side,
   what the question about it should say, what counts as the answer, and
   what extra context is worth showing once the answer is in.

   These replace the near-identical deck adapters that lived in practice.js
   and the separate hand-rolled card in lessons.js.
   -------------------------------------------------------------------------------------- */

function jpSpan(text) {
  const span = document.createElement('span');
  span.lang = 'ja';
  span.textContent = text;
  return span;
}

function furigana(base, reading) {
  if (!reading || base === reading) return jpSpan(base);
  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = reading;
  ruby.append(base, rt);
  return ruby;
}

/* The example block shown under the feedback line. Built from whichever of
   jp/reading/mn an item actually has, so one function serves all four
   content kinds instead of four near-copies. */
function exampleBlock({ jp, reading, mn }) {
  const wrap = document.createElement('div');
  wrap.className = 'quiz__example';

  if (jp) {
    const line = document.createElement('p');
    line.lang = 'ja';
    line.className = 'quiz__example-jp';
    line.textContent = jp;
    wrap.append(line);
  }
  if (reading) {
    const line = document.createElement('p');
    line.lang = 'ja';
    line.className = 'reading';
    line.textContent = reading;
    wrap.append(line);
  }
  if (mn) {
    const line = document.createElement('p');
    line.className = 'meta';
    line.textContent = mn;
    wrap.append(line);
  }

  return wrap;
}

const ADAPTERS = {
  lessons: {
    label: 'Lessons',
    question: 'Энэ үг ямар утгатай вэ?',
    front: (item) => furigana(item.word, item.reading),
    hint: () => '',
    meaning: (item) => item.english,
    detail: () => null,
  },

  vocabulary: {
    label: 'Vocabulary',
    question: 'Энэ үг ямар утгатай вэ?',
    front: (item) => (item.kanji ? furigana(item.kanji, item.kana) : jpSpan(item.kana)),
    hint: (item) => item.partOfSpeech,
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock(item.example),
  },

  grammar: {
    label: 'Grammar',
    question: 'Энэ хэлбэр ямар утгатай вэ?',
    front: (item) => {
      const wrap = document.createElement('span');
      wrap.lang = 'ja';
      wrap.append('〜', item.patternKana ? furigana(item.pattern, item.patternKana) : item.pattern);
      return wrap;
    },
    hint: (item) => item.structure,
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock(item.example),
  },

  kanji: {
    label: 'Kanji',
    question: 'Энэ ханз ямар утгатай вэ?',
    front: (item) => jpSpan(item.character),
    hint: (item) => [item.onyomi, item.kunyomi].filter(Boolean).join(' ・ '),
    meaning: (item) => item.meaning,
    detail: (item) => exampleBlock({ jp: item.example.word, reading: item.example.reading, mn: item.example.mn }),
  },
};

/* Lesson ids are l1-01, l2-14, … — tested first because "l" is a looser
   match than the prefixes below it. Vocabulary ids carry any level prefix
   (n5-0001 … n1-…), so the pattern matches the whole ladder rather than
   the one prefix the earliest word list happened to use.

   The prefix in an id is history, not a level: an id is the key every
   progress and review record in localStorage is stored under, so it never
   changes once written, even when the entry's actual level says otherwise.
   Read the entry's own level, never its id. */
function deckKeyForItemId(id) {
  if (/^l\d+-/.test(id)) return 'lessons';
  if (/^n[1-5]-/.test(id)) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

function adapterFor(item) {
  const key = deckKeyForItemId(item.id);
  return key ? ADAPTERS[key] : null;
}

/* -- Question building -------------------------------------------------------------------
   Distractors are drawn only from items of the same kind as the question.
   A round pulled from the mixed "Due today" pool would otherwise offer a
   grammar explanation among four answers to a kanji question, and the odd
   one out gives the answer away without the reader knowing anything.

   Meanings are de-duplicated too: two entries that genuinely share a gloss
   would make a question with two right answers.
   -------------------------------------------------------------------------------------- */

function buildChoices(item, pool) {
  const adapter = adapterFor(item);
  const answer = adapter.meaning(item);
  const kind = deckKeyForItemId(item.id);

  const seen = new Set([answer]);
  const distractors = [];

  for (const candidate of shuffled(pool)) {
    if (distractors.length >= CHOICE_COUNT - 1) break;
    if (candidate.id === item.id) continue;
    if (deckKeyForItemId(candidate.id) !== kind) continue;

    const text = adapterFor(candidate).meaning(candidate);
    if (!text || seen.has(text)) continue;

    seen.add(text);
    distractors.push(text);
  }

  return shuffled([answer, ...distractors]).map((text) => ({ text, correct: text === answer }));
}

/* -- Markup -------------------------------------------------------------------------------
   One panel covering both modes; the parts a mode doesn't use are hidden
   rather than rebuilt, so switching modes between rounds never rebuilds
   the DOM. Structure top to bottom: progress bar, counters + exit, the
   card, the mode's own controls, feedback.
   -------------------------------------------------------------------------------------------- */

function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'quiz';
  panel.hidden = true;

  /* Progress. aria-hidden because the counter beside it says the same thing
     in words — announcing it again on every question is noise. */
  const bar = document.createElement('div');
  bar.className = 'quiz__progress';
  bar.setAttribute('aria-hidden', 'true');

  const barFill = document.createElement('span');
  barFill.className = 'quiz__progress-bar';
  bar.append(barFill);

  const head = document.createElement('div');
  head.className = 'quiz__head';

  const title = document.createElement('p');
  title.className = 'quiz__title';

  const count = document.createElement('p');
  count.className = 'quiz__count';
  count.setAttribute('aria-live', 'polite');

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.className = 'button button--secondary quiz__exit';
  exitButton.textContent = 'End';

  head.append(title, count, exitButton);

  /* Card */
  const card = document.createElement('div');
  card.className = 'card quiz__card';

  const prompt = document.createElement('p');
  prompt.className = 'quiz__prompt';

  const front = document.createElement('p');
  front.className = 'quiz__front';

  const hint = document.createElement('p');
  hint.className = 'quiz__hint';

  card.append(prompt, front, hint);

  /* Choose mode */
  const options = document.createElement('div');
  options.className = 'quiz__options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Answers');

  /* Flip mode */
  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'button button--primary quiz__reveal';
  revealButton.textContent = 'Show answer';

  const grade = document.createElement('div');
  grade.className = 'quiz__grade';
  grade.hidden = true;

  const missButton = document.createElement('button');
  missButton.type = 'button';
  missButton.className = 'button button--secondary quiz__grade-button';
  missButton.textContent = 'Still learning';

  const knewButton = document.createElement('button');
  knewButton.type = 'button';
  knewButton.className = 'button button--primary quiz__grade-button';
  knewButton.textContent = 'I knew it';

  grade.append(missButton, knewButton);

  /* Feedback, shared by both modes */
  const feedback = document.createElement('div');
  feedback.className = 'quiz__feedback';
  feedback.hidden = true;

  const verdict = document.createElement('p');
  verdict.className = 'quiz__verdict';
  verdict.setAttribute('role', 'status');

  const detail = document.createElement('div');
  detail.className = 'quiz__detail';

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'button button--primary quiz__continue';
  continueButton.textContent = 'Continue';

  feedback.append(verdict, detail, continueButton);

  const shortcuts = document.createElement('p');
  shortcuts.className = 'quiz__shortcuts meta';

  /* Summary */
  const summary = document.createElement('div');
  summary.className = 'quiz__summary';
  summary.hidden = true;

  const summaryScore = document.createElement('p');
  summaryScore.className = 'quiz__summary-score';

  const summaryText = document.createElement('p');
  summaryText.className = 'quiz__summary-text';

  const missedHeading = document.createElement('p');
  missedHeading.className = 'quiz__missed-heading';
  missedHeading.textContent = 'Worth another look';

  const missedList = document.createElement('ul');
  missedList.className = 'quiz__missed-list';

  const summaryActions = document.createElement('div');
  summaryActions.className = 'quiz__summary-actions';

  const retryMissedButton = document.createElement('button');
  retryMissedButton.type = 'button';
  retryMissedButton.className = 'button button--primary';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--secondary';
  againButton.textContent = 'New round';

  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'button button--secondary';
  doneButton.textContent = 'Done';

  summaryActions.append(retryMissedButton, againButton, doneButton);
  summary.append(summaryScore, summaryText, missedHeading, missedList, summaryActions);

  const round = document.createElement('div');
  round.className = 'quiz__round';
  round.append(bar, head, card, options, revealButton, grade, feedback, shortcuts);

  panel.append(round, summary);

  return {
    panel, round, bar, barFill, title, count, exitButton,
    card, prompt, front, hint,
    options, revealButton, grade, missButton, knewButton,
    feedback, verdict, detail, continueButton, shortcuts,
    summary, summaryScore, summaryText, missedHeading, missedList,
    retryMissedButton, againButton, doneButton,
  };
}

/* -- Session ------------------------------------------------------------------------------- */

/**
 * Builds a quiz panel and returns a handle to it.
 *
 * - `onGrade`     fires after every answer, so the view behind the quiz can
 *                 refresh whatever it shows about progress.
 * - `onFinish`    fires once a round ends, with what happened, so the caller
 *                 can log the session however it logs sessions.
 * - `onNewRound`  supplies the next round's items. The caller owns what a
 *                 round contains — Review draws from the schedule, a lesson
 *                 quiz just reshuffles its own words — so the quiz asks
 *                 rather than guessing.
 * - `onExit`      fires when the reader leaves the quiz entirely.
 * - `isActive`    guards the keyboard shortcuts, so they never fire while
 *                 another view is on screen.
 */
function createQuiz({
  onGrade = () => {},
  onFinish = () => {},
  onNewRound = null,
  onExit = () => {},
  isActive = () => true,
} = {}) {
  const el = buildPanel();

  const state = {
    mode: 'choose',
    queue: [],
    pool: [],
    index: 0,
    correct: 0,
    missed: [],
    answered: false,
    title: '',
  };

  /* -- Rendering ------------------------------------------------------------------------ */

  function setProgress() {
    const total = state.queue.length;
    const done = state.index;
    el.barFill.style.setProperty('--progress', total === 0 ? '0' : (done / total).toFixed(3));
    el.count.textContent = `${Math.min(done + 1, total)} of ${total} · ${state.correct} correct`;
  }

  function currentItem() {
    return state.queue[state.index];
  }

  function renderOptions(item) {
    el.options.replaceChildren();

    const choices = buildChoices(item, state.pool);

    choices.forEach((choice, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz__option';
      button.dataset.correct = String(choice.correct);

      const key = document.createElement('span');
      key.className = 'quiz__option-key';
      key.textContent = String(i + 1);
      key.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = 'quiz__option-text';
      text.textContent = choice.text;

      button.append(key, text);
      button.addEventListener('click', () => answer(choice.correct, button));
      el.options.append(button);
    });
  }

  function renderCard() {
    const item = currentItem();
    const adapter = adapterFor(item);
    state.answered = false;

    el.prompt.textContent = state.mode === 'choose' ? adapter.question : 'Үүнийг мэдэх үү?';
    el.front.replaceChildren(adapter.front(item));

    const hintText = adapter.hint(item);
    el.hint.textContent = hintText;
    el.hint.hidden = !hintText;

    el.feedback.hidden = true;
    el.detail.replaceChildren();
    el.card.classList.remove('is-correct', 'is-incorrect');

    if (state.mode === 'choose') {
      renderOptions(item);
      el.options.hidden = false;
      el.revealButton.hidden = true;
      el.grade.hidden = true;
      el.shortcuts.textContent = '1–4 дарж хариулна уу';
    } else {
      el.options.hidden = true;
      el.revealButton.hidden = false;
      el.grade.hidden = true;
      el.shortcuts.textContent = 'Space дарж харуулна · 1 сурч байна · 2 мэдсэн';
    }

    setProgress();

    // Restart the entrance animation: the class has to come off for a frame
    // before it can take effect again.
    el.card.classList.remove('is-entering');
    requestAnimationFrame(() => el.card.classList.add('is-entering'));
  }

  /* -- Answering ------------------------------------------------------------------------
     One path for both modes: a choose-mode click reports whether the chosen
     option was the right one, a flip-mode grade reports what the reader
     said about themselves. Everything after that — the schedule write, the
     feedback, the pacing — is the same.
     -------------------------------------------------------------------------------------- */

  function showFeedback(knewIt, record) {
    const item = currentItem();
    const adapter = adapterFor(item);

    el.card.classList.add(knewIt ? 'is-correct' : 'is-incorrect');

    /* The right answer is already highlighted among the options, so this
       line's job on a miss isn't to repeat it — it's to say plainly that
       the answer below is the one that was wanted, without the sting of
       "wrong". In Flip mode there are no options to highlight, so naming
       the meaning here is the only place it appears. */
    el.verdict.textContent = knewIt
      ? `Зөв · ${describeNextReview(record)}`
      : `Хариулт нь “${adapter.meaning(item)}” байлаа`;
    el.verdict.classList.toggle('is-correct', knewIt);
    el.verdict.classList.toggle('is-incorrect', !knewIt);

    const detail = adapter.detail(item);
    el.detail.replaceChildren(...(detail ? [detail] : []));

    el.feedback.hidden = false;

    /* A right answer moves on by itself — being made to confirm something
       you already got right is the friction that makes a quiz feel slow.
       A wrong one waits: that's the moment there's something to read, and
       taking it away after 650ms would be taking away the only part of the
       round that teaches. */
    if (knewIt) {
      el.continueButton.hidden = true;
      window.setTimeout(() => {
        if (state.answered && !el.panel.hidden) advance();
      }, CORRECT_PAUSE_MS);
    } else {
      el.continueButton.hidden = false;
      el.continueButton.focus();
    }
  }

  function answer(knewIt, chosenButton) {
    if (state.answered) return;
    state.answered = true;

    const item = currentItem();
    const record = gradeItem(item.id, knewIt);

    if (knewIt) {
      state.correct += 1;
    } else {
      state.missed.push(item);
    }

    if (state.mode === 'choose') {
      for (const button of el.options.children) {
        button.disabled = true;
        const isAnswer = button.dataset.correct === 'true';
        // The right answer is always marked, not just the one that was
        // picked — a wrong guess should end with the reader having seen
        // which one it should have been.
        if (isAnswer) button.classList.add('is-answer');
        if (button === chosenButton && !isAnswer) button.classList.add('is-wrong');
      }
    } else {
      el.grade.hidden = true;
      el.revealButton.hidden = true;
    }

    setProgress();
    onGrade();
    showFeedback(knewIt, record);
  }

  function advance() {
    state.index += 1;
    if (state.index >= state.queue.length) {
      finish();
    } else {
      renderCard();
    }
  }

  /* -- Summary --------------------------------------------------------------------------- */

  function finish() {
    const total = state.queue.length;
    onFinish({ total, correct: state.correct, missed: state.missed.slice(), mode: state.mode });

    el.barFill.style.setProperty('--progress', '1');
    el.summaryScore.textContent = `${state.correct} / ${total}`;
    el.summaryScore.classList.toggle('is-perfect', total > 0 && state.missed.length === 0);

    const pct = total === 0 ? 0 : Math.round((state.correct / total) * 100);
    el.summaryText.textContent = state.missed.length === 0
      ? 'Бүгд зөв. Энэ давталтаас үлдсэн юм алга.'
      : `Энэ давталтад ${pct}%. Доорх зүйлс бусдаасаа эрт эргэж ирнэ.`;

    el.missedList.replaceChildren();
    for (const item of state.missed) {
      const adapter = adapterFor(item);
      const row = document.createElement('li');
      row.className = 'quiz__missed-item';

      const front = document.createElement('span');
      front.className = 'quiz__missed-front';
      front.append(adapter.front(item));

      const meaning = document.createElement('span');
      meaning.className = 'quiz__missed-meaning meta';
      meaning.textContent = adapter.meaning(item);

      row.append(front, meaning);
      el.missedList.append(row);
    }

    const hasMissed = state.missed.length > 0;
    el.missedHeading.hidden = !hasMissed;
    el.missedList.hidden = !hasMissed;
    el.retryMissedButton.hidden = !hasMissed;
    el.retryMissedButton.textContent =
      `Practise the ${state.missed.length} you missed`;

    el.round.hidden = true;
    el.summary.hidden = false;
    el.summary.focus?.();
  }

  /* -- Lifecycle ------------------------------------------------------------------------- */

  function run(items, { mode = state.mode, pool = items, title = state.title } = {}) {
    state.mode = mode;
    state.queue = items;
    state.pool = pool.length >= CHOICE_COUNT ? pool : items;
    state.index = 0;
    state.correct = 0;
    state.missed = [];
    state.title = title;

    el.title.textContent = title;
    el.title.hidden = !title;
    el.panel.hidden = false;
    el.summary.hidden = true;
    el.round.hidden = false;

    renderCard();
  }

  function close() {
    el.panel.hidden = true;
    onExit();
  }

  el.revealButton.addEventListener('click', () => {
    el.revealButton.hidden = true;
    el.grade.hidden = false;
    el.missButton.focus();
  });

  el.missButton.addEventListener('click', () => answer(false, null));
  el.knewButton.addEventListener('click', () => answer(true, null));
  el.continueButton.addEventListener('click', advance);

  // Ending a round early still counts what was graded: the schedule already
  // has those answers, and reporting a 3/10 for a round stopped after three
  // questions would punish stopping. Leaving before answering anything is
  // just leaving — a "0 / 0" summary reports nothing and asks for a click
  // to dismiss it.
  el.exitButton.addEventListener('click', () => {
    const graded = state.index + (state.answered ? 1 : 0);
    if (graded === 0) {
      close();
      return;
    }
    state.queue = state.queue.slice(0, graded);
    finish();
  });

  el.againButton.addEventListener('click', () => {
    const next = onNewRound ? onNewRound() : shuffled(state.pool).slice(0, state.queue.length || 10);
    if (!next || next.length === 0) {
      close();
      return;
    }
    run(next, { pool: state.pool, title: state.title });
  });

  el.retryMissedButton.addEventListener('click', () => run(shuffled(state.missed), {
    pool: state.pool,
    title: state.title,
  }));

  el.doneButton.addEventListener('click', close);

  /* Keyboard: 1–4 answer in Choose, Space reveals and 1/2 grade in Flip,
     Enter continues past a wrong answer. Guarded by isActive() so the keys
     never fire while another view is on screen. */
  function handleKeydown(event) {
    if (event.repeat) return;
    if (el.panel.hidden || !el.summary.hidden) return;
    if (!isActive()) return;
    if (event.target.matches('input, textarea')) return;

    if (state.answered) {
      if (event.key === 'Enter' && !el.continueButton.hidden) {
        event.preventDefault();
        advance();
      }
      return;
    }

    if (state.mode === 'choose') {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < el.options.children.length) {
        event.preventDefault();
        el.options.children[index].click();
      }
      return;
    }

    if (el.grade.hidden) {
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        el.revealButton.click();
      }
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      el.missButton.click();
    } else if (event.key === '2') {
      event.preventDefault();
      el.knewButton.click();
    }
  }

  document.addEventListener('keydown', handleKeydown);

  return {
    element: el.panel,
    run,
    close,
    get missedCount() { return state.missed.length; },
  };
}

/* -- Mode picker -------------------------------------------------------------------------
   The row of study modes shown before a round starts. Lives here rather
   than in each caller so Review and Lessons offer the same two modes with
   the same labels and the same explanation underneath.
   -------------------------------------------------------------------------------------------- */

/* Both the Review view and the Lessons view build one of these, and both
   live in the document at once (views are hidden, not removed). The label's
   id has to be unique per instance or the second group's aria-labelledby
   points at the first one's label — and duplicate ids are invalid markup
   regardless of who notices. */
let modePickerCount = 0;

function createModePicker(initialMode, onChange) {
  const labelId = `quiz-mode-label-${(modePickerCount += 1)}`;

  const wrap = document.createElement('div');
  wrap.className = 'quiz-modes';

  const label = document.createElement('p');
  label.className = 'quiz-modes__label';
  label.id = labelId;
  label.textContent = 'Хэрхэн сурмаар байна?';

  const group = document.createElement('div');
  group.className = 'quiz-modes__group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', labelId);

  const hint = document.createElement('p');
  hint.className = 'quiz-modes__hint meta';

  let current = MODES.some((m) => m.id === initialMode) ? initialMode : 'choose';

  const buttons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip quiz-modes__button';
    button.dataset.mode = mode.id;
    button.textContent = mode.label;
    button.addEventListener('click', () => {
      current = mode.id;
      sync();
      onChange(mode.id);
    });
    group.append(button);
    return button;
  });

  function sync() {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === current));
    }
    hint.textContent = MODES.find((mode) => mode.id === current).hint;
  }

  sync();
  wrap.append(label, group, hint);

  return { wrap, get mode() { return current; } };
}

export { createQuiz, createModePicker, ADAPTERS, MODES, deckKeyForItemId, adapterFor };
