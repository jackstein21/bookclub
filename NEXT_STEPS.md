# Next Steps — BookClub Setup

## 1. Disable email confirmation in Supabase (one-time, do this first)

By default Supabase requires users to confirm their email before they can sign in.
For a 2-person private app, turn this off so signup is instant:

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → your **bookclub** project
2. **Authentication → Settings → Email Auth**
3. Toggle **"Enable email confirmations"** → OFF
4. Save

## 2. Jack creates his account

1. Open the app (locally or at the GitHub Pages URL below)
2. Click **"Sign up"**
3. Enter your email + a password, select **Jack**
4. Click **Create Account** → you're in

## 3. Jordan creates her account

Same flow — send Jordan the app URL, she signs up with her email, selects **Jordan**.

> Both accounts land in the same shared club automatically. No invite codes needed.

## 4. Add your current book and deadlines

One of you adds the book you're currently reading:

1. **Books → Add Book** — title, author, total pages, spine color
2. **Deadlines → Add Deadline** — one per reading period (chapter cutoff or page stop + date)
3. Deadlines automatically create the weekly question threads

## 5. Set your starting pages

- Go to **Home** and click the page number to edit inline
- Or go to **Progress → Log Pages**

## 6. Write your starter questions

For each week's deadline:
1. **Questions → Week N**
2. Each of you writes a question for the other
3. Questions are hidden until **both** have submitted — then they reveal simultaneously

## 7. Verify sync is working

- Jack updates his page → Jordan refreshes → sees Jack's number
- Jordan writes a note → Jack navigates to Notes → sees it

Data is live in Supabase — every write goes straight to the database, no localStorage blob.

## 8. Cancel the Cloudflare Workers plan

The Worker + KV setup is no longer needed. You can cancel the $5/month plan:

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
2. Delete the `bookclub-api` Worker
3. Downgrade via **Manage Plan** or contact Cloudflare support to remove the Workers Paid subscription

## 9. Deploy latest to GitHub Pages

```bash
git add -A
git commit -m "Migrate to Supabase"
git push
```

GitHub Actions will deploy automatically (or Pages will pick up the push directly).

---

## Architecture (as of this migration)

- **Frontend**: GitHub Pages — `index.html` + `style.css` + `app.js` (plain HTML, no build step)
- **Auth + Database**: Supabase (free tier) — email/password auth, Postgres
- **No more**: Cloudflare Worker, KV, `config.js`, localStorage sync blob
- **Supabase project**: `bgafaiybnrrbpfxewppx` (org: planetstein)
- **Club ID**: `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (pre-seeded, hardcoded in `app.js`)
