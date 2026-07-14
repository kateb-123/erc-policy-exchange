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

// Single source of truth for what's shown.
const state = {
  items: [],
  type: NEWS_TABS[0].value, // active category tab (defaults to the first)
  subtype: "all", // sub-category dropdown (scoped to the active tab)
  q: "",
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
    (it) => (it.type || "").toLowerCase() === state.type
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
    const subOk = subtype === "all" || (it.subtype || "").trim() === subtype;
    const qOk =
      !q.trim() ||
      matches(it.headline || "", q) ||
      matches(it.blurb || "", q) ||
      matches(it.source || "", q);
    return typeOk && subOk && qOk;
  });
  out.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  return out;
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

  list.innerHTML = results
    .map((it, i) => {
      const type = (it.type || "").toLowerCase();
      const link = (it.link || "").trim();
      const source = (it.source || "").trim();
      const subtype = (it.subtype || "").trim();
      const bodyId = `news-body-${i}`;
      // The active tab already tells you the category, so the pill shows the
      // sub-category (Funding & Grants, Webinar, Working Papers, Federal…),
      // each in its own colour. Falls back to the type if no subtype.
      const pillText = subtype || type;
      const pillClass = colorFor[subtype] || "tag--c0";
      const sourceHTML = source
        ? `<span class="news-item__source">Source: ${esc(source)}</span>`
        : "";
      const linkHTML = link
        ? `<a class="news-item__link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Read the source ↗</a>`
        : "";
      return `
        <article class="news-item">
          <button
            type="button"
            class="news-item__summary"
            aria-expanded="false"
            aria-controls="${bodyId}"
          >
            <span class="news-item__heading">
              <span class="news-item__top">
                <span class="tag ${pillClass}">${esc(pillText)}</span>
                <time class="news-item__date" datetime="${esc(it.date)}">${formatDate(
        it.date
      )}</time>
              </span>
              <span class="news-item__headline">${esc(it.headline)}</span>
              ${sourceHTML}
            </span>
            ${chevronIcon()}
          </button>
          <div class="news-item__body" id="${bodyId}" hidden>
            <p class="news-item__blurb">${esc(it.blurb)}</p>
            ${linkHTML}
          </div>
        </article>`;
    })
    .join("");

  wireExpanders(list, ".news-item__summary");
}

// Toggle a summary button's expanded state and show/hide its body panel.
function wireExpanders(root, summarySelector) {
  $$(summarySelector, root).forEach((btn) => {
    btn.addEventListener("click", () => {
      const expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      const body = document.getElementById(btn.getAttribute("aria-controls"));
      if (body) body.hidden = expanded;
    });
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
