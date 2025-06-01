/* cache.js  – simplest possible pattern --------------------------- */
import { json } from "../utils/response.js";

/** how long results stay fresh at the edge (seconds) */
export const CACHE_TTL_SECONDS = 10;

/**
 * Wrap a handler in Cloudflare’s built-in edge cache.
 *
 * @param {Request}   request
 * @param {Function}  computeResponse   – () → Promise<Response>
 * @returns {Promise<Response>}
 */
export async function withEdgeCache(request, computeResponse) {
  const cache    = caches.default;
  const cacheKey = new Request(canonicalUrl(request.url)); // URL only

  /* 1. try the cache --------------------------------------------- */
  const cached = await cache.match(cacheKey);
  if (cached) return cached;                     // < 10 s old → instant

  /* 2. miss – run the heavy work --------------------------------- */
  let resp;
  try {
    resp = await computeResponse();              // your handler
  } catch (e) {
    return json({ error: e.message || "Internal error" }, { status: 500 });
  }

  /* 3. give CF one copy, caller another (avoid “body used”) ------- */
  const buf = await resp.arrayBuffer();

  const headers = new Headers(resp.headers);
  headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);

  const toCaller = new Response(buf.slice(0), {
    status: resp.status,
    headers,
  });

  /* store async – do **not** wait for it                            */
  if (resp.status < 500) {
    const toCache = new Response(buf, { status: resp.status, headers });
    event.waitUntil(cache.put(cacheKey, toCache));  // fire-&-forget
  }

  return toCaller;
}

/* helper – sort query params so ?limit=10&offset=0 == ?offset=0&limit=10 */
function canonicalUrl(u) {
  const x = new URL(u);
  x.searchParams.sort();
  return x.toString();
}
