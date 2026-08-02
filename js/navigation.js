/**
 * navigation.js
 * -----------------------------------------------------------------------
 * Responsive app navigation — a sticky sidebar on desktop that collapses
 * into an off-canvas drawer on mobile, with a collapsible "Study" submenu.
 *
 * Vanilla JS / ES module. No framework, no build step, no innerHTML —
 * every element is built with createElement/append, matching the rest
 * of the app.
 *
 * USAGE
 * -----
 *   import { createNavigation } from './navigation.js';
 *
 *   const nav = createNavigation({
 *     onNavigate: (route) => console.log('active route ->', route),
 *   });
 *   document.querySelector('#app-shell').prepend(nav);
 *
 * Routing: links use plain hash hrefs (#dashboard, #study/vocabulary, ...)
 * so it works immediately with a hash router. Active state is kept in
 * sync automatically on 'hashchange'; onNavigate fires alongside it so
 * you can forward the route to your own router if you have one.
 *
 * Styling: colors/fonts/spacing are read from CSS custom properties
 * with fallback values, so if this file is dropped into a project that
 * already defines design tokens (e.g. --color-ink, --color-indigo,
 * --font-body, --space-md ...) it will automatically pick them up —
 * otherwise it falls back to sensible defaults and still looks correct
 * standalone. Rename the var() fallbacks below if your token names
 * differ. A `[data-theme="dark"]` override is included out of the box.
 * -----------------------------------------------------------------------
 */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', route: 'dashboard', icon: 'dashboard' },
  {
    id: 'study',
    label: 'Study',
    route: 'study',
    icon: 'study',
    children: [
      { id: 'vocabulary', label: 'Vocabulary', route: 'study/vocabulary' },
      { id: 'grammar', label: 'Grammar', route: 'study/grammar' },
      { id: 'reading', label: 'Reading', route: 'study/reading' },
      { id: 'listening', label: 'Listening', route: 'study/listening' },
      { id: 'kanji', label: 'Kanji', route: 'study/kanji' },
      { id: 'conversation', label: 'Conversation', route: 'study/conversation' },
      { id: 'shadowing', label: 'Shadowing', route: 'study/shadowing' },
    ],
  },
  { id: 'review', label: 'Review', route: 'review', icon: 'review' },
  { id: 'search', label: 'Search', route: 'search', icon: 'search' },
  { id: 'profile', label: 'Profile', route: 'profile', icon: 'profile' },
  { id: 'settings', label: 'Settings', route: 'settings', icon: 'settings' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_SHAPES = {
  dashboard: [
    ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }],
    ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }],
  ],
  study: [
    [
      'path',
      {
        d: 'M12 6c-1.5-1.2-3.5-2-6-2-1 0-2 .15-3 .4V17c1-.25 2-.4 3-.4 2.5 0 4.5.8 6 2 1.5-1.2 3.5-2 6-2 1 0 2 .15 3 .4V4.4c-1-.25-2-.4-3-.4-2.5 0-4.5.8-6 2Z',
      },
    ],
    ['line', { x1: 12, y1: 6, x2: 12, y2: 19 }],
  ],
  review: [
    ['path', { d: 'M4 12a8 8 0 1 1 2.5 5.8' }],
    ['polyline', { points: '4 16 4 12 8 12' }],
  ],
  search: [
    ['circle', { cx: 11, cy: 11, r: 7 }],
    ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }],
  ],
  profile: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4 20c0-4 3.6-7 8-7s8 3 8 7' }],
  ],
  settings: [
    ['line', { x1: 4, y1: 6, x2: 20, y2: 6 }],
    ['circle', { cx: 15, cy: 6, r: 2 }],
    ['line', { x1: 4, y1: 12, x2: 20, y2: 12 }],
    ['circle', { cx: 9, cy: 12, r: 2 }],
    ['line', { x1: 4, y1: 18, x2: 20, y2: 18 }],
    ['circle', { cx: 15, cy: 18, r: 2 }],
  ],
  chevron: [['polyline', { points: '6 9 12 15 18 9' }]],
};

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function createIcon(name, size = 18, extraClass = '') {
  const svg = svgEl('svg', {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  });
  svg.setAttribute('class', `nav__icon${extraClass ? ` ${extraClass}` : ''}`);
  (ICON_SHAPES[name] || []).forEach(([tag, attrs]) => svg.appendChild(svgEl(tag, attrs)));
  return svg;
}

function textSpan(text) {
  const span = document.createElement('span');
  span.className = 'nav__label';
  span.textContent = text;
  return span;
}

function decodeHash(hash) {
  return hash.replace(/^#\/?/, '');
}

function buildItem(item) {
  const li = document.createElement('li');
  li.className = 'nav__item';

  if (item.children && item.children.length) {
    li.classList.add('nav__item--parent');

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'nav__link nav__toggle';
    toggleBtn.dataset.route = item.route;
    toggleBtn.setAttribute('aria-expanded', 'false');
    toggleBtn.setAttribute('aria-controls', `nav-submenu-${item.id}`);
    toggleBtn.append(
      createIcon(item.icon),
      textSpan(item.label),
      createIcon('chevron', 16, 'nav__chevron'),
    );

    const wrapper = document.createElement('div');
    wrapper.className = 'nav__submenu-wrapper';
    wrapper.id = `nav-submenu-${item.id}`;

    const submenu = document.createElement('ul');
    submenu.className = 'nav__submenu';
    submenu.setAttribute('role', 'group');

    item.children.forEach((child) => {
      const childLi = document.createElement('li');
      const childLink = document.createElement('a');
      childLink.className = 'nav__link nav__sublink';
      childLink.href = `#${child.route}`;
      childLink.dataset.route = child.route;
      childLink.textContent = child.label;
      childLi.appendChild(childLink);
      submenu.appendChild(childLi);
    });

    wrapper.appendChild(submenu);
    li.append(toggleBtn, wrapper);
  } else {
    const link = document.createElement('a');
    link.className = 'nav__link';
    link.href = `#${item.route}`;
    link.dataset.route = item.route;
    link.append(createIcon(item.icon), textSpan(item.label));
    li.appendChild(link);
  }

  return li;
}

function injectStyles() {
  if (document.getElementById('nav-styles')) return;
  const style = document.createElement('style');
  style.id = 'nav-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * Builds and returns the <nav> element. Call once per app instance.
 * @param {{ activeRoute?: string, onNavigate?: (route: string) => void }} options
 */
export function createNavigation({ activeRoute, onNavigate } = {}) {
  injectStyles();

  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.setAttribute('aria-label', 'Main navigation');

  // --- mobile hamburger toggle -------------------------------------------
  const mobileToggle = document.createElement('button');
  mobileToggle.type = 'button';
  mobileToggle.className = 'nav__mobile-toggle';
  mobileToggle.setAttribute('aria-expanded', 'false');
  mobileToggle.setAttribute('aria-controls', 'nav-panel');
  mobileToggle.setAttribute('aria-label', 'Toggle navigation menu');

  const hamburger = document.createElement('span');
  hamburger.className = 'nav__hamburger';
  hamburger.append(
    document.createElement('span'),
    document.createElement('span'),
    document.createElement('span'),
  );
  mobileToggle.appendChild(hamburger);

  // --- backdrop (mobile only) --------------------------------------------
  const backdrop = document.createElement('div');
  backdrop.className = 'nav__backdrop';
  backdrop.hidden = true;

  // --- sliding panel -------------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'nav__panel';
  panel.id = 'nav-panel';

  const brand = document.createElement('div');
  brand.className = 'nav__brand';
  brand.textContent = 'Bigu'; // rename to your app name if needed
  panel.appendChild(brand);

  const list = document.createElement('ul');
  list.className = 'nav__list';
  NAV_ITEMS.forEach((item) => list.appendChild(buildItem(item)));
  panel.appendChild(list);

  nav.append(mobileToggle, backdrop, panel);

  // --- mobile drawer open/close -------------------------------------------
  function openMobileDrawer() {
    panel.classList.add('is-open');
    backdrop.hidden = false;
    mobileToggle.setAttribute('aria-expanded', 'true');
  }

  function closeMobileDrawer() {
    panel.classList.remove('is-open');
    backdrop.hidden = true;
    mobileToggle.setAttribute('aria-expanded', 'false');
  }

  mobileToggle.addEventListener('click', () => {
    panel.classList.contains('is-open') ? closeMobileDrawer() : openMobileDrawer();
  });
  backdrop.addEventListener('click', closeMobileDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMobileDrawer();
  });

  // --- "Study" collapse/expand + leaf-link clicks -------------------------
  list.addEventListener('click', (event) => {
    const toggleBtn = event.target.closest('.nav__toggle');
    if (toggleBtn) {
      const parentItem = toggleBtn.closest('.nav__item--parent');
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      parentItem.classList.toggle('is-open', !expanded);
      return;
    }
    if (event.target.closest('.nav__link')) closeMobileDrawer();
  });

  // --- active-state highlighting -------------------------------------------
  function setActive(route) {
    list.querySelectorAll('.nav__link').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.route === route);
    });
    list.querySelectorAll('.nav__item--parent').forEach((parentEl) => {
      const hasActiveChild = !!parentEl.querySelector('.nav__sublink.is-active');
      parentEl.classList.toggle('has-active-child', hasActiveChild);
      if (hasActiveChild) {
        parentEl.classList.add('is-open');
        const btn = parentEl.querySelector('.nav__toggle');
        if (btn) btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  function syncFromHash() {
    const route = decodeHash(location.hash);
    setActive(route);
    if (onNavigate) onNavigate(route);
  }

  window.addEventListener('hashchange', syncFromHash);
  setActive(activeRoute || decodeHash(location.hash));

  return nav;
}

export default createNavigation;

const CSS = `
.nav, .nav *, .nav *::before, .nav *::after { box-sizing: border-box; }

.nav {
  --nav-bg: var(--color-washi, #faf7f2);
  --nav-border: var(--color-washi-alt, #e6ddd0);
  --nav-ink: var(--color-ink, #2b2620);
  --nav-ink-soft: var(--color-ink-soft, #6b6255);
  --nav-accent: var(--color-indigo, #3d4b8c);
  --nav-accent-soft: var(--color-indigo-soft, rgba(61, 75, 140, 0.1));
  --nav-radius: 10px;
  --nav-width: 248px;
  --nav-font: var(--font-body, 'Inter', system-ui, sans-serif);
  --nav-transition: 220ms cubic-bezier(0.4, 0, 0.2, 1);
  font-family: var(--nav-font);
}

[data-theme="dark"] .nav {
  --nav-bg: var(--color-ink, #1b1812);
  --nav-border: var(--color-ink-soft, #3a352c);
  --nav-ink: var(--color-washi, #f5efe4);
  --nav-ink-soft: var(--color-washi-alt, #c9c0b0);
  --nav-accent-soft: var(--color-indigo-soft, rgba(120, 138, 220, 0.16));
}

/* ---- mobile hamburger toggle ---- */
.nav__mobile-toggle {
  position: fixed;
  top: var(--space-sm, 12px);
  left: var(--space-sm, 12px);
  z-index: 60;
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--nav-border);
  border-radius: 8px;
  background: var(--nav-bg);
  color: var(--nav-ink);
  cursor: pointer;
}
.nav__mobile-toggle:focus-visible {
  outline: 2px solid var(--nav-accent);
  outline-offset: 2px;
}

.nav__hamburger { position: relative; width: 18px; height: 14px; display: block; }
.nav__hamburger span {
  position: absolute;
  left: 0;
  width: 100%;
  height: 2px;
  background: currentColor;
  border-radius: 2px;
  transition: transform var(--nav-transition), opacity var(--nav-transition);
}
.nav__hamburger span:nth-child(1) { top: 0; }
.nav__hamburger span:nth-child(2) { top: 6px; }
.nav__hamburger span:nth-child(3) { top: 12px; }
.nav__mobile-toggle[aria-expanded="true"] .nav__hamburger span:nth-child(1) { transform: translateY(6px) rotate(45deg); }
.nav__mobile-toggle[aria-expanded="true"] .nav__hamburger span:nth-child(2) { opacity: 0; }
.nav__mobile-toggle[aria-expanded="true"] .nav__hamburger span:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }

/* ---- backdrop (mobile only, shown via [hidden] toggling in JS) ---- */
.nav__backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.35);
}

/* ---- panel ---- */
.nav__panel {
  width: var(--nav-width);
  height: 100vh;
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-md, 16px);
  background: var(--nav-bg);
  border-right: 1px solid var(--nav-border);
  overflow-y: auto;
}

.nav__brand {
  font-family: var(--font-display, var(--nav-font));
  font-weight: 600;
  font-size: 1.1rem;
  color: var(--nav-ink);
  padding: var(--space-2xs, 6px) var(--space-xs, 8px) var(--space-md, 16px);
}

.nav__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }

.nav__link {
  display: flex;
  align-items: center;
  gap: var(--space-xs, 10px);
  width: 100%;
  padding: 10px var(--space-xs, 10px);
  border: none;
  background: none;
  border-radius: var(--nav-radius);
  color: var(--nav-ink-soft);
  font: inherit;
  font-size: 0.925rem;
  text-decoration: none;
  cursor: pointer;
  transition: background var(--nav-transition), color var(--nav-transition);
}
.nav__link:hover { background: var(--nav-accent-soft); color: var(--nav-ink); }
.nav__link.is-active { background: var(--nav-accent-soft); color: var(--nav-accent); font-weight: 600; }
.nav__link:focus-visible { outline: 2px solid var(--nav-accent); outline-offset: 2px; }

.nav__icon { flex-shrink: 0; }
.nav__label { flex: 1; text-align: left; }

.nav__chevron { margin-left: auto; transition: transform var(--nav-transition); }
.nav__toggle[aria-expanded="true"] .nav__chevron { transform: rotate(180deg); }
.nav__item--parent.has-active-child > .nav__toggle { color: var(--nav-accent); }

/* smooth expand/collapse using the 0fr -> 1fr grid-rows technique
   (animates to the content's natural height, no fixed max-height guess) */
.nav__submenu-wrapper {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--nav-transition);
}
.nav__item--parent.is-open .nav__submenu-wrapper { grid-template-rows: 1fr; }
.nav__submenu { overflow: hidden; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nav__sublink { padding: 8px 10px 8px 40px; font-size: 0.875rem; }

@media (prefers-reduced-motion: reduce) {
  .nav__submenu-wrapper, .nav__chevron, .nav__link, .nav__hamburger span { transition: none; }
}

/* ---- responsive: sidebar (desktop) <-> off-canvas drawer (mobile) ---- */
@media (max-width: 640px) {
  .nav__mobile-toggle { display: inline-flex; }

  .nav__panel {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform var(--nav-transition);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.12);
  }
  .nav__panel.is-open { transform: translateX(0); }
}
`;
