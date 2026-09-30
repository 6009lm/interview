import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, fileName } from './public/export.js';
import { SearchError, configFromEnv, createCachedSearch, searchOrganic } from './src/search.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_QUERY_LENGTH = 256;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function handleSearch(url, res, search) {
  const query = (url.searchParams.get('q') ?? '').trim();
  if (!query) return sendJson(res, 400, { error: 'Zadejte klíčové slovo (parametr q).' });
  if (query.length > MAX_QUERY_LENGTH) {
    return sendJson(res, 400, { error: `Klíčové slovo může mít nejvýše ${MAX_QUERY_LENGTH} znaků.` });
  }

  const format = url.searchParams.get('format');
  if (format !== null && !Object.hasOwn(FORMATS, format)) {
    return sendJson(res, 400, { error: `Nepodporovaný formát „${format}“. Povolené: ${Object.keys(FORMATS).join(', ')}.` });
  }

  let report;
  try {
    report = await search(query);
  } catch (err) {
    if (err instanceof SearchError) return sendJson(res, err.status, { error: err.message });
    throw err;
  }

  if (format === null) return sendJson(res, 200, report);

  const { mime, extension, serialize } = FORMATS[format];
  res.writeHead(200, {
    'Content-Type': `${mime}; charset=utf-8`,
    'Content-Disposition': `attachment; filename="${fileName(query, extension, new Date(report.searchedAt))}"`,
    'Cache-Control': 'no-store',
  });
  res.end(serialize(report));
}

async function serveStatic(pathname, res) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  const filePath = path.resolve(PUBLIC_DIR, decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendText(res, 404, 'Not found');

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return sendText(res, 404, 'Not found');
    throw err;
  }
}

export function createServer({ config = configFromEnv(), search } = {}) {
  const runSearch = search ?? createCachedSearch((query) => searchOrganic(query, config));

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      if (url.pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
      if (url.pathname === '/api/search') return await handleSearch(url, res, runSearch);
      return await serveStatic(url.pathname, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Interní chyba serveru.' });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const config = configFromEnv();
  createServer({ config }).listen(port, () => {
    console.log(`Server běží na http://localhost:${port} (poskytovatel: ${config.provider})`);
    if (config.provider === 'mock') {
      console.log('Není nastaven SERPAPI_KEY ani SERPER_API_KEY – vrací se ukázková data.');
    }
  });
}
