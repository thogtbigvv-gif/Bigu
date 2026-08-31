/* ==========================================================================
   ui/firstRun.js
   What the app says about itself to somebody who has never used it.

   Three verbs and a sentence each: 出会う, 思い出す, 薄れる — meet a word,
   try to recall it, watch the ink fade. That is the whole of Bigu's
   argument, and it is the one thing a reader arriving for the first time
   needs before any screen in here means anything.

   It was written for the Dashboard, which is where the app used to open, and
   the argument for it there still stands wherever it is drawn: what a
   brand-new reader met on the first screen of the app was four cards reading
   0 items due, 0 days streak, 0 words in memory, and "You haven't reviewed
   yet." Every one of those sentences is true and none of them is any use — a
   status surface has nothing to report before there is any status, and a grid
   of zeroes is the least inviting thing a study app can open with. It also
   quietly taught the wrong lesson, that the numbers are the point, to the one
   reader with no other impression yet.

   It lived inside views/dashboard.js, which is where the app used to open.
   The app opens on Home now and the Dashboard has no nav row, so the app's
   own explanation of itself was being kept on the one screen nothing links
   to: a first-time reader landed on Home, saw one kanji and one button, and
   was never told what any of it was for. Lifting it here rather than
   copying it onto Home is the difference between two surfaces agreeing and
   two surfaces that agreed on the day they were written.

   The card is built without a surface of its own. The Dashboard draws it
   inside a `.card`, because that screen is made of cards; Home appends it
   bare, because home.css says in as many words that nothing on that screen
   gets a box drawn round it. Same content, same class names, one rule each
   about how it sits.

   `isFirstVisit` is here for the same reason. Home and the Dashboard each
   had their own copy of it, agreeing by coincidence — and "has this reader
   ever done anything" is the question this module exists to answer, so it
   is answered once, here, rather than in the two places that ask it.
   ========================================================================== */

/* Defined as "nothing in any store" rather than by a flag, so it is also
   correct after a reader clears their data or opens the app in a second
   browser — both of which are, from the app's side, exactly a first visit.
   The three arguments are what the callers already hold; reading the stores
   again in here would make a pure function of the caller's own snapshot
   into a second, slightly later opinion about it. */
function isFirstVisit({ records, entries, sessions }) {
  return records.size === 0 && entries.length === 0 && sessions.length === 0;
}

const STEPS = [
  {
    jp: '出会う',
    title: 'Meet a word',
    body: 'Lessons бол эхлэх зам — арван таван хичээл, тус бүр хэдхэн үгтэй. Харин чөлөөтэй эргүүлж үзмээр бол Vocabulary, Grammar, Kanji гурав хүлээж байна.',
  },
  {
    jp: '思い出す',
    title: 'Try to recall it',
    body: 'Review нь япон үгийг эхэлж үзүүлээд, утгыг нь харуулахаасаа өмнө тухайн үгийг асууна. Үнэнээр хариулаарай; давтах хуваарь тань оноогоор биш, таны хариултаар тогтоно.',
  },
  {
    jp: '薄れる',
    title: 'Watch the ink fade',
    body: 'Таны танилцсан үг бүр тэр агшнаасаа бүдгэрч эхэлнэ. Memory аль нь бүдгэрч байгааг харуулдаг — тиймээс богинохон орж ирсэн ч хийх үнэ цэнэтэй зүйл үргэлж байна.',
  },
];

/* One id, and only one of these is ever on screen at a time: the two callers
   are two different views, and a reader is in one view. */
const HEADING_ID = 'first-run-heading';

/* It disappears for good the moment anything is studied, and there is no
   dismiss button — a welcome you have to dismiss is a welcome that
   outstayed its welcome. */
function createFirstRun() {
  const section = document.createElement('section');
  section.className = 'first-run';
  section.setAttribute('aria-labelledby', HEADING_ID);

  const kicker = document.createElement('p');
  kicker.className = 'first-run__kicker';
  kicker.textContent = 'First time here';

  const heading = document.createElement('h2');
  heading.className = 'first-run__heading';
  heading.id = HEADING_ID;
  heading.textContent = 'Ердөө гурван зүйл — аппын бүх учир нь тэр.';

  const steps = document.createElement('ol');
  steps.className = 'first-run__steps';

  for (const step of STEPS) {
    const item = document.createElement('li');
    item.className = 'first-run__step';

    const mark = document.createElement('p');
    mark.className = 'first-run__step-mark';
    mark.lang = 'ja';
    mark.textContent = step.jp;
    mark.setAttribute('aria-hidden', 'true');

    const title = document.createElement('p');
    title.className = 'first-run__step-title';
    title.textContent = step.title;

    const body = document.createElement('p');
    body.className = 'first-run__step-body';
    body.textContent = step.body;

    item.append(mark, title, body);
    steps.append(item);
  }

  const actions = document.createElement('div');
  actions.className = 'first-run__actions';

  const start = document.createElement('a');
  start.href = '#lessons';
  start.className = 'button button--primary';
  start.textContent = 'Start with lesson one';

  const browse = document.createElement('a');
  browse.href = '#vocabulary';
  browse.className = 'button button--secondary';
  browse.textContent = 'Browse the vocabulary';

  actions.append(start, browse);

  /* The note is wrapped rather than carrying the divider itself: typography
     gives every <p> a 68ch measure, so a rule drawn on the paragraph
     stopped two thirds of the way across and read as an underline on the
     text instead of as the foot of the section. */
  const foot = document.createElement('div');
  foot.className = 'first-run__foot';

  const note = document.createElement('p');
  note.className = 'first-run__note meta';
  note.textContent =
    'Таны хийсэн бүхэн энэ хөтөч дотор үлдэж, төхөөрөмжөөс хэзээ ч гардаггүй. Хуулбар авмаар бол Settings дотор нэг товшилтоор нөөцлөх боломжтой.';

  foot.append(note);
  section.append(kicker, heading, steps, actions, foot);
  return section;
}

export { createFirstRun, isFirstVisit };
