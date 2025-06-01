/**
 * Caching middleware for Cloudflare Workers
 *
 *  ▸ “max-age”  (fresh window)         →  15 s  (configurable)
 *  ▸ “stale-while-revalidate” (SWR)    →  60 min
 *
 *  Behaviour
 *  ─────────
 *    • If cached & fresh               → return immediately.
 *    • If cached but stale (< SWR)     → return immediately, kick async refresh.
 *    • If no cache / too stale         → run refresh.
 *
 *  Extra:
 *    • In-flight deduplication: while a refreshPromise is running all
 *      subsequent callers await the same Promise (no duplicate GraphQL hits).
 */

import { json } from "../utils/response.js";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
export const CACHE_TTL_SECONDS = 5;   // how fresh “realtime” should feel
const SWR_SECONDS              = 3600;

/* ------------------------------------------------------------------ */
/*  In-flight map  (href → Promise<Response>)                          */
/*  Lives in the module scope, shared by all requests hitting the same */
/*  Cloudflare worker instance.                                        */
/* ------------------------------------------------------------------ */
const inflight = new Map();

/**
 * Edge cache with SWR + in-flight dedup.
 *
 * @param {string}   pathname
 * @param {Request}  request
 * @param {FetchEvent} event
 * @param {Function} computeResponse
 */
export async function withCache(pathname, request, event, computeResponse) {
  const cache    = caches.default;
  const cacheKey = new Request(request.url, request);

  /* ───── 1) Serve from edge cache if possible ───────────────────── */
  const cached = await cache.match(cacheKey);
  if (cached) {
    const ts   = Number(cached.headers.get("X-Generated-At") || 0);
    const age  = (Date.now() - ts) / 1000;

    if (age < CACHE_TTL_SECONDS) {
      // fresh → quick return
      return cached;
    }

    if (age < CACHE_TTL_SECONDS + SWR_SECONDS) {
      // stale but acceptable → refresh in bg, return stale
      event.waitUntil(refresh(cache, cacheKey, computeResponse));
      return cached;
    }
  }

  /* ───── 2) No cache or too old – refresh (with dedup) ───────────── */
  return await refresh(cache, cacheKey, computeResponse);
}
/* ------------------------------------------------------------------ */
/*  refresh() – robust, no double-drain, no empty body                */
/* ------------------------------------------------------------------ */
async function refresh(cache, cacheKey, computeResponse) {
  const key = cacheKey.url;

  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    let fresh;
    try {
      fresh = await computeResponse();           // handler’s Response
    } catch (err) {
      return json({ error: err.message || "Internal error" }, { status: 500 });
    }

    /* clone once – we’ll keep the original for the caller  */
    const cloneForCache = fresh.clone();

    /* stamp shared headers */
    const hdr = (res) => {
      const h = new Headers(res.headers);
      h.set(
        "Cache-Control",
        `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`
      );
      h.set("X-Generated-At", Date.now().toString());
      return h;
    };

    /* put into cache only on success status (<500) */
    if (cloneForCache.status < 500) {
      const cachedResp = new Response(cloneForCache.body, {
        status: cloneForCache.status,
        headers: hdr(cloneForCache),
      });
      cache.put(cacheKey, cachedResp).catch(() => {});
    }

    /* return a new Response for caller (avoids “body used” issues) */
    return new Response(fresh.body, {
      status: fresh.status,
      headers: hdr(fresh),
    });
  })();

  inflight.set(key, promise);
  promise.finally(() => inflight.delete(key));
  return promise;
}