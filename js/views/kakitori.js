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

const VIEW_ID = 'kakitori';

/* The brush. 7 CSS pixels at the sheet's logical size — a stroke thick enough
   to read as ink rather than as a diagram, thin enough that two strokes
   crossing in a dense character stay two strokes. */
const STROKE_WIDTH = 7;

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

  function drawStroke(points, w, h) {
    if (!points.length) return;
    ctx.beginPath();
    if (points.length === 1) {
      /* A tap with no travel is still a mark — the dot a short stroke leaves.
         Without this the reader presses, lifts, and nothing appears. */
      ctx.arc(points[0].x * w, points[0].y * h, STROKE_WIDTH / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(points[0].x * w, points[0].y * h);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x * w, points[i].y * h);
    }
    ctx.stroke();
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
     Four, quiet, and none of them says anything about how it went. Undo and
     clear are the sheet's own; reveal ends the attempt; next draws another
     character. After a reveal the first three go away, because there is
     nothing left to do to a sheet you have already checked — and leaving
     "clear" there would be inviting the reader to have another go at a
     character the app has just printed the answer to. */

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

  const reveal = document.createElement('button');
  reveal.type = 'button';
  reveal.className = 'kakitori__control kakitori__control--reveal';
  reveal.textContent = 'Ханзыг харах';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'kakitori__control kakitori__control--next';
  next.textContent = 'Дараагийнх →';

  controls.append(undo, clear, reveal, next);

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.hidden = true;
  empty.textContent = 'Энэ түвшинд тохирох ханз алга.';

  wrap.append(levelWrap, meta, prompt, pad, controls, empty);

  /* -- State ---------------------------------------------------------------- */

  let pool = rows;
  let current = null;
  let revealed = false;

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
    undo.hidden = revealed;
    clear.hidden = revealed;
    reveal.hidden = revealed;
    undo.disabled = !hasStrokes;
    clear.disabled = !hasStrokes;
  }

  function show(row) {
    current = row;
    revealed = false;
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
    revealed = true;
    ghost.hidden = false;
    /* Counted on reveal rather than on the first stroke: a character the
       reader looked at is one they went through, and one they started and
       cleared is not. */
    drawnCount += 1;
    syncMeta();
    syncControls();
    next.focus();
  });

  next.addEventListener('click', () => show(pickNext()));

  function applyFilter() {
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );
    pool = selected.size === 0 ? rows : rows.filter((row) => selected.has(row.bucket));
    show(pickNext());
  }

  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      applyFilter();
    });
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
