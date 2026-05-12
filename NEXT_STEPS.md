# Next Steps — BookClub Setup

## 1. Get Jordan on the app

- Send him the URL: https://jackstein21.github.io/bookclub/
- He opens the app and picks **Jordan** — no setup needed, `config.js` is already in the repo
- Sync.pull() will load the shared state automatically
- Confirm you can both see the same progress numbers after he's in

## 2. Add the reading deadlines

Both of you agreed on deadlines — one of you needs to enter them in the app:

1. Go to **Deadlines → Add Deadline**
2. Add one entry per reading period (chapter cutoff or page stop + date)
3. Label each clearly (e.g. "Ch. 1–5", "p. 1–80", etc.)
4. These automatically create the weekly question threads

Do this before writing questions — the weeks don't exist until deadlines are added.

## 3. Write your starter questions

Once deadlines are in, each week has a question thread. For each week:

1. Go to **Questions → Week N**
2. Each of you writes a custom question for the other
3. Questions are hidden until **both** of you have submitted — then they reveal simultaneously
4. You can pre-write questions for upcoming weeks before the deadline arrives

A good starter question covers something specific to that section — a decision a character made, an idea you want the other person to sit with, something that surprised you.

## 4. Set your starting page

Both of you are currently at page 0. Update your real starting page:

- Go to **Home** and click the page number to edit inline
- Or go to **Progress** and log from there

## 5. Verify sync is working for both users

Once Jordan is set up, do a quick end-to-end check:

- Jack updates his page → Jordan refreshes → Jordan sees Jack's new number
- Jordan writes a question → Jack refreshes → Jack sees the "Waiting for Jordan" badge flip

If anything doesn't update, a manual refresh always pulls the latest from Cloudflare.

---

## Future (when you're ready to scale)

- Migrate backend from Cloudflare Workers + KV → **Supabase**
- Schema: `clubs`, `accounts`, `books`, `library` (user ↔ book with start/end dates)
- Proper per-user auth so the app can support more than two people
- Book history tracked relationally rather than as a flat blob
