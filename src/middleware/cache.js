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
/*  refresh()  – handles dedup & stores to edge cache                  */
/* ------------------------------------------------------------------ */
async function refresh(cache, cacheKey, computeResponse) {
  const key = cacheKey.url;          // string for Map

  // If another request already kicked off a refresh, await it
  if (inflight.has(key)) return inflight.get(key).then(r => r.clone());

  // Otherwise start a new refresh
  const promise = (async () => {
    let fresh;
    try {
      fresh = await computeResponse();
    } catch (err) {
      // Bubble up error as JSON
      return json({ error: err.message || "Internal error" }, { status: 500 });
    }

    // Stamp headers
    const headers = new Headers(fresh.headers);
    headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`
    );
    headers.set("X-Generated-At", Date.now().toString());

    const toCache = new Response(fresh.body, {
      status: fresh.status,
      headers,
    });

    // store in edge cache (fire-and-forget)
    cache.put(cacheKey, toCache.clone()).catch(() => { /* ignore */ });

    return toCache;
  })();

  // store promise in map until it settles
  inflight.set(key, promise);
  promise.finally(() => inflight.delete(key));

  return promise.then(r => r.clone());
}
