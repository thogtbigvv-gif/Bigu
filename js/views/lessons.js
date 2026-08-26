/* ==========================================================================
   lessons.js
   Loads data/lessons.json and renders it as a browsable reference inside
   the #lessons view: one disclosure per lesson, opening onto a word list.
   Sits alongside vocabulary/grammar/kanji as reference material, not part
   of the practice deck.

   The file is the みんなの日本語 spine, 1 to 50, and it is longer than what
   has been written into it — the reader transcribes each lesson's words from
   their own copy of the book as they study it. A lesson with no words is a
   normal, permanent state of this view rather than a hole in the data, and
   isWritten() below is the single test every part of this file asks before it
   counts, labels, quizzes or chains a lesson.

   Each word has its own "Remember this" toggle, same shape and store as
   vocabulary/grammar/kanji's (review.js over storage.js's `progress` map,
   keyed by each word's `id`), so a lesson's progress survives a reload.
   Each lesson group also has its own "Quiz" button: a round scoped to that
   lesson's word list, shown in place of the list.

   The quiz is js/ui/quiz.js — the same panel, the same two study modes, and
   the same grading the Review deck uses, rather than the separate
   implementation that used to live here.

   That quiz grades into the shared schedule like every other grading
   surface. It deliberately didn't, once — it was kept as a separate
   quick-recall tool — but the result was that "in memory" meant two
   different things depending on which screen you were on: passing a word
   in the quiz left it unheld while tapping the mark beside it held it.
   One progress model is worth more than the separation was.
   ========================================================================== */

import { settings } from '../core/storage.js';
import { isRemembered, rememberedCount, setRemembered, shuffled, snapshotRecords } from '../study/review.js';
import { createQuiz, createModePicker } from '../ui/quiz.js';
/* practice.js imports this module's loadLessons for the review pool, so this
   pairing is a cycle. It is a safe one and deliberately not worked around:
   neither binding is touched while the modules evaluate — loadLessons runs
   when the pool is first built, recordSession when a round ends — and the
   alternative is lessons.js keeping a second copy of the logging path,
   which is the duplication this import exists to remove. */
import { recordSession } from '../study/session.js';
import { createIcon, getViewContainer, loadIntoView, OFFLINE_HINT } from '../ui/content.js';
import { createDoorRow, revealEntry } from '../ui/doors.js';
import { loadLessons, loadLinkIndex } from '../data/catalogue.js';
import { activeViewId, onRouteTarget } from '../core/router.js';

const VIEW_ID = 'lessons';

/* Shared with practice.js: how you like to study is one preference, not one
   per surface, so picking "Flip" in a lesson quiz is still "Flip" the next
   time you open the Review deck. */
const QUIZ_MODE_SETTING_KEY = 'quizMode';

/* -- Data ------------------------------------------------------------------------- */


/* -- Unwritten lessons ------------------------------------------------------------
   The spine runs 1 to 50 because that is how far みんなの日本語 runs, and the
   file is ahead of the reader: a lesson exists as a numbered place before
   anything has been written into it.

   That is a normal state, not a gap, and nothing in this view treats it as
   one. An unwritten lesson has no title, no word count, no quiz, and is never
   counted, never marked, never coloured. It is a number and a line saying
   there is nothing in it yet. The reader is the only person who can fill it —
   the words come out of a book they own, in their own words — so there is
   also no button here inviting them to, because a button would make an empty
   lesson a chore the app is waiting on rather than a page they have not
   reached.
   ---------------------------------------------------------------------------------- */

function isWritten(lesson) {
  return lesson.words.length > 0;
}

/* -- Progress ------------------------------------------------------------------------
   The shared schedule in review.js, same as every other view. Lesson word
   ids (l1-01, l1-02…) live in their own namespace, so they never collide
   with vocabulary/grammar/kanji's n3-/gr-/kj- ids in the same store — and
   practice.js routes that `l` prefix back to this module's card layout, so
   lesson words join the review pool instead of being a dead end.

   The header counts go through review.js's bulk rememberedCount() rather
   than a per-word isRemembered(): one graded card refreshes all fifteen
   groups, and the per-word form turned that into a few hundred full reads
   of the progress store between one card and the next.
   -------------------------------------------------------------------------------------- */

function countRemembered(words, records) {
  return rememberedCount(words, records);
}

/* -- Word rendering --------------------------------------------------------------------
   Furigana only where the word and reading actually differ (kanji terms);
   kana-only entries (アメリカ, ここ, いくら…) render as plain text, same
   rule vocabulary.js uses for words with no kanji field. Shared by the
   reference list (createWordRow). quiz.js's lessons adapter follows the
   same rule for the quiz card front, so a word reads identically in both
   places.
   -------------------------------------------------------------------------------------- */

function createHeadword(entry) {
  if (entry.word === entry.reading) {
    const span = document.createElement('span');
    span.lang = 'ja';
    span.textContent = entry.word;
    return span;
  }

  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = entry.reading;
  ruby.append(entry.word, rt);
  return ruby;
}

/* -- The per-word control -----------------------------------------------------------
   A lesson opens onto eighteen words, and every one of them used to carry a
   full-width "Remember this" chip. Eighteen identical buttons, each wider
   and heavier than the Japanese word above it, is a screen where the
   loudest thing repeated eighteen times is the *action* and the quietest is
   the vocabulary \u2014 exactly backwards for a page whose whole job is to let a
   reader read a lesson's words.

   Here it's a mark instead: an outlined circle that fills when the word is
   held. Same state, same store, same aria-pressed semantics as the chip on
   a vocabulary card \u2014 the label lives in .sr-only rather than on screen,
   because on this screen the row's meaning is carried by the word and the
   control only has to be reachable and legible at a glance. The full chip
   stays everywhere it is one of two or three things on a card.

   Returns its own sync() so the row can be refreshed from outside \u2014 the
   lesson quiz grades the same words this reflects, and coming back from a
   round with the marks showing the old state was the visible half of the
   two-meanings-of-"known" problem.
   ------------------------------------------------------------------------------------ */
function createProgressMark(entry, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lesson-word__mark';

  const icon = createIcon('lesson-word__mark-icon', [
    ['circle', { cx: '8', cy: '8', r: '5.5' }],
  ]);

  const label = document.createElement('span');
  label.className = 'sr-only';

  button.append(icon, label);

  const sync = () => {
    const remembered = isRemembered(entry.id);
    button.setAttribute('aria-pressed', String(remembered));
    label.textContent = remembered
      ? `${entry.word} is in memory \u2014 take it back out`
      : `Keep ${entry.word} in memory`;
  };

  button.addEventListener('click', () => {
    setRemembered(entry.id, !isRemembered(entry.id));
    sync();
    onChange();
  });

  sync();
  return { button, sync };
}

function createWordRow(entry, links, onProgressChange) {
  const item = document.createElement('li');
  item.className = 'lesson-word';
  /* The row's own id, so a link from elsewhere in the app can find it. A
     lesson word is the only entry in the catalogue whose screen does not
     list it until a disclosure is opened, which is why the address has to
     reach the row rather than the group. */
  item.dataset.wordId = entry.id;

  const { button, sync } = createProgressMark(entry, onProgressChange);

  const body = document.createElement('div');
  body.className = 'lesson-word__body';

  const head = document.createElement('div');
  head.className = 'lesson-word__head';
  head.append(createHeadword(entry));

  const meaning = document.createElement('p');
  meaning.className = 'lesson-word__meaning meta';
  meaning.textContent = entry.english;

  body.append(head, meaning);

  /* The kanji in the word, as doors. This is the door the lesson spine was
     missing: the words a reader is actually working through are here, in the
     order the book teaches them, and until now a character in one of them
     was a shape on the page with the app's own 132-entry kanji catalogue one
     screen away and no way to get there. */
  const doors = createKanjiDoors(entry, links);
  if (doors) body.append(doors);

  item.append(button, body);
  return { item, sync };
}

/* -- Lesson groups ---------------------------------------------------------------------
   Native disclosure pattern: a button toggling its own aria-expanded plus
   a sibling region, no external state store. First lesson opens by
   default so the view isn't a wall of 15 closed rows on first visit. The
   quiz trigger is a separate sibling button (not nested inside the
   disclosure button) so both stay independently clickable/focusable.

   A group's word rows are built the first time it opens, not when the view
   renders. Fifteen lessons of ~18 words each meant roughly 250 word rows
   and their controls were constructed on arrival, of which fourteen
   lessons' worth — around 93% — were inside collapsed regions the reader
   might never open. The same argument app.js already makes for views ("a
   view the reader never opens never builds its DOM"), one level down.
   -------------------------------------------------------------------------------------- */

/* Same row of doors the vocabulary and grammar cards carry, built off the
   same index. A lesson word's headword is under `word` rather than `kanji`;
   data/links.js reads either, so nothing here has to know that.

   THE CHARACTERS ALONE, WITH NO CAPTION AND NO MEANING UNDER THEM, which is
   where this row differs from the one on a vocabulary card. A card is a
   surface with room on it and carries three doors at most; a lesson is
   eighteen words in a three-column list, and the same row drawn the same way
   there put a "Kanji" caption and a line of Mongolian under every one of
   them — four times the height, eighteen identical captions, and a list
   nobody could scan any more. The lesson list is the app's most beginner-
   facing screen and its density is the thing that makes it usable.

   What the characters lose is a meaning the reader is one tap from anyway,
   and the row keeps the only job it has here: to say "these are the pieces,
   and each one goes somewhere". */
function createKanjiDoors(entry, links) {
  return createDoorRow({
    doors: links.kanjiIn(entry.word).map((match) => ({
      view: 'kanji',
      target: match.id,
      headword: match.character,
    })),
  });
}

function createLessonGroup(lesson, index, links, onQuiz) {
  const headerId = `lesson-${lesson.lesson}-header`;
  const bodyId = `lesson-${lesson.lesson}-body`;
  const written = isWritten(lesson);
  const expanded = index === 0;

  const li = document.createElement('li');
  li.className = 'card card--interactive lesson-group';
  if (!written) li.classList.add('lesson-group--unwritten');

  const heading = document.createElement('h2');
  heading.className = 'lesson-group__heading';

  const button = document.createElement('button');
  button.type = 'button';
  button.id = headerId;
  button.className = 'lesson-group__header';
  button.setAttribute('aria-controls', bodyId);

  /* Just the number when there is nothing written down. Not "26." with a dot
     left hanging where a title would go — the dot separates two things, and an
     unwritten lesson is one thing. */
  const title = document.createElement('span');
  title.className = 'lesson-group__title';
  title.textContent = written ? `${lesson.lesson}. ${lesson.title}` : String(lesson.lesson);

  const count = document.createElement('span');
  count.className = 'lesson-group__count meta';

  /* The word count stays — it is the size of the thing you are about to open,
     which is worth knowing before you open it. What goes is the "· 0 санах
     ойд" half on a lesson nobody has touched: eighteen rows each reporting a
     zero is the "0/802" shape, a progress bar drawn in text, and it is on the
     one screen a reader sees before they have done anything at all. Once
     there is something held, saying so is a report rather than a scoreboard.

     An unwritten lesson reports nothing at all, one step further on for the
     same reason: "0 үг" is the size of a thing that is not there, and a column
     of thirty-five zeroes down the back half of the list would read as
     thirty-five failures rather than thirty-five pages not yet reached. */
  const updateCount = (records) => {
    if (!written) return;
    const remembered = countRemembered(lesson.words, records);
    count.textContent = remembered > 0
      ? `${lesson.words.length} үг \u00b7 ${remembered} санах ойд`
      : `${lesson.words.length} үг`;
  };
  updateCount();

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'lesson-group__icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  iconPath.setAttribute('d', 'M6 9l6 6 6-6');
  icon.append(iconPath);

  button.append(title, count, icon);

  heading.append(button);

  /* No Quiz button on a lesson with no words. Not a disabled one — a round of
     nothing is not a round, and a control that cannot do its job is worse than
     no control. It appears by itself the moment the lesson has words in it. */
  if (written) {
    const quizButton = document.createElement('button');
    quizButton.type = 'button';
    quizButton.className = 'button button--secondary lesson-group__quiz-button';
    quizButton.textContent = 'Quiz';
    quizButton.setAttribute('aria-label', `Quiz lesson ${lesson.lesson}: ${lesson.title}`);
    quizButton.addEventListener('click', () => onQuiz(lesson));
    heading.append(quizButton);
  }

  const body = document.createElement('div');
  body.id = bodyId;
  body.className = 'lesson-group__body';
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', headerId);

  /* An unwritten lesson opens onto one line, in the register the rest of the
     app uses when a surface has nothing on it. It says the words are not
     written down yet and stops there: no "coming soon", because nothing is
     coming on its own — the reader is the one who writes it, out of a book
     they own — and nothing to press, because an empty lesson is a page not yet
     reached rather than a chore the app is waiting on.

     Built here rather than in buildRows: the laziness below exists to avoid
     constructing a few hundred word rows nobody opened, and one paragraph is
     not worth deferring. */
  const list = document.createElement('ul');
  list.className = 'lesson-word-list';

  if (written) {
    body.append(list);
  } else {
    const note = document.createElement('p');
    note.className = 'empty-state';
    note.textContent = 'Энэ хичээлийн үгсийг хараахан тэмдэглээгүй байна.';
    body.append(note);
  }

  let rows = null;

  function buildRows() {
    if (rows) return;
    rows = lesson.words.map((entry) => createWordRow(entry, links, updateCount));
    list.append(...rows.map((row) => row.item));
  }

  function setExpanded(next) {
    if (next) buildRows();
    button.setAttribute('aria-expanded', String(next));
    body.hidden = !next;
  }

  button.addEventListener('click', () => {
    setExpanded(button.getAttribute('aria-expanded') !== 'true');
  });

  setExpanded(expanded);

  li.append(heading, body);

  return {
    element: li,
    lesson,

    /* Open this group and hand back the row for one word, building the rows
       if this is the first time the group has been opened. A deep link is
       the one caller: everything else here opens a group because the reader
       pressed its header.

       Returns null for a word this lesson does not hold, which keeps the
       caller's search honest — it asks each group in turn rather than
       trusting an id's prefix to name a lesson. */
    reveal(wordId) {
      setExpanded(true);
      return list.querySelector(`[data-word-id="${wordId}"]`);
    },

    // Only what's on screen needs re-syncing; a group that has never been
    // opened has no marks to correct, and will read the store when it does
    // open. The count in the header always refreshes, because that is
    // visible whether the group is open or not.
    //
    // `records` is optional: a caller refreshing every group at once passes
    // one snapshot in, and a single word's own mark calls it with nothing
    // and lets updateCount read the store itself.
    refresh(records) {
      updateCount(records);
      if (rows) for (const row of rows) row.sync();
    },
  };
}

/* -- Quiz --------------------------------------------------------------------------------
   One lesson at a time, run by the shared quiz in js/ui/quiz.js — the same
   panel, the same two study modes, and the same grading the Review deck
   uses. This module used to carry its own reveal/grade/summary
   implementation, near-identical to practice.js's, which is most of why
   the two quizzes felt like different features.

   The quiz's default "Choose" mode matters most here: Lessons is the
   beginner surface, and asking someone to honestly self-grade a word they
   met a minute ago is asking for a number that means nothing. Four answers
   and instant checking asks something they can actually answer.
   -------------------------------------------------------------------------------------- */

/* -- Rendering ------------------------------------------------------------------------- */

function renderLessons(container, { lessons, links }) {
  const wordCount = lessons.reduce((sum, lesson) => sum + lesson.words.length, 0);

  const intro = document.createElement('div');
  intro.className = 'lessons-intro';

  const count = document.createElement('p');
  count.className = 'lessons-meta meta';
  /* The word total, not just the lesson count. "50 lessons" says nothing about
     the size of the commitment; the two numbers together are what a reader
     deciding whether to start actually wants.

     Both are descriptions, not scores. The lesson count is the spine — 50,
     matching both the book and the rows on screen, so it can be checked
     against what is visible. The word total counts what is written down, which
     is the smaller number, and the two are deliberately not shown as a
     fraction: "15 of 50 written" is a completion figure, and how much of the
     book has been transcribed is not something this screen has an opinion
     about. */
  count.textContent = `${lessons.length} хичээл \u00b7 ${wordCount} үг`;

  const list = document.createElement('ul');
  list.className = 'lessons-list';

  const groups = [];

  /* The mode picker sits above the lesson list rather than inside each
     lesson: it's a preference about how you like to study, not a property
     of lesson 7, and asking once is one question instead of fifteen. */
  const modePicker = createModePicker(settings.get(QUIZ_MODE_SETTING_KEY), (mode) => {
    settings.set(QUIZ_MODE_SETTING_KEY, mode);
  });

  intro.append(count, modePicker.wrap);

  // The lesson the current round came from, so "Дахин давтах" reshuffles the
  // same one rather than falling back to the quiz's generic reshuffle, and
  // so the ending knows which lesson comes after this one.
  let activeLesson = null;

  /* Starting a round, in one place. It was inline in the group callback and
     is lifted out because the ending needs it too: finishing lesson seven
     offers lesson eight, and "offers" has to mean the same thing as pressing
     lesson eight's own Quiz button — same panel, same mode, same pool —
     rather than a second slightly different path into a round. */
  function runLesson(lesson) {
    activeLesson = lesson;
    intro.hidden = true;
    list.hidden = true;
    quiz.run(shuffled(lesson.words), {
      mode: modePicker.mode,
      pool: lesson.words,
      title: `${lesson.lesson}. ${lesson.title}`,
    });
  }

  const quiz = createQuiz({
    isActive: () => activeViewId() === VIEW_ID,
    // A round changes the same records the lesson rows display, so the list
    // behind the panel is brought back into agreement as it happens rather
    // than being left showing what was true before the round.
    onGrade() {
      // One snapshot for all fifteen groups. This fires after every card,
      // and each group's count walks its own word list — read per word, that
      // is a few hundred parses of the progress store per graded card.
      const records = snapshotRecords();
      for (const group of groups) group.refresh(records);
    },
    /* Logged through practice.js's recordSession, tagged `lessons`. A lesson
       round grades into the shared schedule like every other surface, but it
       was the one that left no trace of having happened — the Dashboard's
       "Last review" card and the Review view's recent list both read the
       practice store, so a reader who only ever quizzed from Lessons was
       told they had never reviewed. Going through the shared path rather
       than writing the store directly is what keeps that true as the path
       grows: it now also publishes the round to the bridge and redraws the
       bridge's status, and a private copy here would have quietly stopped
       short of both.

       `lesson.quiz` rather than `review.session` is the only difference from
       a round started in Review — same store, same schedule, same shape on
       the bridge — because on the other side "you finished lesson seven" and
       "you did your reviews" are worth telling apart. A round ended early
       still counts what was graded, same rule as practice.js. */
    onFinish({ total, correct }) {
      recordSession({ total, correct, mode: 'lessons', eventType: 'lesson.quiz' });
    },
    onNewRound: () => (activeLesson ? shuffled(activeLesson.words) : null),
    /* The one place in the app where "what comes next" is a fact rather
       than a suggestion: lessons are an ordered sequence, so the lesson
       after this one is real linkage and not a recommendation. The last
       lesson has nothing after it and says so by offering nothing.

       "The next lesson" means the next one with words in it, not the next
       number. Offering lesson 16 to someone who has just finished 15 would
       hand them an empty round, and the sequence runs to 50 while what is
       written down stops earlier — so the end of the written lessons is the
       end of the chain, and it ends by offering nothing, exactly as the end
       of the book always did. */
    onNextStep() {
      const at = lessons.indexOf(activeLesson);
      const next = at === -1 ? null : lessons.slice(at + 1).find(isWritten);
      return next ? { go: () => runLesson(next) } : null;
    },
    onExit() {
      activeLesson = null;
      intro.hidden = false;
      list.hidden = false;
    },
  });

  groups.push(
    ...lessons.map((lesson, index) => createLessonGroup(lesson, index, links, runLesson)),
  );

  list.append(...groups.map((group) => group.element));

  container.replaceChildren(intro, list, quiz.element);

  /* Arriving from a door — a kanji screen sending the reader to a word in
     the book, or a bookmarked `#lessons/l7-12`.

     Two states have to be undone first, and both are states this view is
     normally right to be in. A round in progress hides the whole list, so it
     is closed the same way the reader would close it, through the quiz's own
     exit rather than by un-hiding things behind its back. And the word's
     group is almost certainly collapsed — only the first opens by default —
     so it is opened, which is also what builds its rows.

     A word no lesson holds leaves the screen exactly as it was: an old
     bookmark or a retired id, and the lesson list is the right answer to it. */
  onRouteTarget(VIEW_ID, (wordId) => {
    const group = groups.find((candidate) => candidate.lesson.words.some((word) => word.id === wordId));
    if (!group) return;

    if (list.hidden) quiz.close();

    const element = group.reveal(wordId);
    if (element) revealEntry(element);
  });
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initLessons() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'lessons-content'), {
    skeleton: 'rows',
    /* Two things, where every other view loads one: lessons.json is a bare
       array rather than a `{ updatedAt, … }` object, so there is nothing to
       spread the index into and the pair is named instead. The index never
       rejects (catalogue.js), so a missing kanji.json costs the word rows
       their doors and nothing else. */
    load: async () => {
      const [lessons, links] = await Promise.all([loadLessons(), loadLinkIndex()]);
      return { lessons, links };
    },
    render: renderLessons,
    errorTitle: 'Lessons ачаалагдсангүй.',
    errorDetail: `Хичээлийн жагсаалт data/lessons.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initLessons };
