/* ============================================================
 * csv.js — a small, dependency-free CSV parser
 * ============================================================
 * WHY THIS EXISTS:
 * The whole site is CSV-driven. This file turns the raw text
 * of a .csv file into an array of plain JS objects keyed by
 * the header row — e.g. { date: "...", headline: "...", ... }.
 *
 * It correctly handles the tricky parts of real CSVs:
 *   - fields wrapped in "double quotes"
 *   - commas inside quoted fields
 *   - escaped quotes written as "" inside a quoted field
 *   - newlines inside quoted fields
 *   - Windows (\r\n) or Unix (\n) line endings
 *
 * Nothing else in the app needs to know how CSV works — it
 * just calls parseCSV(text) and gets clean rows back.
 * ============================================================ */

/**
 * Parse CSV text into an array of row objects keyed by header.
 * @param {string} text - raw CSV file contents
 * @returns {Array<Object>} rows
 */
function parseCSV(text) {
  const rows = parseCSVToArrays(text);
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const out = [];

  // Every row after the header becomes an object keyed by header name.
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    // Skip fully blank lines (a common trailing artifact in spreadsheets).
    if (cells.length === 1 && cells[0].trim() === "") continue;

    const obj = {};
    headers.forEach((key, idx) => {
      obj[key] = (cells[idx] ?? "").trim();
    });
    out.push(obj);
  }
  return out;
}

/**
 * Lower-level parser: CSV text -> array of arrays (rows of cells).
 * Implemented as a small state machine so quotes and embedded
 * commas / newlines are handled correctly.
 */
function parseCSVToArrays(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        // Escaped quote: "" -> a single literal quote.
        field += '"';
        i++; // consume the second quote
      } else if (char === '"') {
        inQuotes = false; // closing quote
      } else {
        field += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true; // opening quote
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char === "\r") {
        // Ignore CR; the following LF (if any) ends the row.
      } else {
        field += char;
      }
    }
  }

  // Flush the final field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
