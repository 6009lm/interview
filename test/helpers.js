import { readFile } from 'node:fs/promises';

export async function loadFixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

// Náhrada za globální fetch: zaznamená volání a vrátí připravenou odpověď.
export function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

export const sampleReport = {
  query: 'káva praha',
  searchedAt: '2026-09-30T08:00:00.000Z',
  provider: 'serpapi',
  locale: { gl: 'cz', hl: 'cs' },
  resultCount: 2,
  results: [
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
      snippet: 'Seznam kaváren,\nkteré stojí za to navštívit.',
    },
  ],
};
