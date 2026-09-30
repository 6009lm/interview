import { FORMATS, fileName } from './export.js';

const form = document.querySelector('#search-form');
const input = document.querySelector('#query');
const submit = form.querySelector('button[type="submit"]');
const section = document.querySelector('#results');
const summary = document.querySelector('#summary');
const list = document.querySelector('#result-list');
const status = document.querySelector('#status');

let currentReport = null;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function renderResult(result) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = result.url;
  link.textContent = result.title;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';

  const url = document.createElement('span');
  url.className = 'displayed-url';
  url.textContent = result.displayedUrl;

  const snippet = document.createElement('p');
  snippet.className = 'snippet';
  snippet.textContent = result.snippet;

  item.append(link, url, snippet);
  return item;
}

function render(report) {
  currentReport = report;
  list.replaceChildren(...(report?.results ?? []).map(renderResult));
  section.hidden = !report;
  if (!report) return;

  summary.textContent = `${report.resultCount} organických výsledků pro „${report.query}“`;
  if (report.provider === 'mock') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'ukázková data';
    summary.append(badge);
  }
  setStatus(report.resultCount ? '' : 'Google pro tento dotaz nevrátil žádné organické výsledky.');
}

function download(format) {
  if (!currentReport) return;
  const { mime, extension, serialize } = FORMATS[format];
  const blob = new Blob([serialize(currentReport)], { type: `${mime};charset=utf-8` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName(currentReport.query, extension, new Date(currentReport.searchedAt));
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const query = input.value.trim();
  if (!query) return input.focus();

  submit.disabled = true;
  setStatus('Hledám…');
  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Chyba serveru (${response.status}).`);
    render(data);
  } catch (err) {
    render(null);
    setStatus(err.message, true);
  } finally {
    submit.disabled = false;
  }
});

for (const button of document.querySelectorAll('[data-format]')) {
  button.addEventListener('click', () => download(button.dataset.format));
}
