import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { SearchError } from '../src/search.js';
import { toCsv } from '../public/export.js';
import { sampleReport } from './helpers.js';

describe('HTTP server', () => {
  let server;
  let baseUrl;
  const searchedQueries = [];

  before(async () => {
    server = createServer({
      search: async (query) => {
        searchedQueries.push(query);
        if (query === 'limit') throw new SearchError('Vyčerpán limit.', 502);
        return sampleReport;
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET /api/search vrátí JSON report', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(' káva praha ')}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await res.json(), sampleReport);
    assert.equal(searchedQueries.at(-1), 'káva praha');
  });

  it('format=csv vrátí CSV jako přílohu ke stažení', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=k%C3%A1va%20praha&format=csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv/);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="serp-kava-praha-2026-09-30.csv"');
    assert.equal(await res.text(), toCsv(sampleReport));
  });

  it('format=json vrátí JSON jako přílohu ke stažení', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=kava&format=json`);
    assert.equal(res.headers.get('content-disposition'), 'attachment; filename="serp-kava-2026-09-30.json"');
    assert.deepEqual(await res.json(), sampleReport);
  });

  it('chybějící dotaz vrátí 400', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=%20`);
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  });

  it('příliš dlouhý dotaz vrátí 400', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=${'a'.repeat(257)}`);
    assert.equal(res.status, 400);
  });

  it('nepodporovaný formát (např. html) vrátí 400', async () => {
    for (const format of ['html', 'toString']) {
      const res = await fetch(`${baseUrl}/api/search?q=kava&format=${format}`);
      assert.equal(res.status, 400);
    }
  });

  it('chybu vyhledávání předá klientovi se stavem a zprávou', async () => {
    const res = await fetch(`${baseUrl}/api/search?q=limit`);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Vyčerpán limit.' });
  });

  it('servíruje HTML stránku s jedním vstupním polem', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.equal(html.match(/<input\b/g).length, 1);
  });

  it('servíruje sdílený exportní modul pro prohlížeč', async () => {
    const res = await fetch(`${baseUrl}/export.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
  });

  it('nepustí požadavek mimo složku public', async () => {
    const res = await fetch(`${baseUrl}/..%2fpackage.json`);
    assert.equal(res.status, 404);
  });

  it('healthcheck vrátí ok', async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});
