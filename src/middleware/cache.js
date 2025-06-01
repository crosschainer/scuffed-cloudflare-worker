/**
 * Caching middleware for Cloudflare Workers
 *
 *  ▸ “max-age” (fresh window)         → 120 s by default
 *  ▸ “stale-while-revalidate” (SWR)   → 60 min by default
 *
 *  Behaviour
 *  ─────────
 *    • If a cached copy is still fresh  → return it instantly.
 *    • If it is stale-but-within SWR    → return the stale copy instantly
 *                                        and refresh the cache *in the background*.
 *    • If it is missing / far too old   → compute a fresh copy and the caller waits once.
 */

import { CACHE_TTL_SECONDS } from "../config/constants.js";
import { json } from "../utils/response.js";

// how long we’re willing to serve stale while a background refresh happens
const SWR_SECONDS = 3600; // 1 hour

/**
 * A helper that wraps any handler in an edge-cache with SWR.
 *
 * Steps:
 *   1) Look in caches.default for an entry under the cacheKey (full request URL).
 *      • If fresh (age < CACHE_TTL_SECONDS) → return it immediately.
 *      • If stale but within SWR window     → return it immediately and trigger an async refresh.
 *   2) If no acceptable cached entry, call computeResponse() to get a fresh Response.
 *   3) Attach headers:
 *         Cache-Control: public, max-age=<CACHE_TTL_SECONDS>, stale-while-revalidate=<SWR_SECONDS>
 *         X-Generated-At: <epoch_ms>
 *   4) Put it into caches.default (edge) asynchronously.
 *   5) Return the Response to the client.
 *
 * @param {string}   pathname        – The request pathname (used only for logs, optional)
 * @param {Request}  request         – The original request
 * @param {FetchEvent} event         – The fetch event
 * @param {Function} computeResponse – Function that returns a Promise<Response>
 * @returns {Promise<Response>}      – A cached, stale-while-revalidate, or fresh response
 */
export async function withCache(pathname, request, event, computeResponse) {
  const cache    = caches.default;
  const cacheKey = new Request(request.url, request);

  /** ────────────────────────────────────────────────────────────────
   ** 1) Try to serve from cache
   ** ───────────────────────────────────────────────────────────── */
  const cached = await cache.match(cacheKey);
  if (cached) {
    const generatedAt = Number(cached.headers.get("X-Generated-At") || 0);
    const ageSeconds  = (Date.now() - generatedAt) / 1000;

    if (ageSeconds < CACHE_TTL_SECONDS) {
      // 1a) still within “fresh” window
      return cached;
    }

    if (ageSeconds < CACHE_TTL_SECONDS + SWR_SECONDS) {
      // 1b) stale but acceptable – return now, refresh in background
      event.waitUntil(
        refreshAndStore(cache, cacheKey, computeResponse) // no await
      );
      return cached;
    }
    // else fall through to full refresh (“too stale”)
  }

  /** ────────────────────────────────────────────────────────────────
   ** 2) No cache or too stale – compute fresh & store
   ** ───────────────────────────────────────────────────────────── */
  return await refreshAndStore(cache, cacheKey, computeResponse);
}

/**
 * Compute a new response, stamp SWR headers, store in cache, return it.
 * If computeResponse() throws we bubble up 500 JSON.
 */
async function refreshAndStore(cache, cacheKey, computeResponse) {
  let fresh;
  try {
    fresh = await computeResponse();
  } catch (err) {
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }

  // Clone & attach Cache-Control + generation timestamp
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

  // store async – this Worker response is not delayed by put()
  cache.put(cacheKey, toCache.clone());

  return toCache;
}
