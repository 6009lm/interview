// Serializace výsledků do strojově čitelných formátů.
// Modul je sdílený: používá ho prohlížeč (stažení souboru) i server (/api/search?format=…),
// takže unit testy ověřují přesně ten kód, který generuje stahované soubory.

export const CSV_COLUMNS = ['position', 'title', 'url', 'displayedUrl', 'snippet'];

export function toJson(report) {
  return JSON.stringify(report, null, 2) + '\n';
}

export function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// CSV dle RFC 4180 (oddělovač čárka, řádky CRLF, uvozovky zdvojené).
export function toCsv(report) {
  const rows = [CSV_COLUMNS, ...report.results.map((result) => CSV_COLUMNS.map((column) => result[column]))];
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

export const FORMATS = {
  json: { mime: 'application/json', extension: 'json', serialize: toJson },
  csv: { mime: 'text/csv', extension: 'csv', serialize: toCsv },
};

export function slugify(text) {
  const slug = String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'dotaz';
}

export function fileName(query, extension, date = new Date()) {
  return `serp-${slugify(query)}-${date.toISOString().slice(0, 10)}.${extension}`;
}
