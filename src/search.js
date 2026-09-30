// Získání organických (neplacených) výsledků 1. strany Google.
//
// Google přímé stahování HTML výsledků blokuje (CAPTCHA, od 2025 vyžaduje JavaScript),
// proto se výsledky získávají přes SERP API, které vrací již rozparsovanou stránku.
// Placené výsledky (ads), "Lidé se také ptají", mapy apod. jsou v odpovědi API v samostatných
// polích, takže do výstupu jde pouze pole organických výsledků.

const REQUEST_TIMEOUT_MS = 15_000;
const SERPAPI_NO_RESULTS = /hasn't returned any results/i;

export class SearchError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'SearchError';
    this.status = status;
  }
}

export function configFromEnv(env = process.env) {
  const provider = (
    env.SERP_PROVIDER || (env.SERPAPI_KEY ? 'serpapi' : env.SERPER_API_KEY ? 'serper' : 'mock')
  ).trim().toLowerCase();
  const apiKey = { serpapi: env.SERPAPI_KEY, serper: env.SERPER_API_KEY }[provider];
  return { provider, apiKey, gl: env.SEARCH_GL || 'cz', hl: env.SEARCH_HL || 'cs' };
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function parseHttpUrl(value) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Sjednotí výsledky z libovolného poskytovatele: zahodí neplatné záznamy a duplicity,
// seřadí podle pozice na stránce a přečísluje od 1.
export function cleanResults(items) {
  const byPosition = [...items].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  const seen = new Set();
  const results = [];
  for (const item of byPosition) {
    const url = parseHttpUrl(item.url);
    const title = cleanText(item.title);
    if (!url || !title || seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({
      position: results.length + 1,
      title,
      url: cleanText(item.url),
      displayedUrl: cleanText(item.displayedUrl) || url.hostname + url.pathname.replace(/\/$/, ''),
      snippet: cleanText(item.snippet),
    });
  }
  return results;
}

export function normalizeSerpApi(data) {
  return cleanResults(
    (data?.organic_results ?? []).map((r) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      displayedUrl: r.displayed_link,
      snippet: r.snippet,
    })),
  );
}

export function normalizeSerper(data) {
  return cleanResults(
    (data?.organic ?? []).map((r) => ({
      position: r.position,
      title: r.title,
      url: r.link,
      snippet: r.snippet,
    })),
  );
}

export function mockResults(query) {
  return cleanResults(
    Array.from({ length: 10 }, (_, i) => ({
      position: i + 1,
      title: `Ukázkový výsledek ${i + 1} pro „${query}“`,
      url: `https://example.com/${i + 1}?q=${encodeURIComponent(query)}`,
      snippet: 'Ukázková data – nastavte SERPAPI_KEY nebo SERPER_API_KEY pro skutečné výsledky z Google.',
    })),
  );
}

async function requestJson(fetchImpl, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new SearchError(`Vyhledávací služba je nedostupná (${err.message}).`, 502);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.error || data?.message;
    throw new SearchError(`Vyhledávací služba vrátila chybu ${response.status}${detail ? `: ${detail}` : ''}.`, 502);
  }
  if (!data || typeof data !== 'object') {
    throw new SearchError('Vyhledávací služba vrátila neplatnou odpověď.', 502);
  }
  return data;
}

const PROVIDERS = {
  async serpapi(query, config, fetchImpl) {
    const url = new URL('https://serpapi.com/search.json');
    url.search = new URLSearchParams({
      engine: 'google',
      q: query,
      gl: config.gl,
      hl: config.hl,
      api_key: config.apiKey,
    }).toString();
    const data = await requestJson(fetchImpl, url);
    if (data.error && !SERPAPI_NO_RESULTS.test(data.error)) {
      throw new SearchError(`SerpApi: ${data.error}`, 502);
    }
    return normalizeSerpApi(data);
  },

  async serper(query, config, fetchImpl) {
    const data = await requestJson(fetchImpl, 'https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: config.gl, hl: config.hl }),
    });
    return normalizeSerper(data);
  },

  async mock(query) {
    return mockResults(query);
  },
};

export async function searchOrganic(query, config, { fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) throw new SearchError('Klíčové slovo nesmí být prázdné.', 400);
  if (!Object.hasOwn(PROVIDERS, config.provider)) {
    throw new SearchError(`Neznámý poskytovatel vyhledávání: ${config.provider}.`, 500);
  }
  if (config.provider !== 'mock' && !config.apiKey) {
    throw new SearchError(`Chybí API klíč pro poskytovatele ${config.provider}.`, 500);
  }

  const results = await PROVIDERS[config.provider](q, config, fetchImpl);
  return {
    query: q,
    searchedAt: now().toISOString(),
    provider: config.provider,
    locale: { gl: config.gl, hl: config.hl },
    resultCount: results.length,
    results,
  };
}

// Krátkodobá cache šetří kredity SERP API při opakovaném hledání stejného dotazu.
export function createCachedSearch(search, { ttlMs = 10 * 60_000, maxEntries = 100, now = Date.now } = {}) {
  const cache = new Map();
  return async (query) => {
    const key = query.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;

    const value = await search(query);
    cache.delete(key);
    cache.set(key, { at: now(), value });
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  };
}
