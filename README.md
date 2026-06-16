# World Cup 2026 Dashboard

A fast, dependency-free dashboard for following the 2026 FIFA World Cup — live fixtures,
official group standings, knockout bracket, top scorers, a player directory, match-level
lineups/formations/stats, and a built-in data-integrity ("Verify") view.

Two front-ends share **one data engine**:

| File | What it is |
|------|------------|
| `index.html` | Desktop / wide-screen app (tabbed) |
| `mobile.html` | iPhone-first app (bottom tab bar, swipe, bottom sheets) — installable as a PWA |
| `wc-engine.js` | **The single shared data engine** — all fetching, normalizing, and computing. No DOM/render. |
| `tests.html` | Browser test runner: unit tests over the engine + a live-data integration check |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | PWA service worker, manifest, icons |
| `start.command` | Double-click launcher (serves over `http://`) |

## Running it

Browsers block `fetch()` from `file://`, so serve it over HTTP:

```bash
./start.command          # or: python3 -m http.server 8000
```

Then open <http://localhost:8000/index.html> (or `/mobile.html`).

**Install on iPhone:** host the folder over HTTPS (e.g. drag it onto
[Netlify Drop](https://app.netlify.com/drop)), open the URL in Safari →
Share → *Add to Home Screen*.

## Data sources

Everything is **real data, keyless, no API key required.**

- **Primary — ESPN** (`site.api.espn.com` + `sports.core.api.espn.com`): the entire
  backbone. Fixtures + scores (`scoreboard` over a date range), official groups + live
  standings (`standings`), and per-match detail (`summary`: lineups, formations,
  team stats, goalscorers, rosters → top scorers / player directory; `athletes/{id}` →
  player bios). CORS-enabled and not rate-limited in practice.
- **Secondary — TheSportsDB** (free shared key `3`): used **only** by the Verify tab's
  cross-source check, as an *independent* provider to confirm ESPN's scorelines.

> History: the app originally ran on TheSportsDB, but its shared free key rate-limits
> (HTTP 429), so the core was migrated to ESPN. See `MEMORY`/commit history.

## Architecture

- `wc-engine.js` owns **state** (`FIXTURES`, `GROUPS`, `SCORERS`, `PLAYERS`, `STATS`, caches)
  and **logic** (`loadData`, `loadStandings`, `loadScorers`, `loadStats`, `loadPlayers`,
  ESPN summary parsing, `runInvariants`). It renders nothing.
- Each front-end provides its own render + event wiring + `init()` and calls the engine.
- Match summaries are fetched **once per match** (promise-deduped cache) and shared by the
  three enrichers (scorers / stats / players).

### Reliability / fail-safes
- `getJSON` retries on network errors and HTTP 429 with exponential back-off.
- A refresh failure never blanks the screen (last-good data stays); a global error
  boundary shows a "tap to reload" banner only if there's genuinely no data.
- Auto-refresh every 3 min; the service worker caches the app shell (never API responses).

## Testing

Open **`tests.html`** (served over HTTP). It runs the unit suite on load (engine logic:
date/UTC parsing, ESPN normalization + stage tagging, roster parsing, integrity
invariants, formation layout, cross-source matching…) and shows a green/red report.
Click **"Run live data check"** to hit ESPN live and assert *12 groups, 48 teams, all
invariants pass*.

The **Verify** tab inside the app runs the same integrity invariants continuously and
offers a one-click ESPN-vs-TheSportsDB scoreline cross-check, plus raw-JSON links so you
can confirm any number against the source yourself.
