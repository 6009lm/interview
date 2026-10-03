# Google SERP export

Webová stránka s jedním vstupním polem. Po zadání klíčového slova vrátí organické (neplacené) výsledky
1. strany Google** a nabídne jejich stažení ve strojově čitelném formátu **JSON** nebo **CSV**.

Projekt nemá žádné npm závislosti – stačí Node.js 22+ (nebo Docker).

## Jak to funguje

```
prohlížeč (public/)            server (server.js)              SERP API
┌──────────────────┐  GET     ┌────────────────────┐  HTTPS   ┌──────────────────┐
│ input + tlačítko │ ───────▶ │ /api/search?q=…    │ ───────▶ │ SerpApi / Serper │ ──▶ Google
│ výpis výsledků   │ ◀─────── │ validace, cache    │ ◀─────── │ (JSON)           │
│ stáhnout JSON/CSV│  JSON    │ normalizace        │          └──────────────────┘
└──────────────────┘          └────────────────────┘
```

1. **`public/index.html` + `app.js`**: formulář s jedním inputem, zavolá `/api/search`, zobrazí výsledky
   a přes tlačítka vygeneruje soubor ke stažení přímo v prohlížeči.
2. **`server.js`**: jednoduchý HTTP server (bez frameworku). Obsluhuje statické soubory a endpoint
   `GET /api/search?q=<dotaz>[&format=json|csv]`. S parametrem `format` vrací soubor jako přílohu.
3. **`src/search.js`**: zavolá SERP API, z odpovědi vezme **pouze organické výsledky** (reklamy,
   „Lidé se také ptají“, sitelinky apod. vynechá), odstraní neplatné a duplicitní záznamy a přečísluje je.
   Výsledky se 10 minut drží v paměti, aby opakované dotazy nespotřebovávaly kredity API.
4. **`public/export.js`**: převod do JSON a CSV (RFC 4180). Modul je sdílený pro prohlížeč i server,
   takže testy ověřují přesně ten kód, který generuje stahované soubory.

### Proč přes SERP API a ne přímým stahováním google.com?

Google automatizované požadavky blokuje (CAPTCHA, HTTP 429) a od roku 2025 zobrazuje výsledky jen
s JavaScriptem. Samotné stahování HTML z google.com proto na serveru spolehlivě nefunguje.
SERP API (SerpApi, Serper.dev) vrací stejnou 1. stranu Google jako strukturovaná data, organické
výsledky v samostatném poli. Poskytovatel se volí proměnnou prostředí a přidat další je otázka jedné funkce.

## Výstupní formát

JSON:

```json
{
  "query": "káva praha",
  "searchedAt": "2026-09-30T08:00:00.000Z",
  "provider": "serpapi",
  "locale": { "gl": "cz", "hl": "cs" },
  "resultCount": 10,
  "results": [
    {
      "position": 1,
      "title": "…",
      "url": "https://…",
      "displayedUrl": "https://… › …",
      "snippet": "…"
    }
  ]
}
```

CSV obsahuje sloupce `position,title,url,displayedUrl,snippet` (UTF-8, oddělovač čárka).

## Spuštění

### Konfigurace

```bash
cp .env.example .env   # doplňte SERPAPI_KEY nebo SERPER_API_KEY
```

| Proměnná | Význam | Výchozí |
|---|---|---|
| `SERPAPI_KEY` | klíč k [SerpApi](https://serpapi.com) | – |
| `SERPER_API_KEY` | klíč k [Serper.dev](https://serper.dev) | – |
| `SERP_PROVIDER` | `serpapi` / `serper` / `mock` | podle zadaného klíče, jinak `mock` |
| `SEARCH_GL`, `SEARCH_HL` | země a jazyk Google | `cz`, `cs` |
| `PORT` | port serveru | `3000` |

Bez klíče aplikace běží s poskytovatelem `mock` (ukázková data), aby šla vyzkoušet i offline.

### Docker Compose (lokální vývoj)

```bash
docker compose up                 # http://localhost:3000, restart při změně kódu
docker compose run --rm test      # unit testy
```

### Bez Dockeru (Node.js 22+)

```bash
export $(grep -v '^#' .env | xargs)   # načtení klíčů z .env
npm start                             # http://localhost:3000
npm test
```

## Testy

`node:test`, bez závislostí (`npm test`). Pokrývají:

- **správnost výstupu**: přesný obsah JSON a CSV včetně escapování čárek, uvozovek, nových řádků a diakritiky,
  název souboru;
- **parsování odpovědí API**: jen organické výsledky (bez reklam a PAA), řazení, přečíslování, vyřazení
  neplatných URL (`javascript:`), duplicit a záznamů bez odkazu;
- **volání API**: správné parametry pro SerpApi i Serper.dev (API volání jsou mockovaná), chyby HTTP,
  výpadek sítě, prázdné výsledky, chybějící klíč;
- **HTTP server**: `/api/search` v JSON i CSV, validace vstupu, stránka s jedním inputem, ochrana proti
  path traversal.

Testy běží i v GitHub Actions (`.github/workflows/test.yml`).

## Nasazení (Render.com, zdarma)

1. Nahrát repozitář na GitHub.
2. Na [render.com](https://render.com): **New → Blueprint** a vybrat repozitář (použije `render.yaml` a `Dockerfile`).
3. V nastavení služby doplnit `SERPAPI_KEY`.

Aplikace je jeden Docker kontejner a naslouchá na `PORT`, takže jde nasadit i na Railway, Fly.io
nebo Google Cloud Run beze změn.

## Struktura

```
server.js              HTTP server + /api/search
src/search.js          SERP API poskytovatelé, normalizace, cache
public/index.html      stránka s jedním inputem
public/app.js          logika stránky
public/export.js       export JSON/CSV (sdílený se serverem)
public/styles.css
test/                  unit testy + fixtures odpovědí API
Dockerfile, docker-compose.yml, render.yaml
```
