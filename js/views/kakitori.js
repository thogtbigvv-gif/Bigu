/* ==========================================================================
   kakitori.js
   書き取り — the first surface in Bigu the reader makes something on.

   Every other view in this app is read: a list to scan, a card to turn, a
   passage to sit with. This one is a sheet of practice paper and a brush. The
   character is named — its readings, what it means — and not shown, because
   the whole exercise is whether it comes back to the hand.

   WHAT IT DOES NOT DO, and cannot. data/kanji.json holds a character, a level,
   a meaning, two readings, an example and some related characters. It holds no
   stroke-order data at all, so this view cannot check a stroke, cannot count
   them, and cannot tell a good 書 from a bad one. It does not pretend to. There
   is no score, no correctness, no "try again", and the reveal is the reader
   comparing their own sheet against the printed character — which is what a
   person with a 漢字ドリル and a pencil does anyway.

   It writes nothing. No progress record, no SRS grade, no storage key. The one
   thing it counts is how many characters this sitting has been through, held
   in a variable and gone on reload, and it says so without a target beside it.

   STROKES ARE POINTS, NOT PIXELS. Every stroke is kept as an array of
   normalised coordinates and the canvas is redrawn from that list. Undo is
   then `strokes.pop()` and redraw, rather than the alternative — snapshotting
   the bitmap before every stroke, which costs a full-canvas copy per stroke
   and breaks the moment the canvas is resized. Normalised rather than pixel
   coordinates for the same reason: a phone rotating, or a window resizing,
   re-lays the sheet out at a new size and the strokes have to land in the same
   place on it.
   ========================================================================== */

import {
  collectFacets,
  createFacetChips,
  describeLevelSpan,
  getViewContainer,
  levelBucketOf,
  loadIntoView,
  JLPT_LEVELS,
  NO_LEVEL,
  OFFLINE_HINT,
} from '../ui/content.js';
import { loadKanji } from '../data/catalogue.js';
import { snapshotRecords } from '../study/review.js';

const VIEW_ID = 'kakitori';

/* The brush. 7 CSS pixels at the sheet's logical size — a stroke thick enough
   to read as ink rather than as a diagram, thin enough that two strokes
   crossing in a dense character stay two strokes. */
const STROKE_WIDTH = 7;

/* What a pen's pressure is allowed to do to that width, as a multiplier. A
   real brush is not a slider from nothing to everything: a light touch still
   leaves a line and a hard one does not blot, so the range is narrow and
   centred on the width above — at half pressure the stroke is exactly
   STROKE_WIDTH and the two ends of the range are a little either side of it.
   Wide enough that a 払い tapers and a 止め does not; narrow enough that the
   crossing-strokes argument above still holds at the thick end. */
const PRESSURE_MIN = 0.55;
const PRESSURE_MAX = 1.5;

/* Only a pen reports force. A mouse says 0.5 whenever a button is down and a
   finger without force sensing says 0 or 0.5 — neither is a measurement, and
   deriving a width from velocity instead would be the app inventing a
   pressure the device never gave it. So this returns null for everything but
   a stylus, and the sheet draws its one honest width for the rest, which is
   what it has always drawn.

   `pressure === 0` from a pen is a pen that is down but reporting nothing
   yet, not a pen pressed with no force; treating it as zero width would open
   every stylus stroke with an invisible segment. */
function pressureOf(event) {
  if (event.pointerType !== 'pen') return null;
  const force = event.pressure;
  if (typeof force !== 'number' || force <= 0) return null;
  return PRESSURE_MIN + (PRESSURE_MAX - PRESSURE_MIN) * Math.min(force, 1);
}

/* Characters drawn this sitting. Module scope, deliberately: it is a fact
   about the last twenty minutes, not about the reader, and a number this view
   is allowed to forget. */
let drawnCount = 0;

const LEVEL_ORDER = [...JLPT_LEVELS, NO_LEVEL];

function getEntryLevel(entry) {
  return entry.level ?? null;
}

/* -- The sheet ----------------------------------------------------------------
   One canvas, its 2D context, and the list of strokes on it. Everything about
   drawing lives in here so the view around it only has to say "undo" or
   "clear" and never touches a pixel.
   ----------------------------------------------------------------------------- */

function createSheet() {
  const canvas = document.createElement('canvas');
  canvas.className = 'kakitori__canvas';
  /* Named for what it is rather than left as an unlabelled graphic. A canvas
     with no role is invisible to a screen reader; `img` with a label at least
     says a drawing surface is here and what it is for. */
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Бичих хуудас');

  const ctx = canvas.getContext('2d');

  /* Each stroke is an array of {x, y} in 0..1 of the sheet's width and height.
     `live` is the one currently under the pointer. */
  const strokes = [];
  let live = null;

  /* Colours come from the stylesheet rather than from a literal here, read
     fresh on every redraw. That is what makes the sheet follow the theme: a
     reader who switches to dark mid-character gets their strokes repainted in
     the night palette's ink on the next frame, from the same tokens the rest
     of the app uses. */
  function tokens() {
    const style = getComputedStyle(canvas);
    return {
      ink: style.getPropertyValue('--color-sumi').trim(),
      guide: style.getPropertyValue('--color-line').trim(),
    };
  }

  function size() {
    const rect = canvas.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  /* Quarters, like the cross ruled on a page of practice paper — one vertical
     and one horizontal, no border of its own. The sheet's edge is drawn in CSS
     if it is drawn at all; a rectangle painted here would be ornament inside
     the drawing surface, and it would be the first thing the reader's own
     stroke had to compete with. */
  function drawGuides(w, h, guide) {
    ctx.save();
    ctx.strokeStyle = guide;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();
  }

  /* A point carries its own width where the device gave one. `p` is the
     pressure multiplier from pressureOf() and is null for a finger, a mouse
     and any pen that reports nothing — the overwhelming majority of strokes,
     which take the single width and the single path they always took. */
  function widthAt(point) {
    return point.p == null ? STROKE_WIDTH : STROKE_WIDTH * point.p;
  }

  function drawStroke(points, w, h) {
    if (!points.length) return;

    if (points.length === 1) {
      /* A tap with no travel is still a mark — the dot a short stroke leaves.
         Without this the reader presses, lifts, and nothing appears. */
      ctx.beginPath();
      ctx.arc(points[0].x * w, points[0].y * h, widthAt(points[0]) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    /* One path for a stroke of one width, which is every stroke a finger or a
       mouse makes: the whole polyline in a single stroke() call, exactly as
       before. A pen's stroke changes width along its length and cannot be one
       path, so it is drawn segment by segment — each with its own lineWidth
       and its own round caps, which is what makes the joins between them read
       as one tapering line rather than as a row of dashes. The cost is one
       path per sample instead of one per stroke, and it is only ever paid by
       the input that asked for it. */
    if (points.every((point) => point.p == null)) {
      ctx.beginPath();
      ctx.moveTo(points[0].x * w, points[0].y * h);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x * w, points[i].y * h);
      }
      ctx.stroke();
      return;
    }

    for (let i = 1; i < points.length; i += 1) {
      const from = points[i - 1];
      const to = points[i];
      ctx.beginPath();
      /* The mean of the two ends, so a segment is the width the pen was at
         while it was drawn rather than the width it arrived at. */
      ctx.lineWidth = (widthAt(from) + widthAt(to)) / 2;
      ctx.moveTo(from.x * w, from.y * h);
      ctx.lineTo(to.x * w, to.y * h);
      ctx.stroke();
    }
    ctx.lineWidth = STROKE_WIDTH;
  }

  function redraw() {
    const { w, h } = size();
    if (!w || !h) return;
    const { ink, guide } = tokens();

    ctx.clearRect(0, 0, w, h);
    drawGuides(w, h, guide);

    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const stroke of strokes) drawStroke(stroke, w, h);
    if (live) drawStroke(live, w, h);
  }

  /* The backing store is the CSS size times the device pixel ratio, and the
     context is scaled by the same factor so every coordinate above can stay in
     CSS pixels. Without this a stroke on a 3x phone is drawn into a third of
     the pixels it covers and looks like it was traced with a wet finger. */
  function resize() {
    const { w, h } = size();
    if (!w || !h) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  }

  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      /* Kept with the coordinates for the same reason they are normalised: a
         stroke is redrawn from this list every frame and on every resize, so
         anything the sheet needs to draw it has to survive in the list. */
      p: pressureOf(event),
    };
  }

  /* One code path for mouse, trackpad, stylus and finger. setPointerCapture is
     what makes a stroke that leaves the sheet still belong to it: without it,
     dragging off the edge ends the stroke wherever the pointer crossed the
     boundary and the next move starts a new one. */
  function onPointerDown(event) {
    if (!event.isPrimary) return;
    canvas.setPointerCapture(event.pointerId);
    live = [pointFrom(event)];
    redraw();
    onChange();
  }

  function onPointerMove(event) {
    if (!live || !event.isPrimary) return;
    /* Coalesced events are the ones the browser had ready but did not deliver
       separately — on a high-frequency stylus that is most of the stroke, and
       reading them is the difference between a curve and a polygon. */
    const events = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];
    for (const e of events.length ? events : [event]) live.push(pointFrom(e));
    redraw();
  }

  function onPointerUp(event) {
    if (!live) return;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    strokes.push(live);
    live = null;
    redraw();
    onChange();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  let onChange = () => {};

  /* ResizeObserver rather than a window resize listener: the sheet's size is
     set by its container, which changes when the drawer opens, when the phone
     rotates, and when the browser's own chrome slides away — none of which is
     reliably a window resize event. */
  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);

  return {
    element: canvas,
    resize,
    redraw,
    get strokeCount() { return strokes.length; },
    undo() { strokes.pop(); redraw(); onChange(); },
    clear() { strokes.length = 0; live = null; redraw(); onChange(); },
    set onChange(fn) { onChange = fn; },
  };
}

/* -- The view ------------------------------------------------------------------ */

function renderKakitori(container, data) {
  const wrap = document.createElement('div');
  wrap.className = 'kakitori';

  /* -- Which characters are in the pool ------------------------------------- */

  const rows = data.kanji.map((entry) => ({
    entry,
    level: getEntryLevel(entry),
    bucket: levelBucketOf(getEntryLevel(entry)),
  }));

  const facets = collectFacets(rows.map((row) => [row.bucket]), LEVEL_ORDER);
  const { wrap: levelWrap, buttons: levelButtons } = createFacetChips(facets, {
    className: 'kakitori__levels',
    ariaLabel: 'Filter by level',
  });

  /* -- The characters you have met -------------------------------------------
     A hundred and thirty-two characters offered at random is a chart, not a
     practice sheet: a reader four lessons in gets 電 and 館 as often as 日, and
     the shape they cannot write is the one they have never seen. Which of them
     the reader has met is a fact the app already holds — a character with a
     progress record is one that has been through a round or been marked — so
     this narrows the pool to those, and nothing about the pool is invented.

     A filter and not a mode: it sits with the level chips, it is off by
     default, and it says how many it would leave. The app does not decide what
     to practise; this only lets the reader say "the ones I am working on",
     which is the sentence the level chips could not express.

     Read once, on render, rather than per character. A sitting is a few
     minutes and the store does not change underneath it — nothing on this
     screen writes one, which is the whole point of the view. */
  const records = snapshotRecords();
  const metRows = rows.filter((row) => records.has(row.entry.id));

  const metToggle = document.createElement('button');
  metToggle.type = 'button';
  metToggle.className = 'toggle-chip kakitori__met';
  metToggle.setAttribute('aria-pressed', 'false');
  metToggle.textContent = `Танилцсан нь ${metRows.length}`;
  /* Nothing met yet is a normal first-week state, and a chip that would empty
     the sheet is not a choice worth offering. */
  metToggle.hidden = metRows.length === 0;

  const filters = document.createElement('div');
  filters.className = 'kakitori__filters';
  filters.append(levelWrap, metToggle);

  const meta = document.createElement('p');
  meta.className = 'kakitori__meta meta';

  /* -- The prompt ------------------------------------------------------------
     What the character is, and not which character it is. Readings first
     because that is what a reader hears in their head when they reach for a
     shape; the meaning under it, quieter still. */

  const prompt = document.createElement('div');
  prompt.className = 'kakitori__prompt';

  const readings = document.createElement('p');
  readings.className = 'kakitori__readings reading';
  readings.lang = 'ja';

  const meaning = document.createElement('p');
  meaning.className = 'kakitori__meaning';

  prompt.append(readings, meaning);

  /* -- The sheet -------------------------------------------------------------
     The ghost sits under the canvas rather than beside it, so a revealed
     character and the reader's own strokes occupy the same square and the
     comparison is direct — the difference between "is this the same shape" and
     "are these two shapes the same", which is a harder question to answer with
     a gap in between. */

  const pad = document.createElement('div');
  pad.className = 'kakitori__pad';

  const ghost = document.createElement('p');
  ghost.className = 'kakitori__ghost';
  ghost.lang = 'ja';
  ghost.hidden = true;
  ghost.setAttribute('aria-hidden', 'true');

  const sheet = createSheet();
  pad.append(ghost, sheet.element);

  /* -- Controls --------------------------------------------------------------
     Quiet, and none of them says anything about how it went. Undo and clear
     are the sheet's own; reveal puts the character up against what the reader
     drew; next draws another character.

     After a reveal, undo and clear go away — leaving them would be inviting
     the reader to have another go at a character the app has just printed the
     answer to, which is tracing rather than recall.

     Which left the sheet with one way out of a reveal, and it was the wrong
     one. Having looked, the thing a person with a 漢字ドリル does next is write
     it again — and this view could only offer them a *different* character.
     The answer is not to allow the redraw with the answer on the page, it is
     to put the answer away first: 「もう一度」 hides the character and clears
     the sheet in one press, so the second attempt starts from the same blank
     square the first one did. The anti-tracing argument above is why it does
     both at once rather than handing back "clear".

     Reveal is a toggle for the same reason. A reader who glanced at the shape
     and wants it gone again should not have to give up the strokes they have
     already made to get back to a blank prompt. */

  const controls = document.createElement('div');
  controls.className = 'kakitori__controls';

  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'kakitori__control';
  undo.textContent = 'Сүүлийн зураас';

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'kakitori__control';
  clear.textContent = 'Хуудсыг цэвэрлэх';

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'kakitori__control kakitori__control--again';
  again.textContent = 'Дахин бичих';
  again.hidden = true;

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'kakitori__control kakitori__control--reveal';
  reveal.setAttribute('aria-pressed', 'false');

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'kakitori__control kakitori__control--next';
  next.textContent = 'Дараагийнх →';

  controls.append(undo, clear, again, reveal, next);

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.hidden = true;
  empty.textContent = 'Энэ түвшинд тохирох ханз алга.';

  wrap.append(filters, meta, prompt, pad, controls, empty);

  /* -- State ---------------------------------------------------------------- */

  let pool = rows;
  let current = null;
  let revealed = false;
  /* Whether this character has already been added to the sitting's count. */
  let counted = false;

  function pickNext() {
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    /* Not the one just drawn. A pool of two that keeps offering the same
       character twice in a row reads as broken rather than as random. */
    let choice = current;
    while (choice === current) choice = pool[Math.floor(Math.random() * pool.length)];
    return choice;
  }

  function describeReadings(entry) {
    const parts = [];
    if (entry.onyomi) parts.push(entry.onyomi);
    if (entry.kunyomi) parts.push(entry.kunyomi);
    return parts.join(' ・ ');
  }

  function syncMeta() {
    const levelLabel = describeLevelSpan(pool.map((row) => row.bucket));
    const size = `${pool.length} ханз`;
    /* The session count, and only once there is one. No goal beside it, no
       bar under it, and it disappears again on reload — it says what happened,
       not what is left. */
    const done = drawnCount > 0 ? ` · энэ удаад ${drawnCount} бичлээ` : '';
    meta.textContent = (levelLabel ? `${levelLabel} · ${size}` : size) + done;
  }

  function syncControls() {
    const hasStrokes = sheet.strokeCount > 0;
    /* The two that edit a sheet are gone while the answer is on it; the one
       that starts the attempt over takes their place. Reveal stays either way
       — it is the toggle now, and the reader has to be able to press it back. */
    undo.hidden = revealed;
    clear.hidden = revealed;
    again.hidden = !revealed;
    undo.disabled = !hasStrokes;
    clear.disabled = !hasStrokes;
    reveal.textContent = revealed ? 'Ханзыг нуух' : 'Ханзыг харах';
    reveal.setAttribute('aria-pressed', String(revealed));
  }

  /* Puts the answer away and gives the sheet back. Shared by 「もう一度」 and by
     the reveal toggle's off state, so hiding the character is one thing that
     happens one way — the difference between them is only whether the strokes
     go with it. */
  function conceal() {
    revealed = false;
    ghost.hidden = true;
    syncControls();
  }

  function show(row) {
    current = row;
    revealed = false;
    counted = false;
    ghost.hidden = true;
    sheet.clear();

    if (!row) {
      prompt.hidden = true;
      pad.hidden = true;
      controls.hidden = true;
      empty.hidden = false;
      syncMeta();
      return;
    }

    prompt.hidden = false;
    pad.hidden = false;
    controls.hidden = false;
    empty.hidden = true;

    readings.textContent = describeReadings(row.entry) || '—';
    meaning.textContent = row.entry.meaning;
    ghost.textContent = row.entry.character;

    syncMeta();
    syncControls();
    sheet.resize();
  }

  sheet.onChange = syncControls;

  undo.addEventListener('click', () => sheet.undo());
  clear.addEventListener('click', () => sheet.clear());

  reveal.addEventListener('click', () => {
    if (revealed) {
      conceal();
      return;
    }

    revealed = true;
    ghost.hidden = false;
    /* Counted on the *first* reveal of this character rather than on the first
       stroke: a character the reader looked at is one they went through, and
       one they started and cleared is not. Toggling the answer back and forth,
       or writing it a second time, is still one character — hence the flag,
       which show() resets and conceal() deliberately does not. */
    if (!counted) {
      counted = true;
      drawnCount += 1;
      syncMeta();
    }
    syncControls();
    next.focus();
  });

  again.addEventListener('click', () => {
    conceal();
    sheet.clear();
  });

  next.addEventListener('click', () => show(pickNext()));

  function applyFilter() {
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );
    const onlyMet = metToggle.getAttribute('aria-pressed') === 'true';
    const base = onlyMet ? metRows : rows;
    pool = selected.size === 0 ? base : base.filter((row) => selected.has(row.bucket));
    show(pickNext());
  }

  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      applyFilter();
    });
  });

  metToggle.addEventListener('click', () => {
    metToggle.setAttribute('aria-pressed', String(metToggle.getAttribute('aria-pressed') !== 'true'));
    applyFilter();
  });

  /* The sheet's ink is read from the stylesheet at redraw time, so a theme
     change only needs to ask for a redraw — see tokens() in createSheet. */
  document.addEventListener('bigu:themechange', () => sheet.redraw());

  container.replaceChildren(wrap);
  show(pickNext());
}

/* -- Init ---------------------------------------------------------------------- */

async function initKakitori() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'kakitori-content'), {
    skeleton: 'rows',
    load: loadKanji,
    render: renderKakitori,
    errorTitle: 'Ханзны багц ачаалагдсангүй.',
    errorDetail: `Тэмдэгтийн багц data/kanji.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initKakitori };
