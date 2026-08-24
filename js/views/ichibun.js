/* ==========================================================================
   ichibun.js
   一文 — the door Japanese comes in through.

   Everything else in Bigu is a closed set: 816 words, 132 kanji, 14 grammar
   points, two passages. All of it curated, all of it already inside. A line
   from a drama, a sign in a game, something a friend wrote — none of that
   could get in, and that is the gap between an app you study with and a place
   you take things to.

   Paste, look up, keep. That is the whole view.

   CHARACTER LEVEL, ON PURPOSE. This does not segment words, and it is not a
   simplification to be improved later: proper Japanese morphological analysis
   needs a dictionary and a tokenizer, which is a dependency this app does not
   have and will not grow for one view. Splitting on characters is honest about
   what it knows — every character is a thing you can point at, and for kanji,
   which is what a learner actually stops on, a character *is* the unit. A
   half-working segmenter that splits 食べられない wrong would be worse than
   not claiming to segment at all.

   NO TRANSLATION, NO FURIGANA, NO NETWORK. Nothing here generates readings for
   a word it was not given, and nothing here calls out. The app can explain a
   character when data/kanji.json holds it and says so plainly when it does
   not.
   ========================================================================== */

import {
  createStorageNotice,
  getViewContainer,
  loadIntoView,
  OFFLINE_HINT,
} from '../ui/content.js';
import { loadKanji } from '../data/catalogue.js';
import { sentences as sentenceStore, isAvailable as isStorageAvailable } from '../core/storage.js';

const VIEW_ID = 'ichibun';

/* The list is capped so a reader who keeps a line a day for three years still
   has a view that renders in one frame and a storage key that fits. Oldest
   out first — the newest sentence is the one being worked on. */
const KEEP_LIMIT = 50;

/* Characters that are never worth a lookup and never worth a tap target: the
   spaces and line breaks that hold the text's own shape. Everything else is
   tappable, including kana and punctuation, because "this one is not in the
   book" is a real answer to a real question. */
function isBlank(char) {
  return /\s/u.test(char);
}

/* -- Reader ------------------------------------------------------------------- */

/* One control per character, laid out as running text rather than as a grid.
   `white-space: pre-wrap` on the container plus the newlines kept as their own
   text nodes is what preserves the shape of what was pasted — a three-line
   song lyric stays three lines.

   SPANS, NOT BUTTONS, AND MEASURED RATHER THAN ASSUMED. This was one <button>
   per character first, which is the semantically obvious build. Blink refuses
   to honour `display: inline` on a button — it computes inline-block whatever
   the cascade says — and a line of inline-block boxes is not a line of text as
   far as line breaking is concerned. Laying the same sentence out three ways in
   the same box at 360px:

     plain text  …大きな本 / 屋へ…買い / ました。そして、「これはいい本 / だ」と思いました。
     buttons     …大きな本 / 屋へ…買い / ました。そして、「これはいい本だ / 」と思いました。
     spans       identical to plain text

   The button version puts 」 at the head of a line, which Japanese line
   breaking does not do, and which is exactly the kind of wrongness this view
   exists to avoid: the reason to paste a sentence in is that it is a sentence.
   A span carrying role="button" and tabindex="0" is inline, so the browser
   breaks the concatenated text the way it breaks prose.

   What that costs is activation, which a native button gets free: Enter and
   Space are bound below, and Space's default page-scroll suppressed. It is a
   real control either way — focusable, announced as a button, reachable by
   keyboard. A plain span with a delegated click would not be, and that is a
   different trade this does not make. */
function createReader(text, onPick) {
  const wrap = document.createElement('p');
  wrap.className = 'ichibun__text';
  wrap.lang = 'ja';

  for (const char of text) {
    if (isBlank(char)) {
      wrap.append(document.createTextNode(char));
      continue;
    }
    const cell = document.createElement('span');
    cell.className = 'ichibun__char';
    cell.setAttribute('role', 'button');
    cell.tabIndex = 0;
    cell.textContent = char;
    cell.addEventListener('click', () => onPick(char, cell));
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      /* Space on a focused span scrolls the page, which on a pasted paragraph
         means the character you just chose leaves the screen. */
      event.preventDefault();
      onPick(char, cell);
    });
    wrap.append(cell);
  }

  return wrap;
}

/* -- Entry panel --------------------------------------------------------------
   What the app knows about one character, or that it does not. Both cases are
   the same shape and the same weight — a lookup that comes back empty is an
   answer, not a failure, so it gets a quiet line and nothing that looks like an
   error.
   ----------------------------------------------------------------------------- */

function createEntryPanel() {
  const panel = document.createElement('div');
  panel.className = 'ichibun__entry';
  panel.hidden = true;
  /* Announced when it changes, because the thing that changed it was a tap
     several lines away and a reader using a screen reader has no reason to go
     looking for it. */
  panel.setAttribute('role', 'status');

  const head = document.createElement('p');
  head.className = 'ichibun__entry-char';
  head.lang = 'ja';

  const meaning = document.createElement('p');
  meaning.className = 'ichibun__entry-meaning';

  const readings = document.createElement('p');
  readings.className = 'ichibun__entry-readings reading';
  readings.lang = 'ja';

  const example = document.createElement('div');
  example.className = 'ichibun__entry-example';

  const exampleJp = document.createElement('p');
  exampleJp.lang = 'ja';

  const exampleMn = document.createElement('p');
  exampleMn.className = 'meta';

  example.append(exampleJp, exampleMn);

  const absent = document.createElement('p');
  absent.className = 'ichibun__entry-absent';

  panel.append(head, meaning, readings, example, absent);

  function show(char, entry) {
    panel.hidden = false;
    head.textContent = char;

    const known = Boolean(entry);
    meaning.hidden = !known;
    readings.hidden = !known;
    example.hidden = !known;
    absent.hidden = known;

    if (!known) {
      /* One line, no apology and no instruction. The dataset is 132 characters
         and most of what a reader pastes will not be in it; saying so plainly
         is the whole message. */
      absent.textContent = 'Энэ тэмдэгт багцад алга.';
      return;
    }

    meaning.textContent = entry.meaning;

    const parts = [];
    if (entry.onyomi) parts.push(entry.onyomi);
    if (entry.kunyomi) parts.push(entry.kunyomi);
    readings.textContent = parts.join(' ・ ');
    readings.hidden = parts.length === 0;

    if (entry.example) {
      exampleJp.textContent = entry.example.word ?? '';
      exampleMn.textContent = entry.example.mn ?? '';
      example.hidden = false;
    } else {
      example.hidden = true;
    }
  }

  function clear() {
    panel.hidden = true;
  }

  return { element: panel, show, clear };
}

/* -- View ---------------------------------------------------------------------- */

function renderIchibun(container, data) {
  const byCharacter = new Map(data.kanji.map((entry) => [entry.character, entry]));

  const wrap = document.createElement('div');
  wrap.className = 'ichibun';

  /* -- Paste ----------------------------------------------------------------- */

  const form = document.createElement('form');
  form.className = 'ichibun__form';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = 'ichibun-input';
  label.textContent = 'Япон текст';

  const input = document.createElement('textarea');
  input.id = 'ichibun-input';
  input.className = 'field ichibun__input';
  input.rows = 3;
  input.placeholder = 'Хаанаас ч олсон япон өгүүлбэрээ энд буулгана уу.';

  const actions = document.createElement('div');
  actions.className = 'ichibun__actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'button button--primary';
  submit.textContent = 'Задлах';

  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'button button--secondary';
  keep.textContent = 'Хадгалах';
  keep.hidden = true;

  actions.append(submit, keep);
  form.append(label, input, actions);

  /* -- What the app can explain ---------------------------------------------
     The signal worth having: which characters in this text the dataset holds.
     Characters, not a fraction — a percentage would turn "here is what I can
     help with" into a mark out of ten for a sentence the reader did not write. */

  const found = document.createElement('div');
  found.className = 'ichibun__found';
  found.hidden = true;

  const foundLabel = document.createElement('p');
  foundLabel.className = 'ichibun__found-label';

  const foundList = document.createElement('div');
  foundList.className = 'ichibun__found-list';

  found.append(foundLabel, foundList);

  /* -- The text, and what one character in it means -------------------------- */

  const reader = document.createElement('div');
  reader.className = 'ichibun__reader';
  reader.hidden = true;

  const entry = createEntryPanel();

  /* -- Kept sentences -------------------------------------------------------- */

  const keptSection = document.createElement('section');
  keptSection.className = 'ichibun__kept';
  keptSection.hidden = true;

  const keptHeading = document.createElement('h2');
  keptHeading.className = 'ichibun__kept-heading';
  keptHeading.textContent = 'Хадгалсан өгүүлбэрүүд';

  const keptList = document.createElement('ul');
  keptList.className = 'ichibun__kept-list';

  keptSection.append(keptHeading, keptList);

  wrap.append(form, found, reader, entry.element, keptSection);
  if (!isStorageAvailable()) wrap.append(createStorageNotice());

  /* -- Behaviour ------------------------------------------------------------- */

  let current = '';

  function pick(char, button) {
    for (const el of wrap.querySelectorAll('.ichibun__char.is-picked')) {
      el.classList.remove('is-picked');
    }
    if (button) button.classList.add('is-picked');
    entry.show(char, byCharacter.get(char) ?? null);
  }

  function analyse(text) {
    current = text;
    entry.clear();

    reader.replaceChildren(createReader(text, pick));
    reader.hidden = false;
    keep.hidden = false;

    /* In order of first appearance and deduplicated, so a sentence that uses
       日 three times lists it once and the row reads as a set rather than as a
       transcript. */
    const seen = new Set();
    const hits = [];
    for (const char of text) {
      if (seen.has(char)) continue;
      seen.add(char);
      if (byCharacter.has(char)) hits.push(char);
    }

    foundList.replaceChildren();
    if (hits.length === 0) {
      foundLabel.textContent = 'Энэ өгүүлбэрээс багцад байгаа ханз олдсонгүй.';
    } else {
      foundLabel.textContent = 'Багцад байгаа ханзууд:';
      for (const char of hits) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ichibun__found-chip';
        chip.lang = 'ja';
        chip.textContent = char;
        chip.addEventListener('click', () => pick(char, null));
        foundList.append(chip);
      }
    }
    found.hidden = false;
  }

  function renderKept() {
    const all = sentenceStore.getAll();
    keptList.replaceChildren();

    for (const record of [...all].reverse()) {
      const item = document.createElement('li');
      item.className = 'ichibun__kept-item';

      /* The sentence itself is the way back into it: pressing it loads the
         line into the reader above, which is what a reader kept it for. */
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'ichibun__kept-text';
      open.lang = 'ja';
      open.textContent = record.text;
      open.addEventListener('click', () => {
        input.value = record.text;
        analyse(record.text);
        reader.scrollIntoView({ block: 'nearest' });
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ichibun__kept-remove';
      remove.textContent = 'Хасах';
      remove.setAttribute('aria-label', `Хасах: ${record.text.slice(0, 24)}`);
      remove.addEventListener('click', () => {
        sentenceStore.remove(record.id);
        renderKept();
      });

      item.append(open, remove);
      keptList.append(item);
    }

    /* No count and no dates. What is here is a shelf of lines the reader liked
       enough to keep, and a shelf does not need to say how full it is. */
    keptSection.hidden = all.length === 0;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    analyse(text);
  });

  keep.addEventListener('click', () => {
    const text = current.trim();
    if (!text) return;

    const all = sentenceStore.getAll();
    /* Keeping the same line twice is a press the reader did not mean — the
       button does not know it has already been used on this text, so it checks
       rather than growing a duplicate. */
    if (!all.some((record) => record.text === text)) {
      sentenceStore.add({ text });

      /* Trim from the front, oldest first. Done after the add rather than
         before, so the cap is a property of what is stored and not of what can
         be stored — the newest line always lands. */
      const after = sentenceStore.getAll();
      if (after.length > KEEP_LIMIT) {
        for (const record of after.slice(0, after.length - KEEP_LIMIT)) {
          sentenceStore.remove(record.id);
        }
      }
    }
    renderKept();
  });

  container.replaceChildren(wrap);
  renderKept();
}

/* -- Init ---------------------------------------------------------------------- */

async function initIchibun() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'ichibun-content'), {
    skeleton: 'rows',
    load: loadKanji,
    render: renderIchibun,
    errorTitle: 'Ханзны багц ачаалагдсангүй.',
    errorDetail: `Тэмдэгтийн багц data/kanji.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initIchibun };
