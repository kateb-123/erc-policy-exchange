# ERC Policy Exchange

A filterable, spreadsheet-driven feed for the Texas A&M **Education Research Center** — education **opportunities**, **new policy research**, **education headlines**, and **upcoming (non-ERC) events**, mirroring the ERC newsletter's timely sections.

**Live:** https://kateb-123.github.io/erc-policy-exchange/

## How it works

All content lives in **`data/news.csv`**. Edit the spreadsheet, reload, done — no code changes.

Columns:

| Column | What it is |
|---|---|
| `date` | ISO date (`YYYY-MM-DD`); the feed sorts by it |
| `headline` | the item title |
| `link` | URL for "Read the source" |
| `type` | the category tab: `opportunity` · `research` · `headline` · `event` |
| `subtype` | the newsletter group (e.g. Funding & Grants, Federal, Working Papers) |
| `source` | the outlet / publication / host (left-rail filter) |
| `topic` | cross-cutting topic (left-rail filter) |
| `blurb` | the short description shown when a card is expanded |

## Interaction

- **Category tabs** across the top pick the stream.
- The **left rail** (Search · Source · Topic · Sub-category · Sort by date) refines within the active tab. Sub-category rescopes to the current category's groups.
- Cards **expand in place** to reveal the blurb + link.
- Deep-linkable: `?type=opportunity`, `?topic=…`, `?source=…`, `?subtype=…`, `?sort=oldest`, `?q=…` — so a newsletter can link straight to a filtered view.

## Run locally

It fetches the CSV, so it must be served over http (not opened as a file):

```
python3 -m http.server 8000
```

then open http://localhost:8000.

## Files

- `index.html` — the page
- `css/styles.css` — styling (Texas A&M maroon, Work Sans / Open Sans)
- `js/csv.js` — a tiny dependency-free CSV parser
- `js/app.js` — render / filter / URL-sync
- `data/news.csv` — the content
