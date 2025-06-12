/* ------------------------------------------------------------------ */
/*  middleware/cache.js – v2                                          */
/* ------------------------------------------------------------------ */
import { json } from "../utils/response.js";

export const DEFAULT_TTL = 5;               // seconds

/* de-dup in-flight refreshes: URL → Promise<Response> */
const inflight = new Map();

/* normalise URL so ?limit=10&offset=0 == ?offset=0&limit=10 */
function canonical(u) {
  const x = new URL(u);
  x.searchParams.sort();
  return x.toString();
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

/**
 * @param {Request}    request   – incoming CF Worker request
 * @param {FetchEvent} event     – fetch event (for waitUntil)
 * @param {Function}   compute   – async () => Response
 * @param {number}     [ttl]     – override TTL in seconds
 */
export async function withEdgeCache(request, event, compute, ttl = DEFAULT_TTL) {
  const cache    = caches.default;
  const cacheKey = new Request(canonical(request.url));   // URL only
  const keyStr   = cacheKey.url;

  /* 1) try a fresh hit --------------------------------------------- */
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  /* 2) miss – are we already refreshing? --------------------------- */
  if (inflight.has(keyStr)) return inflight.get(keyStr);

  /* 3) run the expensive thing (once per PoP) ---------------------- */
  const promise = (async () => {
    let resp;

    /* try to compute a fresh response */
    try {
      resp = await compute();
    } catch (err) {
      /* computation failed – fall back to a stale cache entry if any */
      if (cached) return cached;   // serve stale rather than 500
      return json({ error: err.message || "Internal error" }, { status: 500 });
    }

    /* clone or buffer so we can both cache & return ---------------- */
    let bodyForCache, bodyForUser;
    if (resp.body && resp.clone) {
      bodyForCache = resp.clone();
      bodyForUser  = resp;                // original
    } else {
      const buf    = await resp.arrayBuffer();
      bodyForCache = new Response(buf.slice(0), resp);
      bodyForUser  = new Response(buf,         resp);
    }

    /* cache headers ------------------------------------------------ */
    const makeHeaders = (h = new Headers(bodyForUser.headers)) => {
      const makeHeaders = (h = new Headers(bodyForUser.headers)) => {
      if (bodyForUser.status === 200) {
        const cc = `public, max-age=${ttl}, ` +
                   `stale-while-revalidate=${ttl}, ` +
                   `stale-if-error=${ttl}`;
        h.set("Cache-Control", cc);
      } else {
        h.set("Cache-Control", "no-store");
      }
      for (const [k, v] of Object.entries(CORS_HEADERS)) if (!h.has(k)) h.set(k, v);
      return h;
    };

    /* store if 200 ------------------------------- */
    if (bodyForUser.status === 200) {
      const cachedResp = new Response(bodyForCache.body, {
        status:  bodyForUser.status,
        headers: makeHeaders()
      });
      event.waitUntil(cache.put(cacheKey, cachedResp));
    }

    /* send to caller ---------------------------------------------- */
    return new Response(bodyForUser.body, {
      status:  bodyForUser.status,
      headers: makeHeaders()
    });
  })();

  inflight.set(keyStr, promise);
  promise.finally(() => inflight.delete(keyStr));
  return promise;
}
