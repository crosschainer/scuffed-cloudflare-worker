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
/* ------------------------------------------------------------------ */
/*  refresh() – single-clone version (no stray ReadableStream branch) */
/* ------------------------------------------------------------------ */
async function refresh(cache, cacheKey, computeResponse) {
  const key = cacheKey.url;

  if (inflight.has(key)) return inflight.get(key);

  const refreshPromise = (async () => {
    let fresh;
    try {
      fresh = await computeResponse();
    } catch (err) {
      return json({ error: err.message || "Internal error" }, { status: 500 });
    }

    // Read body once into memory (small JSON, fine) …
    const buffer = await fresh.arrayBuffer();

    const headers = new Headers(fresh.headers);
    headers.set(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`
    );
    headers.set("X-Generated-At", Date.now().toString());

    // …create TWO independent Response objects from the same buffer:
    const forCache   = new Response(buffer.slice(0), { status: fresh.status, headers });
    const forCaller  = new Response(buffer.slice(0), { status: fresh.status, headers });

    // store asynchronously
    cache.put(cacheKey, forCache).catch(() => { /* ignore */ });

    return forCaller;
  })();

  inflight.set(key, refreshPromise);
  refreshPromise.finally(() => inflight.delete(key));

  return refreshPromise;
}

