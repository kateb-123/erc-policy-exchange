/* ============================================================
 * app.js — ERC Policy Exchange
 * ============================================================
 * A filterable feed of education opportunities, new policy
 * research, headlines, and upcoming (non-ERC) events. Everything
 * is CSV-driven: edit data/news.csv, reload, done.
 *
 * Interaction: category tabs across the top pick the stream; the
 * left rail (search + sub-category) refines within it. Cards expand
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
  sort: null, // {key,dir} once a sort is chosen; null = per-tab default
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
  rebuildSubtypes();

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

  bindSelect("#news-subtype", "subtype");

  // Opportunities-only sort toggle (Newest ⇄ Closing soon). Other tabs keep
  // their sortable column headers, so this control is hidden for them.
  $("#news-sort").addEventListener("change", (e) => {
    state.sort =
      e.target.value === "closing"
        ? { key: "deadline", dir: "asc" }
        : { key: "date", dir: "desc" };
    render();
  });

  // Card-tab toolbar: sort text actions + category "view" buttons.
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
  });

  // Re-measure the sticky toolbar when the viewport changes (it can re-wrap).
  window.addEventListener("resize", syncToolbarHeight);

  $("#news-reset").addEventListener("click", () => {
    Object.assign(state, { subtype: "all", q: "" });
    $("#news-search").value = "";
    rebuildSubtypes();
    render();
    writeURL();
  });

  render();
}

// Wire a rail <select> to a key on state.
function bindSelect(sel, key) {
  const el = $(sel);
  el.value = state[key];
  el.addEventListener("change", () => {
    state[key] = el.value;
    render();
    writeURL();
  });
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
      <span class="lcard__icon" aria-hidden="true"><span class="lcard__glyph" style="-webkit-mask-image:url('assets/icons/${t.icon}');mask-image:url('assets/icons/${t.icon}')"></span></span>
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
function setType(type) {
  state.view = "section";
  state.type = type;
  state.subtype = "all";
  state.sort = null; // each section starts at its sensible default sort
  clearSearch();
  rebuildSubtypes();
  render();
  writeURL();
  window.scrollTo(0, 0);
}

// Return to the landing page.
function setHome() {
  state.view = "home";
  clearSearch();
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

// Kate's per-tab subtype order (2026-07-15) — drives the SHOW button order AND
// the colour cycle (1st non-maroon subtype = navy, then gold, teal, purple,
// orange). Lowercase; both singular/plural spellings listed where labels
// changed. Subtypes not listed here sink to the end alphabetically.
const SUBTYPE_ORDER = {
  event: ["erc event", "erc events", "texas a&m", "online", "online/webinar", "webinar", "off-campus"],
  research: ["erc research brief", "working paper", "working papers", "peer-reviewed", "report", "reports"],
  headline: ["texas", "national"],
  opportunity: ["call for proposals", "calls for proposals", "fellowships & programs", "funding & grants"],
};
function sortSubtypes(subs, type) {
  const order = SUBTYPE_ORDER[(type || "").toLowerCase()] || [];
  const rank = (s) => {
    const i = order.indexOf(s.trim().toLowerCase());
    return i === -1 ? order.length : i;
  };
  return [...subs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function fillSelect(el, allLabel, values, current) {
  el.innerHTML =
    `<option value="all">${esc(allLabel)}</option>` +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el.value = values.includes(current) ? current : "all";
}

// Sub-category options = the newsletter groups within the active category.
function rebuildSubtypes() {
  const items = state.items.filter(
    (it) => (it.type || "").toLowerCase() === state.type && !isExpired(it)
  );
  const subs = sortSubtypes(distinct("subtype", items), state.type);
  const sel = $("#news-subtype");
  fillSelect(sel, "All sub-categories", subs, state.subtype);
  state.subtype = sel.value; // may have reset to "all" if now invalid
  sel.disabled = subs.length === 0;
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

// The sort in effect: the user's chosen column, or the per-tab default (by
// date — soonest-first for Upcoming Events, newest-first for everything else).
function activeSort() {
  return (
    state.sort || { key: "date", dir: state.type === "event" ? "asc" : "desc" }
  );
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
  const valueOf = (it) => {
    if (key === "title") return (it.headline || "").toLowerCase();
    if (key === "category") return (it.subtype || "").toLowerCase();
    if (key === "source") return (it.source || "").toLowerCase();
    return it.date || ""; // date
  };
  return (a, b) => {
    const va = valueOf(a);
    const vb = valueOf(b);
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  };
}

// Click a column header to sort by it; click the same one again to flip.
function setSort(key) {
  const cur = state.sort;
  const dir =
    cur && cur.key === key
      ? cur.dir === "asc"
        ? "desc"
        : "asc"
      : key === "date"
      ? "desc"
      : "asc";
  state.sort = { key, dir };
  render();
}

// A sortable <th>: a button that sorts by `key`, with aria-sort + an arrow.
function sortHeader(key, label) {
  const s = activeSort();
  const active = s.key === key;
  const ariaSort = active ? (s.dir === "asc" ? "ascending" : "descending") : "none";
  const arrow = active ? (s.dir === "asc" ? " ▲" : " ▼") : "";
  return `<th scope="col" aria-sort="${ariaSort}">
            <button type="button" class="feed-sort${active ? " is-active" : ""}" data-key="${key}">${esc(label)}<span class="feed-sort__arrow" aria-hidden="true">${arrow}</span></button>
          </th>`;
}

// Whole days from today to an ISO date (used for the "closing soon" cue).
function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = TODAY.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}

// Show/hide the Opportunities sort toggle and keep it matched to the active
// sort. Only Opportunities uses it; the other tabs sort via column headers.
function syncSortControl() {
  const el = $("#news-sort");
  if (!el) return;
  const isOpp = state.type === "opportunity";
  el.hidden = !isOpp;
  if (isOpp) el.value = activeSort().key === "deadline" ? "closing" : "newest";
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
const MEDIUM_LABELS = {
  newspaper: "Article",
  radio: "Radio",
  tv: "TV",
  opinion: "Opinion",
  blog: "Blog",
};
const MEDIUM_ICONS = {
  newspaper:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z"/></svg>',
  radio:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>',
  tv:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z"/></svg>',
  opinion:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"/></svg>',
  blog:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"/></svg>',
};

// Small icons inside the category pills — FEED ROWS ONLY (the SHOW filter
// pills stay text-only). Keyed by lowercase subtype → an SVG in assets/icons/
// (Kate's own set, 2026-07-15). Rendered via CSS mask so the icon takes the
// pill's colour; swap/edit the SVG files and the app picks them up as-is.
// Unknown subtypes simply get no icon, so new CSV categories degrade
// gracefully.
const CAT_ICONS = {
  // Opportunities (singular + plural keys — labels went singular 2026-07-15)
  "call for proposals": "megaphone.svg",
  "calls for proposals": "megaphone.svg",
  "fellowships & programs": "fellowships-programs.svg",
  "funding & grants": "grants.svg",
  // Events — subtypes per Kate 2026-07-15: ERC Events / Texas A&M / Online /
  // Off-Campus / Webinar (Featured gets no pill). ERC Events shares the star
  // with ERC Research Brief (both = "ours").
  "erc event": "star.svg",
  "erc events": "star.svg",
  "texas a&m": "on-campus.svg",
  "off-campus": "off-campus.svg",
  online: "webinar.svg",
  webinar: "webinar.svg",
  // Research
  "erc research brief": "star.svg",
  "peer-reviewed": "peer-reviewed.svg",
  report: "reports.svg",
  reports: "reports.svg",
  "working paper": "working-paper.svg",
  "working papers": "working-paper.svg",
  // Headlines
  national: "us.svg",
  texas: "texas.svg",
};

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

// Tabs using the card layout get a button toolbar (category views + sort text)
// instead of the search box + dropdowns. Swap which one is visible per tab.
function syncToolbars() {
  const usesToolbar = !!TOOLBAR_SORTS[state.type];
  $(".filter-bar").hidden = usesToolbar;
  $("#opp-toolbar").hidden = !usesToolbar;
  if (usesToolbar) {
    // No search on these tabs — clear any stray query from another tab.
    state.q = "";
    $("#news-search").value = "";
    renderToolbar();
  }
}

// Build the card-tab toolbar: a Category group (only when there's more than one
// sub-category to choose between) and a Sort group of lighter text actions.
function renderToolbar() {
  const bar = $("#opp-toolbar");
  const items = state.items.filter(
    (it) => (it.type || "").toLowerCase() === state.type && !isExpired(it)
  );
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

// Opportunities & Events render as two-line cards: title + a right-hand date on
// the first line, category · source on the second, expanding to the full blurb.
// The right-hand value is the deadline (Opportunities) or the event date
// (Events). Distinct from the column table Research/Headlines still use.
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
        catIcon
          ? `<span class="tag__icon" style="-webkit-mask-image:url('assets/icons/${catIcon}');mask-image:url('assets/icons/${catIcon}')" aria-hidden="true"></span>`
          : ""
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
      const titleHTML = link
        ? `<a class="feed-title-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(it.headline)}</a>`
        : `<span class="feed-title-link">${esc(it.headline)}</span>`;
      // Detail-link label says what you actually get, per tab.
      const linkLabel =
        { opportunity: "View opportunity", event: "Event details", research: "Read the full paper" }[state.type] ||
        "Read more";
      const linkHTML = link
        ? `<a class="feed-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${linkLabel} ↗</a>`
        : "";
      // Metadata line under the title: source · [icon] medium label (the
      // category rides in the pill above the title now). Both icon and label
      // come from the optional `medium` column; blank medium = source only.
      const medKey = (it.medium || "").trim().toLowerCase();
      const medIcon = MEDIUM_ICONS[medKey] || "";
      const medLabel = MEDIUM_LABELS[medKey] || "";
      const mediumHTML =
        medIcon && medLabel
          ? `<span class="feed-meta-sep" aria-hidden="true">·</span><span class="feed-medium-type"><span class="feed-medium" aria-hidden="true">${medIcon}</span>${esc(medLabel)}</span>`
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
          .join(`<span class="feed-meta-sep" aria-hidden="true">·</span>`);
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
      // a straight link to the source (data-href picked up in wireRows).
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
          <div class="feed-item__detail" id="${detailId}" hidden>
            <p class="feed-detail__blurb">${esc(it.blurb)}</p>
            ${linkHTML}
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
  $(".filter-bar").hidden = true;
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
      const titleHTML = link
        ? `<a class="feed-title-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(it.headline)}</a>`
        : `<span class="feed-title-link">${esc(it.headline)}</span>`;
      const meta =
        `<span class="feed-cat feed-cat--c0">${esc(sectionLabel[(it.type || "").toLowerCase()] || it.type)}</span>` +
        (source
          ? `<span class="feed-meta-sep" aria-hidden="true">·</span><span class="feed-source">${esc(source)}</span>`
          : "") +
        (it.date
          ? `<span class="feed-meta-sep" aria-hidden="true">·</span><span class="feed-meta-date">${formatDate(it.date)}</span>`
          : "");
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
  wireRows(list);
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

  syncSortControl();
  syncToolbars();

  // Give each sub-category in the active tab its own pill colour (palette in
  // styles.css). ERC's own + Texas subtypes always wear the solid Aggie-maroon
  // pill (Kate's rule); the rest cycle the 5-colour palette per tab so colours
  // stay distinct within a view.
  const MAROON_SUBS = new Set(["erc event", "erc events", "erc research brief", "texas"]);
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

  // Opportunities & Events use the two-line card layout; Research & Headlines
  // keep the column table (for now).
  if (TOOLBAR_SORTS[state.type]) {
    list.innerHTML = renderFeedCards(results, colorFor);
    wireRows(list);
    return;
  }

  const rows = results
    .map((it, i) => {
      const type = (it.type || "").toLowerCase();
      const link = (it.link || "").trim();
      const source = (it.source || "").trim();
      const subtype = (it.subtype || "").trim();
      const detailId = `feed-detail-${i}`;
      // The active tab already tells you the category, so the pill shows the
      // sub-category (Funding & Grants, Webinar, Working Papers, Federal…),
      // each in its own colour. Falls back to the type if no subtype.
      const pillText = subtype || type;
      const pillClass = colorFor[subtype] || "tag--c0";
      // Detail-link label says what you actually get, per tab.
      const linkLabel =
        { opportunity: "View opportunity", event: "Event details", research: "Read the full paper" }[state.type] ||
        "Read more";
      const linkHTML = link
        ? `<a class="feed-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${linkLabel} ↗</a>`
        : "";
      // Title links straight to the source (the primary action); the row / caret
      // still expands the summary.
      const titleHTML = link
        ? `<a class="feed-title-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(it.headline)}</a>`
        : esc(it.headline);
      return `
        <tr class="feed-row">
          <td class="feed-cell-title">${titleHTML}</td>
          <td class="feed-cell-cat"><span class="tag ${pillClass}">${esc(pillText)}</span></td>
          <td class="feed-cell-source">${esc(source)}</td>
          <td class="feed-cell-date">${formatDate(it.date)}</td>
          <td class="feed-cell-caret">
            <button type="button" class="feed-expand" aria-expanded="false" aria-controls="${detailId}" aria-label="Show summary">${chevronIcon()}</button>
          </td>
        </tr>
        <tr class="feed-detail" id="${detailId}" hidden>
          <td colspan="5">
            <p class="feed-detail__blurb">${esc(it.blurb)}</p>
            ${linkHTML}
          </td>
        </tr>`;
    })
    .join("");

  list.innerHTML = `
    <div class="feed-scroll">
      <table class="feed-table">
        <colgroup>
          <col class="col-title" />
          <col class="col-cat" />
          <col class="col-source" />
          <col class="col-date" />
          <col class="col-caret" />
        </colgroup>
        <thead>
          <tr>
            ${sortHeader("title", "Title")}
            ${sortHeader("category", "Category")}
            ${sortHeader("source", "Source")}
            ${sortHeader("date", "Date")}
            <th scope="col"><span class="sr-only">Summary</span></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  wireRows(list);
}

// Toggle one item's detail via its caret button (the accessible expand
// control). Works for both the table rows and the Opportunity cards: the card's
// data-expanded drives its collapsed/expanded styling; both reveal the detail
// region named by aria-controls.
function toggleDetail(caretBtn) {
  const expanded = caretBtn.getAttribute("aria-expanded") === "true";
  caretBtn.setAttribute("aria-expanded", String(!expanded));
  const item = caretBtn.closest(".feed-item");
  if (item) item.setAttribute("data-expanded", String(!expanded));
  const detail = document.getElementById(caretBtn.getAttribute("aria-controls"));
  if (detail) detail.hidden = expanded;
}

function wireRows(root) {
  // The caret button is the accessible expand control (keyboard-operable).
  $$(".feed-expand", root).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDetail(btn);
    });
  });
  // Clicking elsewhere on the row/card also expands (a bigger target); clicks on
  // the title link or the caret do their own thing.
  $$(".feed-row, .feed-item__row", root).forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("a") || e.target.closest(".feed-expand")) return;
      const caret = row.querySelector(".feed-expand");
      if (caret) toggleDetail(caret);
      // Link-only rows (Headlines): the whole row goes straight to the source.
      const linkItem = row.closest(".feed-item--link");
      if (linkItem && linkItem.dataset.href) {
        window.open(linkItem.dataset.href, "_blank", "noopener");
      }
    });
  });
  // Sortable column headers (table tabs only).
  $$(".feed-sort", root).forEach((btn) => {
    btn.addEventListener("click", () => setSort(btn.dataset.key));
  });
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
