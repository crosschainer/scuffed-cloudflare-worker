/* ------------------------------------------------------------------ */
/*  middleware/cache.js  –  Stale-While-Revalidate edge cache         */
/* ------------------------------------------------------------------ */

import { json } from "../utils/response.js";

const MAX_AGE = 10;          // seconds a response is “fresh”
const inflight = new Map();  // url → Promise   (deduplicate refreshes)

const canon = (u) => { const x=new URL(u); x.searchParams.sort(); return x; };

/**
 * Wrap a handler so:
 *   • first request computes once;
 *   • every later request is instant (stale copy);
 *   • refresh happens **after** the response is sent.
 */
export async function withEdgeCache(request, event, compute) {
  const cache    = caches.default;
  const keyReq   = new Request(canon(request.url));   // GET only
  const urlKey   = keyReq.url;

  /* ── 1) serve any cached copy immediately ────────────────────── */
  const cached = await cache.match(keyReq);
  if (cached) {
    const age = (Date.now() - Number(cached.headers.get("X-Gen")||0))/1000;
    if (age > MAX_AGE) {
      /* older than MAX_AGE – refresh in the background only once   */
      if (!inflight.has(urlKey)) {
        inflight.set(urlKey, true);  // flag so we queue just one refresh
        queueMicrotask(() =>
          event.waitUntil(refresh(cache, keyReq, compute).finally(
            () => inflight.delete(urlKey)
          ))
        );
      }
    }
    /* return the stale (or fresh) copy right now                    */
    const h = new Headers(cached.headers);
    h.set("X-Worker-Cache", "HIT");
    return new Response(cached.body, { status: cached.status, headers: h });
  }

  /* ── 2) cache miss – compute, store, return (caller waits once) ─ */
  const fresh = await computeSafely(compute);
  await storeIfOk(cache, keyReq, fresh);
  const h = withCacheHdrs(fresh.headers);
  h.set("X-Worker-Cache", "MISS");
  return new Response(fresh.body, { status: fresh.status, headers: h });
}

/* ------------------------------------------------------------------ */
/*  helpers                                                           */
/* ------------------------------------------------------------------ */

async function computeSafely(fn) {
  try { return await fn(); }
  catch(e){ return json({error:e.message||"Internal"}, {status:500}); }
}

function withCacheHdrs(srcHeaders) {
  const h = new Headers(srcHeaders);
  h.set("Cache-Control", `public, max-age=${MAX_AGE}`);
  h.set("X-Gen", Date.now().toString());
  return h;
}

async function storeIfOk(cache, keyReq, resp) {
  if (resp.status >= 500) return;
  const buf = await resp.clone().arrayBuffer();
  const toCache = new Response(buf, { status: resp.status,
                                      headers: withCacheHdrs(resp.headers) });
  await cache.put(keyReq, toCache);
}

async function refresh(cache, keyReq, compute) {
  const fresh = await computeSafely(compute);
  await storeIfOk(cache, keyReq, fresh);
}
