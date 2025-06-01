/* ------------------------------------------------------------------ */
/*  middleware/cache.js  –  serve-stale-while-refresh edge cache      */
/* ------------------------------------------------------------------ */

import { json } from "../utils/response.js";

const MAX_AGE   = 10;          // how long a value is “fresh” (seconds)
const inflight  = new Map();   // url → Promise (deduplicate refresh work)

const canon = url => { const u = new URL(url); u.searchParams.sort(); return u; };

export async function withEdgeCache (request, event, compute) {
  const cache  = caches.default;
  const keyReq = new Request(canon(request.url));   // GET only, bodyless key
  const urlKey = keyReq.url;

  /* ── 1) try worker-side cache ───────────────────────────────────── */
  const cached = await cache.match(keyReq);
  if (cached) {
    const age = (Date.now() - Number(cached.headers.get("X-Gen") || 0)) / 1000;

    // stale? kick background refresh (but only once)
    if (age > MAX_AGE && !inflight.has(urlKey)) {
      inflight.set(urlKey, true);
      queueMicrotask(() =>
        event.waitUntil(refresh(cache, keyReq, compute)
          .finally(() => inflight.delete(urlKey)))
      );
    }

    const h = new Headers(cached.headers);
    h.set("X-Worker-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers: h });
  }

  /* ── 2) no entry – compute once (caller waits) ─────────────────── */
  const fresh = await safeCompute(compute);
  await storeIfGood(cache, keyReq, fresh);
  const h = stampHeaders(fresh.headers);
  h.set("X-Worker-Cache", "MISS");
  return new Response(fresh.body, { status: fresh.status, headers: h });
}

/* ---------- helpers ------------------------------------------------ */

async function safeCompute(fn) {
  try { return await fn(); }
  catch (e) { return json({ error: e.message || "Internal error" }, { status: 500 }); }
}

function stampHeaders(src) {
  const h = new Headers(src);
  /*  IMPORTANT:  “private” stops Cloudflare’s HTTP cache             */
  h.set("Cache-Control", `private, max-age=0`);
  h.set("X-Gen", Date.now().toString());
  return h;
}

async function storeIfGood(cache, keyReq, resp) {
  if (resp.status >= 500) return;                 // don’t cache errors
  const buf = await resp.clone().arrayBuffer();   // read once
  const toCache = new Response(buf, { status: resp.status,
                                      headers: stampHeaders(resp.headers) });
  await cache.put(keyReq, toCache);
}

async function refresh(cache, keyReq, compute) {
  const fresh = await safeCompute(compute);
  await storeIfGood(cache, keyReq, fresh);
}
