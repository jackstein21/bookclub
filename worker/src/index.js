// BookClub API — Cloudflare Worker
// Handles auth, rate limiting, and read/write of app data in KV.

const DAILY_LIMIT = 90_000; // block at 90k, Cloudflare's hard limit is 100k/day

// CORS headers let browsers on any origin (GitHub Pages, localhost, etc.)
// call this Worker. Without these, the browser would block the response.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    // Browsers send a preflight OPTIONS request before any cross-origin POST.
    // We just confirm the headers are allowed and return early.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    // APP_KEY is stored as a Wrangler secret (never in source code).
    // The frontend sends it in a header on every request.
    // This isn't military-grade security, but it stops random people from
    // reading or overwriting your book club data.
    if (request.headers.get('X-App-Key') !== env.APP_KEY) {
      return new Response('Unauthorized', { status: 401, headers: CORS });
    }

    // ── Rate limiting ─────────────────────────────────────────────────────
    // We track daily request counts in KV under keys like "requests:2026-05-11".
    // The key expires after 48 hours (expirationTtl) so old counters clean up automatically.
    // We check BEFORE processing so a blocked request doesn't still consume quota.
    const today    = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const countKey = `requests:${today}`;
    const count    = parseInt(await env.DATA.get(countKey) || '0');

    if (count >= DAILY_LIMIT) {
      return json({
        error:   'daily_limit_reached',
        count,
        limit:   DAILY_LIMIT,
        resets:  'midnight UTC',
      }, 429);
    }

    // Increment counter. We don't await this — fire-and-forget saves ~5ms of
    // latency. If it occasionally drops a count, that's fine for a safety net.
    // TTL of 172800s = 48 hours ensures keys self-delete after they've expired.
    env.DATA.put(countKey, String(count + 1), { expirationTtl: 172800 });

    // ── Routes ────────────────────────────────────────────────────────────
    const { pathname } = new URL(request.url);

    // GET /api/data — fetch the entire app state
    // Called once on page load by each device to get the latest shared data.
    if (pathname === '/api/data' && request.method === 'GET') {
      const data = await env.DATA.get('appdata', { type: 'json' });
      return json(data || {});
    }

    // POST /api/data — save the entire app state
    // Called whenever anything changes (book added, page logged, question answered).
    // Storing everything as one blob keeps KV writes to a minimum.
    if (pathname === '/api/data' && request.method === 'POST') {
      const body = await request.json();
      await env.DATA.put('appdata', JSON.stringify(body));
      return json({ ok: true, requests_today: count + 1 });
    }

    // GET /api/status — check daily usage (used by the frontend warning banner)
    if (pathname === '/api/status' && request.method === 'GET') {
      return json({
        requests_today: count + 1,
        daily_limit:    DAILY_LIMIT,
        remaining:      DAILY_LIMIT - count - 1,
        warning:        count > DAILY_LIMIT * 0.8, // true if over 80%
      });
    }

    return new Response('Not Found', { status: 404, headers: CORS });
  },
};
