/* ============================================================
 * app.js — ERC Policy Exchange
 * ============================================================
 * A filterable feed of education opportunities, new policy
 * research, headlines, and upcoming (non-ERC) events. Everything
 * is CSV-driven: edit data/news.csv, reload, done.
 *
 * Interaction: category tabs across the top pick the stream; the
 * Quick Search buttons refine within it. Rows expand
 * in place; the feed is sorted newest-first.
 *
 * Deep-link params (so a newsletter can link straight to a view):
 *   ?type=opportunity   category tab (opportunity/research/headline/event)
 *   ?subtype=…          sub-category filter
 *   ?q=teacher          keyword search
 * ============================================================ */

const NEWS_CSV = "data/news.csv";

// Category tabs across the top — you view one stream at a time (the
// categories are distinct enough that a mixed "All" view isn't useful).
// These mirror the ERC newsletter's timely sections.
// label = full name (feed/section header); nav = short top-nav label;
// card = landing-card label. icon = a file in assets/icons/ (Kate's set),
// shown on the landing card via CSS mask — swap the file name to change it.
const NEWS_TABS = [
  {
    value: "opportunity",
    label: "Opportunities",
    nav: "Opportunities",
    card: "Opportunities",
    icon: "megaphone.svg",
    desc: "Fellowships, grants, and calls for proposals from across education research — deadlines at a glance.",
  },
  {
    value: "event",
    label: "Upcoming Events",
    nav: "Events",
    card: "Upcoming Events",
    icon: "webinar.svg",
    desc: "Webinars, talks, and convenings worth your calendar — from the ERC and beyond.",
  },
  {
    value: "research",
    label: "New Education Policy Research",
    nav: "Research",
    card: "Research",
    icon: "working-paper.svg",
    desc: "New working papers, peer-reviewed studies, reports, and ERC research briefs.",
  },
  {
    value: "headline",
    label: "Education Headlines",
    nav: "Headlines",
    card: "Education Headlines",
    icon: "us.svg",
    desc: "The education news we're following, from Texas and across the country.",
  },
];

// Home icon for the top nav.
const HOME_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75"/></svg>';

// Today (YYYY-MM-DD). Upcoming Events drop off automatically once their date
// passes, so the feed stays current with no manual pruning.
const TODAY = new Date().toISOString().slice(0, 10);
const isPastEvent = (it) =>
  (it.type || "").toLowerCase() === "event" && (it.date || "") < TODAY;

// Single source of truth for what's shown.
const state = {
  items: [],
  view: "home", // "home" (landing page) | "section" (a category feed)
  type: NEWS_TABS[0].value, // active category (when view === "section")
  subtype: "all", // sub-category filter (scoped to the active category)
  q: "",
  sort: null, // {key,dir} once a sort action is chosen; null = per-tab default
  searchFrom: null, // where to return when the global search box is cleared
};

/* ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Format an ISO date (YYYY-MM-DD) as e.g. "Jun 30, 2026".
function formatDate(iso) {
  if (!iso) return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts.map(Number);
  const date = new Date(y, m - 1, d); // local time; avoids TZ off-by-one
  if (isNaN(date)) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function matches(haystack, needle) {
  return haystack.toLowerCase().includes(needle.toLowerCase().trim());
}

// Interpret an Opportunity's `deadline` cell.
//   "2026-07-29" → a firm date: sortable, expirable, shows "Due Jul 29, 2026".
//   "rolling"    → shows "Rolling"; never sorts to the top, never expires.
//   "Fall 2026"  → any other free text: shown verbatim, treated like rolling.
//   ""           → no deadline shown; treated like rolling.
function parseDeadline(raw) {
  const v = (raw || "").trim();
  if (!v) return { iso: "", label: "", firm: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return { iso: v, label: `Due ${formatDate(v)}`, firm: true };
  }
  const label = v.toLowerCase() === "rolling" ? "Rolling" : v;
  return { iso: "", label, firm: false };
}

// True once a firm opportunity deadline has passed (mirrors past-event drop-off).
const isPastDeadline = (it) => {
  if ((it.type || "").toLowerCase() !== "opportunity") return false;
  const d = parseDeadline(it.deadline);
  return d.firm && d.iso < TODAY;
};

// A dated item that has aged out of the feed (past event OR past deadline).
const isExpired = (it) => isPastEvent(it) || isPastDeadline(it);

/* ------------------------------------------------------------
 * URL <-> state
 * ------------------------------------------------------------ */
function readURL() {
  const p = new URLSearchParams(window.location.search);
  const type = (p.get("type") || "").toLowerCase();
  state.q = (p.get("q") || "").trim();
  // ?q= opens global search; a valid ?type= opens that section; anything else
  // is the landing page.
  if (NEWS_TABS.some((t) => t.value === type)) {
    state.type = type;
    state.view = "section";
  } else {
    state.view = "home";
  }
  if (state.q) state.view = "search";
  state.subtype = p.get("subtype") || "all";
}

function writeURL() {
  const p = new URLSearchParams();
  // Search carries ?q=; a section carries ?type=; home is a clean URL.
  if (state.view === "search") {
    p.set("q", state.q.trim());
  } else if (state.view === "section") {
    p.set("type", state.type);
    if (state.subtype !== "all") p.set("subtype", state.subtype);
  }
  const qs = p.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

/* ------------------------------------------------------------
 * Init
 * ------------------------------------------------------------ */
function init(rows) {
  state.items = rows;

  // Freshness cue: the most recent item date that isn't in the future (so an
  // upcoming event's date doesn't read as a future "last updated").
  const latest = state.items
    .map((it) => it.date)
    .filter((d) => d && d <= TODAY)
    .reduce((m, d) => (d > m ? d : m), "");
  $("#news-updated").textContent = latest ? `Updated ${formatDate(latest)}` : "";

  buildNav();
  buildLanding();
  validateSubtype();

  // Global search (top strip): typing searches every section at once; clearing
  // returns to wherever you were (landing or a section).
  const gs = $("#global-search");
  gs.value = state.q;
  gs.addEventListener("input", (e) => {
    const q = e.target.value;
    if (q.trim()) {
      if (state.view !== "search") {
        state.searchFrom = { view: state.view, type: state.type };
        state.view = "search";
      }
      state.q = q;
    } else {
      state.q = "";
      if (state.view === "search") {
        const back = state.searchFrom || { view: "home" };
        state.view = back.view;
        if (back.type) state.type = back.type;
      }
    }
    render();
    writeURL();
  });

  // Card-tab toolbar: sort text actions + category "view" buttons. The
  // toolbar is rebuilt by render(), so afterwards we restore focus to the
  // equivalent new button (keyboard users would otherwise be dropped).
  $("#opp-toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sortkey], [data-subtype]");
    if (!btn) return;
    if (btn.dataset.sortkey) {
      state.sort = { key: btn.dataset.sortkey, dir: btn.dataset.sortdir };
    } else if (btn.dataset.subtype != null) {
      // Clicking the active category pill again deselects it (same as Clear).
      state.subtype =
        btn.dataset.subtype === state.subtype ? "all" : btn.dataset.subtype;
    }
    render();
    writeURL();
    const again = $("#opp-toolbar").querySelector(
      btn.dataset.sortkey
        ? `[data-sortkey="${btn.dataset.sortkey}"][data-sortdir="${btn.dataset.sortdir}"]`
        : `[data-subtype="${CSS.escape(btn.dataset.subtype)}"]`
    );
    if (again && !again.disabled) again.focus();
  });

  // Re-measure the sticky toolbar when the viewport changes (it can re-wrap).
  window.addEventListener("resize", syncToolbarHeight);

  // Mobile hamburger: toggles the collapsed nav panel (CSS shows the button
  // and hides the links only under the mobile breakpoint).
  $("#menu-btn").addEventListener("click", () => {
    const open = $(".topnav").classList.toggle("is-open");
    $("#menu-btn").setAttribute("aria-expanded", String(open));
  });

  // One delegated listener covers every feed row ever rendered: the caret
  // button toggles the detail, a click elsewhere on the row does the same
  // (bigger target), and link-only rows open their source.
  $("#news-list").addEventListener("click", (e) => {
    const caretBtn = e.target.closest(".feed-expand");
    if (caretBtn) {
      toggleDetail(caretBtn);
      return;
    }
    const row = e.target.closest(".feed-item__row");
    if (!row || e.target.closest("a")) return;
    const caret = row.querySelector(".feed-expand");
    if (caret) toggleDetail(caret);
    const linkItem = row.closest(".feed-item--link");
    if (linkItem && linkItem.dataset.href) {
      window.open(linkItem.dataset.href, "_blank", "noopener");
    }
  });

  render();
}

/* ------------------------------------------------------------
 * Top navigation + landing
 * ------------------------------------------------------------ */
// Build the top nav strip: Home + the four sections.
function buildNav() {
  const el = $("#topnav");
  const home = `
    <button type="button" class="topnav__link topnav__home" data-view="home">
      <span class="topnav__icon" aria-hidden="true">${HOME_ICON}</span>Home
    </button>`;
  // Section links are text-only; Home keeps its icon (it reads as the one
  // utility control in the row).
  const sections = NEWS_TABS.map(
    (t) => `
    <button type="button" class="topnav__link" data-type="${t.value}">${esc(t.nav)}</button>`
  ).join("");
  el.innerHTML = home + sections;

  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".topnav__link");
    if (!btn) return;
    if (btn.dataset.view === "home") setHome();
    else if (btn.dataset.type) setType(btn.dataset.type);
  });
}

// Build the landing-page section cards (icon + title).
function buildLanding() {
  const el = $("#landing-cards");
  el.innerHTML = NEWS_TABS.map(
    (t) => `
    <button type="button" class="lcard" data-type="${t.value}">
      <span class="lcard__icon" aria-hidden="true"><span class="lcard__glyph" ${iconMask(t.icon)}></span></span>
      <span class="lcard__title">${esc(t.card)}</span>
    </button>`
  ).join("");

  el.addEventListener("click", (e) => {
    const card = e.target.closest(".lcard");
    if (card) setType(card.dataset.type);
  });
}

// Highlight the active top-nav link (none while searching).
function updateNavActive() {
  $$("#topnav .topnav__link").forEach((b) => {
    const active =
      state.view === "search"
        ? false
        : state.view === "home"
        ? b.dataset.view === "home"
        : b.dataset.type === state.type;
    b.classList.toggle("is-active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

// Open a section. Sub-category is category-specific, so it resets; navigating
// anywhere also leaves search mode.
// Collapse the mobile nav panel (no-op on desktop, where it isn't a panel).
function closeMenu() {
  $(".topnav").classList.remove("is-open");
  $("#menu-btn").setAttribute("aria-expanded", "false");
}

function setType(type) {
  state.view = "section";
  state.type = type;
  state.subtype = "all";
  state.sort = null; // each section starts at its sensible default sort
  clearSearch();
  closeMenu();
  render();
  writeURL();
  window.scrollTo(0, 0);
}

// Return to the landing page.
function setHome() {
  state.view = "home";
  clearSearch();
  closeMenu();
  render();
  writeURL();
  window.scrollTo(0, 0);
}

function clearSearch() {
  state.q = "";
  state.searchFrom = null;
  const gs = $("#global-search");
  if (gs) gs.value = "";
}

/* ------------------------------------------------------------
 * Rail filters
 * ------------------------------------------------------------ */
function distinct(field, items = state.items) {
  const set = new Set();
  items.forEach((it) => {
    const v = (it[field] || "").trim();
    if (v) set.add(v);
  });
  return [...set].sort();
}

// Kate's per-tab subtype order (2026-07-15) — drives the Quick Search button
// order AND the colour cycle (1st non-maroon subtype = navy, then gold, teal,
// purple, orange). Lowercase, matching the CSV labels. Subtypes not listed
// here sink to the end alphabetically.
const SUBTYPE_ORDER = {
  event: ["erc events", "texas a&m", "online", "webinar", "off-campus"],
  research: ["erc research brief", "working paper", "peer-reviewed", "report"],
  headline: ["texas", "national"],
  opportunity: ["call for proposals", "fellowships & programs", "funding & grants"],
};

// ERC's own + Texas subtypes always wear the solid-border Aggie-maroon pill
// (Kate's rule); everything else cycles the 5-colour palette.
const MAROON_SUBS = new Set(["erc events", "erc research brief", "texas"]);
function sortSubtypes(subs, type) {
  const order = SUBTYPE_ORDER[(type || "").toLowerCase()] || [];
  const rank = (s) => {
    const i = order.indexOf(s.trim().toLowerCase());
    return i === -1 ? order.length : i;
  };
  return [...subs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

// Validate a ?subtype= deep-link against the active tab's live data — a stale
// or misspelled value resets to "all" so the feed never renders empty.
function validateSubtype() {
  if (state.subtype === "all") return;
  const subs = distinct("subtype", liveItemsOfType(state.type));
  if (!subs.includes(state.subtype)) state.subtype = "all";
}

// Every non-expired item in a category — the basis for that tab's feed,
// subtype buttons, and deep-link validation.
function liveItemsOfType(type) {
  return state.items.filter(
    (it) => (it.type || "").toLowerCase() === type && !isExpired(it)
  );
}

/* ------------------------------------------------------------
 * Filter + render
 * ------------------------------------------------------------ */
function filter() {
  const { type, subtype, q } = state;
  const out = state.items.filter((it) => {
    const typeOk = (it.type || "").toLowerCase() === type;
    if (!typeOk || isExpired(it)) return false; // past events / deadlines drop off
    const subOk = subtype === "all" || (it.subtype || "").trim() === subtype;
    const qOk =
      !q.trim() ||
      matches(it.headline || "", q) ||
      matches(it.blurb || "", q) ||
      matches(it.source || "", q);
    return subOk && qOk;
  });
  out.sort(sortComparator());
  return out;
}

// The sort in effect: the user's chosen action, or the tab's first toolbar
// option (soonest-first for Upcoming Events, newest-first everywhere else).
function activeSort() {
  return state.sort || TOOLBAR_SORTS[state.type][0];
}

function sortComparator() {
  const { key, dir } = activeSort();
  const mult = dir === "asc" ? 1 : -1;
  // "Closing soon": firm deadlines ascending (soonest first); rolling / fuzzy /
  // undated ones always fall to the bottom, ordered newest-posted among
  // themselves so the list stays stable.
  if (key === "deadline") {
    return (a, b) => {
      const da = parseDeadline(a.deadline);
      const db = parseDeadline(b.deadline);
      if (da.firm && db.firm) {
        return da.iso < db.iso ? -1 : da.iso > db.iso ? 1 : 0;
      }
      if (da.firm !== db.firm) return da.firm ? -1 : 1;
      return (b.date || "").localeCompare(a.date || "");
    };
  }
  // Every remaining sort is by posted date.
  return (a, b) => (a.date || "").localeCompare(b.date || "") * mult;
}

// Whole days from today to an ISO date (used for the "closing soon" cue).
function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = TODAY.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

// Sort options offered in each tab's button toolbar. Opportunities contrasts
// posted-date vs deadline; Events and Headlines are chronological.
const TOOLBAR_SORTS = {
  opportunity: [
    { label: "Newest posted", key: "date", dir: "desc" },
    { label: "Closing soon", key: "deadline", dir: "asc" },
  ],
  event: [
    { label: "Soonest first", key: "date", dir: "asc" },
    { label: "Latest first", key: "date", dir: "desc" },
  ],
  headline: [
    { label: "Newest first", key: "date", dir: "desc" },
    { label: "Oldest first", key: "date", dir: "asc" },
  ],
  research: [
    { label: "Newest first", key: "date", dir: "desc" },
    { label: "Oldest first", key: "date", dir: "asc" },
  ],
};

// Medium icons (Heroicons, inlined) + display labels — shown AFTER the source
// ("K-12 Dive · [icon] Article") when the CSV's `medium` column is filled.
// Blank medium = source only, so the column stays optional row by row.
const MEDIA = {
  newspaper: {
    label: "Article",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z"/></svg>',
  },
  radio: {
    label: "Radio",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>',
  },
  tv: {
    label: "TV",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z"/></svg>',
  },
  opinion: {
    label: "Opinion",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/></svg>',
  },
  blog: {
    label: "Blog",
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"/></svg>',
  },
};

// Small icons inside the category pills — FEED ROWS ONLY (the SHOW filter
// pills stay text-only). Keyed by lowercase subtype → an SVG in assets/icons/
// (Kate's own set, 2026-07-15). Rendered via CSS mask so the icon takes the
// pill's colour; swap/edit the SVG files and the app picks them up as-is.
// Unknown subtypes simply get no icon, so new CSV categories degrade
// gracefully.
const CAT_ICONS = {
  // Opportunities
  "call for proposals": "megaphone.svg",
  "fellowships & programs": "fellowships-programs.svg",
  "funding & grants": "grants.svg",
  // Events — subtypes per Kate 2026-07-15: ERC Events / Texas A&M / Online /
  // Off-Campus / Webinar (Featured gets no pill). ERC Events shares the star
  // with ERC Research Brief (both = "ours").
  "erc events": "star.svg",
  "texas a&m": "on-campus.svg",
  "off-campus": "off-campus.svg",
  online: "webinar.svg",
  webinar: "webinar.svg",
  // Research
  "erc research brief": "star.svg",
  "peer-reviewed": "peer-reviewed.svg",
  report: "reports.svg",
  "working paper": "working-paper.svg",
  // Headlines
  national: "us.svg",
  texas: "texas.svg",
};

// Per-tab wording for the expanded detail's outbound link.
const DETAIL_LINK_LABEL = {
  opportunity: "View opportunity",
  event: "Event details",
  research: "Read the full paper",
};

// Shared helpers for the feed templates.
const SEP = `<span class="feed-meta-sep" aria-hidden="true">·</span>`;
const iconMask = (file) =>
  `style="-webkit-mask-image:url('assets/icons/${file}');mask-image:url('assets/icons/${file}')"`;
const titleLink = (link, headline) =>
  link
    ? `<a class="feed-title-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(headline)}</a>`
    : `<span class="feed-title-link">${esc(headline)}</span>`;

// Column labels for the card table's frozen header, per tab.
// `expand: false` = rows don't expand in place; the row is a straight link to
// the source (Headlines: the blurb is just a teaser, the article is the point).
const CARD_HEADERS = {
  opportunity: { left: "Opportunity", right: "Deadline", expand: true },
  event: { left: "Event", right: "Date", expand: true },
  headline: { left: "Headline", right: "Date", expand: false },
  // Research: authors are the scan-key, so rows run three lines (title /
  // authors / source · category · date) and the date column moves off the
  // right edge — no right header label.
  research: { left: "Research", right: "", expand: true, authors: true },
};

// "A, B, C, D…" → "A, B, C, et al." for the collapsed row (full list shows in
// the expanded detail when truncated).
function shortAuthors(raw) {
  const names = raw
    .replace(/\s*&\s*/g, ", ")
    .split(/,\s*/)
    .filter(Boolean);
  if (names.length <= 3) return { text: raw, truncated: false };
  return { text: names.slice(0, 3).join(", ") + ", et al.", truncated: true };
}

// Build the card-tab toolbar: a Category group (only when there's more than one
// sub-category to choose between) and a Sort group of lighter text actions.
function renderToolbar() {
  const bar = $("#opp-toolbar");
  bar.hidden = false;
  const items = liveItemsOfType(state.type);
  const cur = activeSort();

  // Sort = lighter text actions (not boxed buttons like the category filters).
  const sortHTML = (TOOLBAR_SORTS[state.type] || [])
    .map((s) => {
      const active = cur.key === s.key && cur.dir === s.dir;
      return `<button type="button" class="tsort${active ? " is-active" : ""}" data-sortkey="${s.key}" data-sortdir="${s.dir}" aria-pressed="${active}">${esc(s.label)}</button>`;
    })
    .join(`<span class="tsort-sep" aria-hidden="true">·</span>`);
  // No visible "Sort" label — the options are self-describing; the group's
  // aria-label still announces it for assistive tech.
  const sortGroup = `
    <div class="tgroup tgroup--sort" role="group" aria-label="Sort by">
      ${sortHTML}
    </div>`;

  // Category filter buttons render on every tab — even with a single
  // sub-category — so the toolbar structure (SHOW row over SORT row) is
  // identical as you move between sections.
  const subs = sortSubtypes(distinct("subtype", items), state.type);
  const catBtns = subs
    .map((v) => {
      const active = state.subtype === v;
      return `<button type="button" class="tbtn${active ? " is-active" : ""}" data-subtype="${esc(v)}" aria-pressed="${active}">${esc(v)}</button>`;
    })
    .join("");
  // No "All" pill — clicking a category filters, and the quiet Clear text
  // action beside the pills resets to everything (dimmed until a filter is on).
  const clearBtn = `<button type="button" class="tclear" data-subtype="all"${
    state.subtype === "all" ? " disabled" : ""
  }>Clear</button>`;
  const catGroup = `
    <div class="tgroup tgroup--show" role="group" aria-label="Quick search by category">
      <span class="tgroup__label">Quick Search</span>${catBtns}${clearBtn}
    </div>`;

  bar.innerHTML = catGroup + sortGroup;
  syncToolbarHeight();
}

// Publish the sticky toolbar's height as --toolbar-h so the table header can
// dock directly beneath it (the toolbar wraps to two rows on some tabs).
function syncToolbarHeight() {
  const bar = $("#opp-toolbar");
  document.documentElement.style.setProperty(
    "--toolbar-h",
    `${bar && !bar.hidden ? bar.offsetHeight : 0}px`
  );
}

// Every tab renders as card rows: category pill above the title, source (and
// medium / authors / date) below, expanding in place to the full blurb. The
// right-hand value is the deadline (Opportunities) or the date.
function renderFeedCards(results, colorFor) {
  const isOpp = state.type === "opportunity";
  const expandable = (CARD_HEADERS[state.type] || {}).expand !== false;
  const cards = results
    .map((it, i) => {
      const link = (it.link || "").trim();
      const source = (it.source || "").trim();
      const subtype = (it.subtype || "").trim();
      const catText = subtype || (it.type || "");
      // Category = a coloured pill above the title (the .tag palette), with a
      // small icon when the subtype has one in CAT_ICONS.
      const catClass = colorFor[subtype] || "tag--c0";
      const catIcon = CAT_ICONS[catText.trim().toLowerCase()] || "";
      const catHTML = `<div class="feed-item__cat"><span class="tag ${catClass}">${
        catIcon ? `<span class="tag__icon" ${iconMask(catIcon)} aria-hidden="true"></span>` : ""
      }${esc(catText)}</span></div>`;
      const detailId = `feed-detail-${i}`;
      // Right column: Opportunities show the deadline; Events show the event date.
      const rv = isOpp
        ? parseDeadline(it.deadline)
        : { label: it.date ? formatDate(it.date) : "", firm: !!it.date, iso: it.date || "" };
      // Flag anything happening within two weeks so urgency reads at a glance.
      const soon =
        rv.firm && rv.iso >= TODAY && daysUntil(rv.iso) <= 14
          ? " feed-deadline--soon"
          : "";
      const deadlineHTML = rv.label
        ? `<span class="feed-deadline${soon}">${esc(rv.label)}</span>`
        : "";
      const titleHTML = titleLink(link, it.headline);
      const linkHTML = link
        ? `<a class="feed-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${DETAIL_LINK_LABEL[state.type] || "Read more"} ↗</a>`
        : "";
      // Events: expanded detail leads with a standardized facts panel
      // (date / time / location / register), then the summary. Each fact
      // renders only when its CSV cell is filled, so sparse rows degrade.
      const fact = (label, valueHTML) =>
        valueHTML
          ? `<div class="event-fact"><dt class="event-fact__label">${label}</dt><dd class="event-fact__value">${valueHTML}</dd></div>`
          : "";
      const eventFactsHTML =
        state.type === "event"
          ? `<dl class="event-facts">${
              fact("Date", it.date ? esc(formatDate(it.date)) : "") +
              fact("Time", esc((it.time || "").trim())) +
              fact("Location", esc((it.location || "").trim())) +
              fact(
                "Register",
                link
                  ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Event page ↗</a>`
                  : ""
              )
            }</dl>`
          : "";
      // Metadata line under the title: source · [icon] medium label (the
      // category rides in the pill above the title now). Both icon and label
      // come from the optional `medium` column; blank medium = source only.
      const med = MEDIA[(it.medium || "").trim().toLowerCase()];
      const mediumHTML = med
        ? `${SEP}<span class="feed-medium-type"><span class="feed-medium" aria-hidden="true">${med.icon}</span>${esc(med.label)}</span>`
        : "";
      const metaHTML = source
        ? `<span class="feed-source">${esc(source)}</span>${mediumHTML}`
        : "";
      const metaDivHTML = metaHTML
        ? `<div class="feed-item__meta">${metaHTML}</div>`
        : "";
      // Research: three-line row — title / authors / source · category · date.
      // The caret is the only thing on the right; the full author list rides in
      // the expanded detail when the collapsed line is truncated.
      if ((CARD_HEADERS[state.type] || {}).authors) {
        // Truncated ("…et al.") when collapsed; the same line un-truncates in
        // place on expand (CSS swaps the spans), so nothing jumps around.
        const a = shortAuthors((it.authors || "").trim());
        const authorsHTML = a.text
          ? a.truncated
            ? `<div class="feed-item__authors"><span class="authors-short">${esc(a.text)}</span><span class="authors-full">${esc(it.authors)}</span></div>`
            : `<div class="feed-item__authors">${esc(a.text)}</div>`
          : "";
        const line3 = [
          metaHTML,
          it.date
            ? `<span class="feed-meta-date">${formatDate(it.date)}</span>`
            : "",
        ]
          .filter(Boolean)
          .join(SEP);
        return `
          <li class="feed-item" data-expanded="false">
            <div class="feed-item__row">
              <div class="feed-item__body">
                ${catHTML}
                <div class="feed-item__title">${titleHTML}</div>
                ${authorsHTML}
                ${line3 ? `<div class="feed-item__meta">${line3}</div>` : ""}
              </div>
              <div class="feed-cell--due">
                <button type="button" class="feed-expand" aria-expanded="false" aria-controls="${detailId}" aria-label="Show abstract">${chevronIcon()}</button>
              </div>
            </div>
            <div class="feed-item__detail" id="${detailId}" hidden>
              <h3 class="feed-detail__label">Abstract</h3>
              <p class="feed-detail__blurb">${esc(it.blurb)}</p>
              ${linkHTML}
            </div>
          </li>`;
      }
      // Non-expandable tabs (Headlines): no caret, no detail — the whole row is
      // a straight link to the source (data-href picked up by the delegated listener).
      if (!expandable) {
        return `
          <li class="feed-item feed-item--link"${link ? ` data-href="${esc(link)}"` : ""}>
            <div class="feed-item__row">
              <div class="feed-item__body">
                ${catHTML}
                <div class="feed-item__title">${titleHTML}</div>
                ${metaDivHTML}
              </div>
              <div class="feed-cell--due">
                ${deadlineHTML}
                ${link ? `<span class="feed-goto" aria-hidden="true">↗</span>` : ""}
              </div>
            </div>
          </li>`;
      }
      return `
        <li class="feed-item" data-expanded="false">
          <div class="feed-item__row">
            <div class="feed-item__body">
              ${catHTML}
              <div class="feed-item__title">${titleHTML}</div>
              ${metaDivHTML}
            </div>
            <div class="feed-cell--due">
              ${deadlineHTML}
              <button type="button" class="feed-expand" aria-expanded="false" aria-controls="${detailId}" aria-label="Show details">${chevronIcon()}</button>
            </div>
          </div>
          <div class="feed-item__detail${eventFactsHTML ? " feed-item__detail--cols" : ""}" id="${detailId}" hidden>
            ${eventFactsHTML}
            <div class="feed-detail__main">
              <p class="feed-detail__blurb">${esc(it.blurb)}</p>
              ${eventFactsHTML ? "" : linkHTML}
            </div>
          </div>
        </li>`;
    })
    .join("");
  const head = CARD_HEADERS[state.type] || { left: "Item", right: "Date" };
  return `
    <div class="feed feed--opp">
      <div class="feed__head">
        <span class="feed__head-l">${esc(head.left)}</span>
        <span class="feed__head-r">${esc(head.right)}</span>
      </div>
      <ul class="feed__list" role="list">${cards}</ul>
    </div>`;
}

// Global search: match every live (non-expired) item in any section against
// the query, newest first. Rows are flat links out to the source, tagged with
// their section so you know where each hit lives.
function renderSearch() {
  const head = $("#section-head");
  if (head) head.hidden = true;
  $("#opp-toolbar").hidden = true;
  syncToolbarHeight();

  const q = state.q.trim();
  const results = state.items
    .filter((it) => !isExpired(it))
    .filter((it) =>
      [it.headline, it.blurb, it.source, it.authors, it.topic, it.subtype].some(
        (f) => matches(f || "", q)
      )
    )
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  $("#news-count").innerHTML = `<strong>${results.length}</strong> ${
    results.length === 1 ? "result" : "results"
  } for “${esc(q)}”`;

  const list = $("#news-list");
  if (results.length === 0) {
    list.innerHTML = `
      <div class="state">
        <strong>No matches for “${esc(q)}”</strong>
        Try a different word, or browse a section from the menu above.
      </div>`;
    return;
  }

  const sectionLabel = {};
  NEWS_TABS.forEach((t) => (sectionLabel[t.value] = t.nav));

  const rows = results
    .map((it) => {
      const link = (it.link || "").trim();
      const source = (it.source || "").trim();
      const titleHTML = titleLink(link, it.headline);
      const meta = [
        `<span class="feed-cat">${esc(sectionLabel[(it.type || "").toLowerCase()] || it.type)}</span>`,
        source ? `<span class="feed-source">${esc(source)}</span>` : "",
        it.date ? `<span class="feed-meta-date">${formatDate(it.date)}</span>` : "",
      ]
        .filter(Boolean)
        .join(SEP);
      return `
        <li class="feed-item feed-item--link"${link ? ` data-href="${esc(link)}"` : ""}>
          <div class="feed-item__row">
            <div class="feed-item__body">
              <div class="feed-item__title">${titleHTML}</div>
              <div class="feed-item__meta">${meta}</div>
            </div>
            <div class="feed-cell--due">
              ${link ? `<span class="feed-goto" aria-hidden="true">↗</span>` : ""}
            </div>
          </div>
        </li>`;
    })
    .join("");

  list.innerHTML = `
    <div class="feed feed--opp">
      <div class="feed__head">
        <span class="feed__head-l">Search Results</span>
        <span class="feed__head-r"></span>
      </div>
      <ul class="feed__list" role="list">${rows}</ul>
    </div>`;
}

function render() {
  updateNavActive();

  // The strip is identical on every page — persistent nav people learn once.
  // (The landing cards introduce; the bar is the always-there utility.)

  // Home view: show the landing page, hide the section feed, and stop.
  if (state.view === "home") {
    $("#landing").hidden = false;
    $("#section").hidden = true;
    return;
  }
  $("#landing").hidden = true;
  $("#section").hidden = false;

  // Global search view: results across every section, no per-tab toolbar.
  if (state.view === "search") {
    renderSearch();
    return;
  }

  // Section head: the tab's full title + one-line description.
  const headTab = NEWS_TABS.find((t) => t.value === state.type);
  const head = $("#section-head");
  if (head) {
    head.hidden = !headTab;
    if (headTab) {
      head.innerHTML = `<h2 class="section-head__title">${esc(headTab.label)}</h2><p class="section-head__desc">${esc(headTab.desc)}</p>`;
    }
  }

  const list = $("#news-list");
  const results = filter();
  $("#news-count").innerHTML = `<strong>${results.length}</strong> ${
    results.length === 1 ? "update" : "updates"
  }`;

  renderToolbar();

  // Give each sub-category in the active tab its own pill colour (palette in
  // styles.css; MAROON_SUBS always wear the maroon pill).
  const tabSubs = sortSubtypes(
    distinct(
      "subtype",
      state.items.filter((it) => (it.type || "").toLowerCase() === state.type)
    ),
    state.type
  );
  const colorFor = {};
  let ci = 0;
  tabSubs.forEach((s) => {
    colorFor[s] = MAROON_SUBS.has(s.trim().toLowerCase())
      ? "tag--maroon"
      : `tag--c${ci++ % 5}`;
  });

  if (results.length === 0) {
    list.innerHTML = `
      <div class="state">
        <strong>No matching updates</strong>
        Try clearing filters or picking a different category.
      </div>`;
    return;
  }

  list.innerHTML = renderFeedCards(results, colorFor);
}

// Toggle one item's detail via its caret button (the accessible expand
// control): data-expanded drives the row's collapsed/expanded styling, and the
// detail region named by aria-controls shows/hides.
function toggleDetail(caretBtn) {
  const expanded = caretBtn.getAttribute("aria-expanded") === "true";
  caretBtn.setAttribute("aria-expanded", String(!expanded));
  const item = caretBtn.closest(".feed-item");
  if (item) item.setAttribute("data-expanded", String(!expanded));
  const detail = document.getElementById(caretBtn.getAttribute("aria-controls"));
  if (detail) detail.hidden = expanded;
}

function chevronIcon() {
  return `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
}

/* ------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------ */
async function loadCSV(path) {
  // no-store so an edited CSV always shows up on refresh.
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return parseCSV(await res.text());
}

async function boot() {
  readURL();
  try {
    init(await loadCSV(NEWS_CSV));
  } catch (err) {
    // Most common cause: opened as file:// so fetch() is blocked.
    $("#news-list").innerHTML = `
      <div class="state">
        <strong>Couldn't load the feed data</strong>
        This app needs to be served over http, not opened directly from the
        file system.<br /><br />
        From the project folder, run
        <code>python3 -m http.server 8000</code>
        then visit <code>http://localhost:8000</code>.
        <br /><br />
        <span style="font-size:.85em;color:#999">(${esc(err.message)})</span>
      </div>`;
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", boot);
