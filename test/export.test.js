import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, FORMATS, csvEscape, fileName, slugify, toCsv, toJson } from '../public/export.js';
import { sampleReport } from './helpers.js';

describe('toJson', () => {
  it('vrátí validní JSON, který se načte zpět na identická data', () => {
    const output = toJson(sampleReport);
    assert.deepEqual(JSON.parse(output), sampleReport);
  });

  it('obsahuje dotaz, čas, počet a výsledky v očekávané struktuře', () => {
    const parsed = JSON.parse(toJson(sampleReport));
    assert.deepEqual(Object.keys(parsed), ['query', 'searchedAt', 'provider', 'locale', 'resultCount', 'results']);
    assert.equal(parsed.resultCount, parsed.results.length);
    for (const result of parsed.results) assert.deepEqual(Object.keys(result), CSV_COLUMNS);
  });
});

describe('csvEscape', () => {
  it('nechá jednoduchý text beze změny', () => {
    assert.equal(csvEscape('Káva Praha'), 'Káva Praha');
    assert.equal(csvEscape(3), '3');
  });

  it('uzavře do uvozovek text s čárkou, uvozovkou nebo novým řádkem', () => {
    assert.equal(csvEscape('a,b'), '"a,b"');
    assert.equal(csvEscape('řekl "ahoj"'), '"řekl ""ahoj"""');
    assert.equal(csvEscape('řádek 1\nřádek 2'), '"řádek 1\nřádek 2"');
  });

  it('převede null a undefined na prázdný řetězec', () => {
    assert.equal(csvEscape(null), '');
    assert.equal(csvEscape(undefined), '');
  });
});

describe('toCsv', () => {
  it('vytvoří hlavičku a jeden řádek na výsledek (RFC 4180, CRLF)', () => {
    assert.equal(
      toCsv(sampleReport),
      [
        'position,title,url,displayedUrl,snippet',
        '1,Káva Praha – pražírna,https://prazirna.example.com/,https://prazirna.example.com,Čerstvě pražená káva.',
        '2,"Nejlepší kavárny v Praze, ""top"" výběr",https://www.example.cz/kavarny,https://www.example.cz › kavarny,"Seznam kaváren,\nkteré stojí za to navštívit."',
        '',
      ].join('\r\n'),
    );
  });

  it('pro prázdné výsledky vrátí jen hlavičku', () => {
    assert.equal(toCsv({ ...sampleReport, resultCount: 0, results: [] }), 'position,title,url,displayedUrl,snippet\r\n');
  });
});

describe('fileName', () => {
  it('odstraní diakritiku a nepovolené znaky, přidá datum a příponu', () => {
    assert.equal(fileName('Káva / Praha?', 'csv', new Date('2026-09-30T08:00:00Z')), 'serp-kava-praha-2026-09-30.csv');
  });

  it('pro dotaz bez písmen použije náhradní název', () => {
    assert.equal(slugify('???'), 'dotaz');
  });

  it('zkrátí dlouhý dotaz na nejvýše 60 znaků', () => {
    assert.ok(slugify('a'.repeat(200)).length <= 60);
  });
});

describe('FORMATS', () => {
  it('nabízí pouze strojově čitelné formáty (ne HTML)', () => {
    assert.deepEqual(Object.keys(FORMATS), ['json', 'csv']);
    for (const { mime } of Object.values(FORMATS)) assert.notEqual(mime, 'text/html');
  });
});
