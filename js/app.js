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
const NEWS_TABS = [
  { value: "opportunity", label: "Opportunities" },
  { value: "event", label: "Upcoming Events" },
  { value: "research", label: "New education policy research" },
  { value: "headline", label: "Education headlines" },
];

// Today (YYYY-MM-DD). Upcoming Events drop off automatically once their date
// passes, so the feed stays current with no manual pruning.
const TODAY = new Date().toISOString().slice(0, 10);
const isPastEvent = (it) =>
  (it.type || "").toLowerCase() === "event" && (it.date || "") < TODAY;

// Single source of truth for what's shown.
const state = {
  items: [],
  type: NEWS_TABS[0].value, // active category tab (defaults to the first)
  subtype: "all", // sub-category dropdown (scoped to the active tab)
  q: "",
  sort: null, // {key,dir} once a column header is clicked; null = per-tab default
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

/* ------------------------------------------------------------
 * URL <-> state
 * ------------------------------------------------------------ */
function readURL() {
  const p = new URLSearchParams(window.location.search);
  const type = (p.get("type") || "").toLowerCase();
  if (NEWS_TABS.some((t) => t.value === type)) state.type = type;
  state.q = p.get("q") || "";
  state.subtype = p.get("subtype") || "all";
}

function writeURL() {
  const p = new URLSearchParams();
  if (state.type !== NEWS_TABS[0].value) p.set("type", state.type);
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.subtype !== "all") p.set("subtype", state.subtype);
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

  buildTabs();
  rebuildSubtypes();

  $("#news-search").value = state.q;
  $("#news-search").addEventListener("input", (e) => {
    state.q = e.target.value;
    render();
    writeURL();
  });

  bindSelect("#news-subtype", "subtype");

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
 * Category tabs
 * ------------------------------------------------------------ */
function buildTabs() {
  const el = $("#news-tabs");
  const counts = {};
  state.items.forEach((it) => {
    if (isPastEvent(it)) return; // past events aren't counted
    const t = (it.type || "").toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
  });

  el.innerHTML = NEWS_TABS.map((t) => {
    const count = counts[t.value] || 0;
    return `
      <button
        type="button"
        class="news-tab"
        role="tab"
        data-type="${t.value}"
        aria-selected="${state.type === t.value}"
      >
        <span>${esc(t.label)}</span>
        <span class="news-tab__count">${count}</span>
      </button>`;
  }).join("");

  el.addEventListener("click", (e) => {
    const btn = e.target.closest(".news-tab");
    if (btn) setType(btn.dataset.type);
  });
}

// Switch the active category tab. Sub-category is tab-specific, so it resets.
function setType(type) {
  state.type = type;
  state.subtype = "all";
  state.sort = null; // each tab starts at its sensible default sort
  $$("#news-tabs .news-tab").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.type === type))
  );
  rebuildSubtypes();
  render();
  writeURL();
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

function fillSelect(el, allLabel, values, current) {
  el.innerHTML =
    `<option value="all">${esc(allLabel)}</option>` +
    values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el.value = values.includes(current) ? current : "all";
}

// Sub-category options = the newsletter groups within the active category.
function rebuildSubtypes() {
  const items = state.items.filter(
    (it) => (it.type || "").toLowerCase() === state.type && !isPastEvent(it)
  );
  const subs = distinct("subtype", items);
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
    if (!typeOk || isPastEvent(it)) return false; // past events drop off
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

function render() {
  const list = $("#news-list");
  const results = filter();
  $("#news-count").innerHTML = `<strong>${results.length}</strong> ${
    results.length === 1 ? "update" : "updates"
  }`;

  // Give each sub-category in the active tab its own pill colour (palette in
  // styles.css). Assigned per tab so colours are always distinct within a view.
  const tabSubs = distinct(
    "subtype",
    state.items.filter((it) => (it.type || "").toLowerCase() === state.type)
  );
  const colorFor = {};
  tabSubs.forEach((s, i) => (colorFor[s] = `tag--c${i % 6}`));

  if (results.length === 0) {
    list.innerHTML = `
      <div class="state">
        <strong>No matching updates</strong>
        Try clearing filters or picking a different category.
      </div>`;
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
      const linkHTML = link
        ? `<a class="feed-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Read the source ↗</a>`
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

// Toggle one row's detail via its caret button (the accessible expand control).
function toggleDetail(caretBtn) {
  const expanded = caretBtn.getAttribute("aria-expanded") === "true";
  caretBtn.setAttribute("aria-expanded", String(!expanded));
  const detail = document.getElementById(caretBtn.getAttribute("aria-controls"));
  if (detail) detail.hidden = expanded;
}

function wireRows(root) {
  // The caret button is the accessible expand control (keyboard-operable).
  $$(".feed-expand", root).forEach((btn) => {
    btn.addEventListener("click", () => toggleDetail(btn));
  });
  // Clicking elsewhere on the row also expands (a bigger target); clicks on the
  // title link or the caret do their own thing.
  $$(".feed-row", root).forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("a") || e.target.closest(".feed-expand")) return;
      const caret = row.querySelector(".feed-expand");
      if (caret) toggleDetail(caret);
    });
  });
  // Sortable column headers.
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
