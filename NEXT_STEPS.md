# Next Steps — BookClub

## Setup (done)

- [x] Supabase project + schema live
- [x] Email/password auth
- [x] Jack's account created
- [x] Jordan's account created
- [x] The Lean Startup + 5 deadlines entered
- [x] Deployed to GitHub Pages

## Still needed

### Cancel the Cloudflare Workers plan
The Worker + KV setup is fully replaced. Drop the $5/month:
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → delete `bookclub-api`
2. Downgrade via **Manage Plan** or contact Cloudflare support

---

## Backlog (things discussed, not yet built)

### Cadence visualization
`progress_history` already logs every forward page update with a timestamp.
When ready, the query is: pull history for a book, group by user + date, chart daily pages read vs. deadline pace.
Could live on the Progress page as a simple sparkline or bar chart.

### Book history / library tracking
Original schema vision included tracking when each user *started* and *finished* a book — so you'd have a shelf of completed reads with dates. Currently the DB has no `started_at` / `finished_at` per user. Would need a `library` join table (account × book with start/end dates) or columns added to the current schema.

---

## Architecture

- **Frontend**: GitHub Pages — `index.html` + `style.css` + `app.js` (plain HTML, no build step)
- **Auth + Database**: Supabase free tier — email/password auth, Postgres with RLS
- **Progress logging**: forward-only — page must be higher than current to write to `progress_history`
- **Supabase project**: `bgafaiybnrrbpfxewppx` (org: planetstein)
- **Club ID**: `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (pre-seeded, hardcoded in `app.js`)
