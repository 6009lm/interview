import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SearchError,
  cleanResults,
  configFromEnv,
  createCachedSearch,
  mockResults,
  normalizeSerpApi,
  normalizeSerper,
  searchOrganic,
} from '../src/search.js';
import { fakeFetch, loadFixture } from './helpers.js';

const serpapiConfig = { provider: 'serpapi', apiKey: 'test-key', gl: 'cz', hl: 'cs' };
const serperConfig = { provider: 'serper', apiKey: 'test-key', gl: 'cz', hl: 'cs' };
const fixedNow = () => new Date('2026-09-30T08:00:00.000Z');

describe('normalizeSerpApi', () => {
  it('vrátí pouze platné organické výsledky seřazené a přečíslované', async () => {
    const results = normalizeSerpApi(await loadFixture('serpapi.json'));
    assert.deepEqual(results, [
      {
        position: 1,
        title: 'Káva Praha – pražírna',
        url: 'https://prazirna.example.com/',
        displayedUrl: 'https://prazirna.example.com',
        snippet: 'Čerstvě pražená káva.',
      },
      {
        position: 2,
        title: 'Nejlepší kavárny v Praze, "top" výběr',
        url: 'https://www.example.cz/kavarny',
        displayedUrl: 'https://www.example.cz › kavarny',
        snippet: 'Seznam kaváren, které stojí za to navštívit.',
      },
      {
        position: 3,
        title: 'Kafe na Letné',
        url: 'https://letna.example.org/kafe/',
        displayedUrl: 'letna.example.org/kafe',
        snippet: 'Výběrová káva.',
      },
    ]);
  });

  it('nezahrne reklamy ani „Lidé se také ptají“', async () => {
    const urls = normalizeSerpApi(await loadFixture('serpapi.json')).map((r) => r.url);
    assert.ok(!urls.includes('https://ads.example.net/kava'));
    assert.ok(!urls.includes('https://questions.example.org/kava'));
  });

  it('pro odpověď bez organických výsledků vrátí prázdné pole', () => {
    assert.deepEqual(normalizeSerpApi({}), []);
    assert.deepEqual(normalizeSerpApi(null), []);
  });
});

describe('normalizeSerper', () => {
  it('převede odpověď Serper.dev na jednotnou strukturu bez reklam a sitelinků', async () => {
    assert.deepEqual(normalizeSerper(await loadFixture('serper.json')), [
      {
        position: 1,
        title: 'Káva Praha – pražírna',
        url: 'https://prazirna.example.com/',
        displayedUrl: 'prazirna.example.com',
        snippet: 'Čerstvě pražená káva.',
      },
      {
        position: 2,
        title: 'Nejlepší kavárny v Praze',
        url: 'https://www.example.cz/kavarny',
        displayedUrl: 'www.example.cz/kavarny',
        snippet: 'Seznam kaváren.',
      },
    ]);
  });
});

describe('cleanResults', () => {
  it('zahodí záznamy bez titulku a výsledky bez pozice zařadí na konec', () => {
    const results = cleanResults([
      { title: 'Bez pozice', url: 'https://c.example' },
      { position: 2, title: '', url: 'https://b.example' },
      { position: 1, title: 'První', url: 'https://a.example' },
    ]);
    assert.deepEqual(results.map((r) => [r.position, r.title]), [[1, 'První'], [2, 'Bez pozice']]);
  });
});

describe('searchOrganic', () => {
  it('zavolá SerpApi se správnými parametry a vrátí report', async () => {
    const { fetchImpl, calls } = fakeFetch(await loadFixture('serpapi.json'));
    const report = await searchOrganic('  káva praha ', serpapiConfig, { fetchImpl, now: fixedNow });

    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.origin + url.pathname, 'https://serpapi.com/search.json');
    assert.equal(url.searchParams.get('engine'), 'google');
    assert.equal(url.searchParams.get('q'), 'káva praha');
    assert.equal(url.searchParams.get('gl'), 'cz');
    assert.equal(url.searchParams.get('hl'), 'cs');
    assert.equal(url.searchParams.get('api_key'), 'test-key');

    assert.equal(report.query, 'káva praha');
    assert.equal(report.searchedAt, '2026-09-30T08:00:00.000Z');
    assert.equal(report.provider, 'serpapi');
    assert.deepEqual(report.locale, { gl: 'cz', hl: 'cs' });
    assert.equal(report.resultCount, 3);
    assert.equal(report.results.length, 3);
  });

  it('zavolá Serper.dev přes POST s API klíčem v hlavičce', async () => {
    const { fetchImpl, calls } = fakeFetch(await loadFixture('serper.json'));
    const report = await searchOrganic('káva praha', serperConfig, { fetchImpl, now: fixedNow });

    assert.equal(calls[0].url, 'https://google.serper.dev/search');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers['X-API-KEY'], 'test-key');
    assert.deepEqual(JSON.parse(calls[0].init.body), { q: 'káva praha', gl: 'cz', hl: 'cs' });
    assert.equal(report.resultCount, 2);
  });

  it('prázdný dotaz odmítne s chybou 400 bez volání API', async () => {
    const { fetchImpl, calls } = fakeFetch({});
    await assert.rejects(searchOrganic('   ', serpapiConfig, { fetchImpl }), { name: 'SearchError', status: 400 });
    assert.equal(calls.length, 0);
  });

  it('bez API klíče skončí chybou', async () => {
    await assert.rejects(searchOrganic('káva', { ...serpapiConfig, apiKey: undefined }), /Chybí API klíč/);
  });

  it('neznámého poskytovatele odmítne', async () => {
    await assert.rejects(searchOrganic('káva', { ...serpapiConfig, provider: 'toString' }), /Neznámý poskytovatel/);
  });

  it('chybu HTTP od poskytovatele převede na SearchError 502', async () => {
    const { fetchImpl } = fakeFetch({ error: 'Invalid API key.' }, { status: 401 });
    await assert.rejects(searchOrganic('káva', serpapiConfig, { fetchImpl }), (err) => {
      assert.ok(err instanceof SearchError);
      assert.equal(err.status, 502);
      assert.match(err.message, /401: Invalid API key/);
      return true;
    });
  });

  it('výpadek sítě převede na SearchError 502', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNRESET');
    };
    await assert.rejects(searchOrganic('káva', serpapiConfig, { fetchImpl }), { name: 'SearchError', status: 502 });
  });

  it('když Google nic nenajde, vrátí prázdný seznam místo chyby', async () => {
    const { fetchImpl } = fakeFetch({ error: "Google hasn't returned any results for this query." });
    const report = await searchOrganic('xqzv', serpapiConfig, { fetchImpl });
    assert.equal(report.resultCount, 0);
    assert.deepEqual(report.results, []);
  });

  it('jinou chybu v těle odpovědi SerpApi ohlásí', async () => {
    const { fetchImpl } = fakeFetch({ error: 'Your account has run out of searches.' });
    await assert.rejects(searchOrganic('káva', serpapiConfig, { fetchImpl }), /run out of searches/);
  });

  it('mock poskytovatel vrátí 10 výsledků bez volání sítě', async () => {
    const report = await searchOrganic('káva', { provider: 'mock', gl: 'cz', hl: 'cs' }, {
      fetchImpl: () => assert.fail('mock nesmí volat síť'),
    });
    assert.equal(report.resultCount, 10);
    assert.deepEqual(report.results, mockResults('káva'));
  });
});

describe('configFromEnv', () => {
  it('bez klíčů použije mock a výchozí lokalizaci cz/cs', () => {
    assert.deepEqual(configFromEnv({}), { provider: 'mock', apiKey: undefined, gl: 'cz', hl: 'cs' });
  });

  it('podle dostupného klíče zvolí poskytovatele', () => {
    assert.equal(configFromEnv({ SERPAPI_KEY: 'a' }).provider, 'serpapi');
    assert.equal(configFromEnv({ SERPER_API_KEY: 'b' }).provider, 'serper');
    assert.deepEqual(configFromEnv({ SERP_PROVIDER: 'Serper', SERPAPI_KEY: 'a', SERPER_API_KEY: 'b', SEARCH_GL: 'sk' }), {
      provider: 'serper',
      apiKey: 'b',
      gl: 'sk',
      hl: 'cs',
    });
  });
});

describe('createCachedSearch', () => {
  it('stejný dotaz v rámci TTL nevolá API znovu', async () => {
    let calls = 0;
    let time = 0;
    const cached = createCachedSearch(async (q) => ({ q, n: ++calls }), { ttlMs: 1000, now: () => time });

    assert.deepEqual(await cached('Káva'), { q: 'Káva', n: 1 });
    assert.deepEqual(await cached(' káva '), { q: 'Káva', n: 1 });
    time = 1000;
    assert.deepEqual(await cached('káva'), { q: 'káva', n: 2 });
  });

  it('chybu necachuje', async () => {
    let calls = 0;
    const cached = createCachedSearch(async () => {
      calls += 1;
      throw new Error('fail');
    });
    await assert.rejects(cached('a'));
    await assert.rejects(cached('a'));
    assert.equal(calls, 2);
  });
});
