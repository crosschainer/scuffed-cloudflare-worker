/* ------------------------------------------------------------------ */
/*  Edge cache with SWR + in-flight dedup, safe for JSON bodies       */
/* ------------------------------------------------------------------ */

import { json } from "../utils/response.js";

const FRESH_SECONDS = 10;          // serve from cache while younger
const STALE_SECONDS = 60 * 60;     // serve stale while we refresh

const inflight = new Map();        // url → Promise<Response>
const canon = url => { const u = new URL(url); u.searchParams.sort(); return u; };

/**
 * Wrap a handler with:  fresh-cache → stale-while-revalidate → refresh
 */
export async function withEdgeCache (request, event, compute) {
  const cache  = caches.default;
  const keyReq = new Request(canon(request.url));   // immutable key
  const keyUrl = keyReq.url;

  /* ── fast path: worker cache hit ───────────────────────────────── */
  const cached = await cache.match(keyReq);
  if (cached) {
    const age = (Date.now() - Number(cached.headers.get("X-Gen") || 0)) / 1000;

    if (age > FRESH_SECONDS && age < FRESH_SECONDS + STALE_SECONDS
        && !inflight.has(keyUrl)) {
      // kick async refresh; caller still gets current copy
      inflight.set(keyUrl, true);
      queueMicrotask(() =>
        event.waitUntil(refresh(cache, keyReq, compute)
          .finally(() => inflight.delete(keyUrl)))
      );
    }
    return mark(cached, "HIT");
  }

  /* ── slow path: compute (deduplicated) ─────────────────────────── */
  if (inflight.has(keyUrl)) return mark(await inflight.get(keyUrl), "HIT");

  const p = refresh(cache, keyReq, compute)
              .finally(() => inflight.delete(keyUrl));
  inflight.set(keyUrl, p);
  return mark(await p, "MISS");
}

/* ---------- helpers ------------------------------------------------ */

function mark(resp, txt) {
  const h = new Headers(resp.headers);
  h.set("X-Worker-Cache", txt);
  return new Response(resp.body, { status: resp.status, headers: h });
}

async function refresh(cache, keyReq, compute) {
  let r;
  try { r = await compute(); }
  catch (e) { return json({ error: e.message || "Internal error" }, { status: 500 }); }

  // read once → immutable buffer (avoids “body already used”)
  const buf = await r.arrayBuffer();

  const stamp = () => {
    const h = new Headers(r.headers);
    h.set("Cache-Control", "private, max-age=0");
    h.set("X-Gen", Date.now().toString());
    return h;
  };

  const forCaller = new Response(buf.slice(0), { status: r.status, headers: stamp() });

  if (r.status < 500) {                 // don’t cache server errors
    const forCache = new Response(buf.slice(0), { status: r.status, headers: stamp() });
    cache.put(keyReq, forCache).catch(() => {});
  }

  return forCaller;
}
