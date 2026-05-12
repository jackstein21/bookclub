# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A 2-person book club app for Jack and Jordan. No build step — plain HTML/CSS/JS served statically (GitHub Pages), with a Cloudflare Worker + KV backend for cross-device sync.

## Running locally

Open `index.html` directly in a browser, or serve it with any static server:

```bash
npx serve .        # from /BookClub
```

For the Worker backend (from `/BookClub/worker`):

```bash
npx wrangler dev   # local Worker + KV simulation
npx wrangler deploy
```

Wrangler is installed as a local dev dependency — always use `npx wrangler`, not a global install.

## Deploying the Worker (one-time setup)

```bash
cd worker
npx wrangler kv namespace create DATA        # copy the ID into wrangler.toml
npx wrangler secret put APP_KEY              # set the shared auth secret
npx wrangler deploy
```

Then update `API_URL` and `APP_KEY` at the top of `app.js` with the deployed Worker URL and the secret you set.

## Architecture

**Frontend** (`index.html` + `style.css` + `app.js`): Single-page app with hash-based routing (`#/path`). No framework, no build. `app.js` is ~1400 lines organized in clearly labeled sections.

**Backend** (`worker/src/index.js`): ~90-line Cloudflare Worker. Three endpoints: `GET /api/data`, `POST /api/data`, `GET /api/status`. Auth via `X-App-Key` header. Rate-limited at 90k requests/day via a KV counter.

**Data flow**: Every `DB.*` write goes to `localStorage` immediately, then calls `Sync.push()` (fire-and-forget POST to the Worker). On page load, `Sync.pull()` fetches remote and overwrites local — remote is the single source of truth. The entire app state is one JSON blob stored under KV key `appdata`.

**`app.js` structure** (in order):
- `DB` — localStorage CRUD, all keys prefixed `bc_`
- `Sync` — `pull()` / `push()` to Cloudflare Worker
- Utils — `cap`, `other`, `fmtDate`, `daysUntil`, `getWeeks`, `blankQuestion`, `daysChip`
- Router — `handleRoute()` dispatches hash → page function
- Render — `renderWithShell()` builds the full layout (sidebar + content); `renderFull()` for auth screen
- Page functions — one per route: `pageDashboard`, `pageBooks`, `pageBookForm`, `pageDeadlines`, `pageAddDeadline`, `pageProgress`, `pageQuestions`, `pageWeekQuestions`, `pageNotes`, `pageUserSelect`
- Action handlers — `saveCustomQ`, `submitAnswers`, `addNote`, `deleteNote`, `saveBook`, `deleteBook`, etc.
- Init — `seedDefaultData()` + `DOMContentLoaded` async handler

**Users**: Hardcoded to `'jack'` and `'jordan'`. `other(user)` returns the other one. No real auth — just a picker screen that writes to `bc_user` in localStorage.

**Questions mechanic**: Each week has a `blankQuestion` object with `jackWroteForJordan` and `jordanWroteForJack` fields. Custom questions are only revealed (`questionForMe`) once **both** parties have written theirs (`bothWrote = !!(jackQ && jordanQ)`).

**Deadlines → Weeks**: Deadlines are stored per-book. `getWeeks(bookId)` derives the week list from sorted deadlines — a week's `weekId` is just the deadline's `id`.

**CSS**: Design system defined via CSS custom properties at the top of `style.css` — Colorado nature palette (`--pine`, `--sky`, `--aspen`, `--stone`, `--cream`) + semantic tokens (`--text-1/2/3`, `--border`, `--bg`). Mobile layout (`max-width: 768px`) hides the sidebar and shows a bottom tab nav.
