/* ------------------------------------------------------------------ */
/*  middleware/cache.js                                               */
/* ------------------------------------------------------------------ */
/**
 * Very small helper that wraps a handler in Cloudflare’s edge cache.
 * - First caller → handler runs, response cached.
 * - Subsequent callers (same URL) within CACHE_TTL_SECONDS → instant.
 * - At expiry the next caller waits once, then the cache is refreshed.
 *
 * We copy the body into an ArrayBuffer so two *independent* Response objects
 * can be created – one for the edge cache and one for the end-user – which
 * avoids “Body has already been used” errors.
 */

import { json } from "../utils/response.js";

export const CACHE_TTL_SECONDS = 10;      // adjust freshness here

/* dedup in-flight refreshes: URL → Promise<Response> */
const inflight = new Map();

/* normalise URL so ?limit=10&offset=0 == ?offset=0&limit=10 */
function canonical(u) {
  const x = new URL(u);
  x.searchParams.sort();
  return x.toString();
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",                 // or echo request.origin
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

/**
 * @param {Request}  request         – incoming CF Worker request
 * @param {FetchEvent} event         – fetch event (to waitUntil cache.put)
 * @param {Function} computeResponse – async () => Response
 * @returns {Promise<Response>}      – cached or freshly computed Response
 */
export async function withEdgeCache(request, event, computeResponse) {
  const cache    = caches.default;
  const cacheKey = new Request(canonical(request.url));   // URL only

  /* 1) try the cache --------------------------------------------- */
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  /* 2) miss – run (or join) the expensive computation ------------ */
  const key = cacheKey.url;
  if (inflight.has(key)) return inflight.get(key);        // join dedup

  const promise = (async () => {
    let resp;
    try {
      resp = await computeResponse();                     // run handler
    } catch (e) {
      return json({ error: e.message || "Internal error" }, { status: 500 });
    }

    /* buffer body once (small JSON) ------------------------------ */
    const buf = await resp.arrayBuffer();

    /* copy original headers, just add Cache-Control -------------- */
    const makeHeaders = () => {
      const h = new Headers(resp.headers);                // keep Content-Type
      h.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        if (!h.has(k)) h.set(k, v);                       // add CORS headers
      }
      return h;
    };

    /* store in edge cache asynchronously (only if not 5xx) ------- */
    if (resp.status < 500) {
      const toCache = new Response(buf.slice(0), { status: resp.status, headers: makeHeaders() });
      event.waitUntil(cache.put(cacheKey, toCache));
    }

    /* return to caller ------------------------------------------- */
    return new Response(buf, { status: resp.status, headers: makeHeaders() });
  })();

  inflight.set(key, promise);
  promise.finally(() => inflight.delete(key));
  return promise;
}
