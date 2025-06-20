/* ------------------------------------------------------------------ */
/*  middleware/cache.js – v2.1                                        */
/* ------------------------------------------------------------------ */
import { json } from "../utils/response.js";

export const DEFAULT_TTL = 5;               // seconds
const inflight = new Map();                 // URL → Promise<Response>

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
 * Edge-cache helper
 */
export async function withEdgeCache(request, event, compute, ttl = DEFAULT_TTL) {
  const cache    = caches.default;
  const cacheKey = new Request(canonical(request.url));
  const keyStr   = cacheKey.url;

  /* 1) fresh hit ------------------------------------------------- */
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  /* 2) de-duplicate refresh ------------------------------------- */
  if (inflight.has(keyStr)) return inflight.get(keyStr);

  /* 3) compute, cache, return ----------------------------------- */
  const promise = (async () => {
    let resp;
    try {
      resp = await compute();
    } catch (err) {
      console.warn("[withEdgeCache] compute() failed, retrying once...", err);
      try {
        await new Promise(r => setTimeout(r, 100)); // small delay
        resp = await compute();                     // retry once
      } catch (retryErr) {
        console.error("[withEdgeCache] second attempt failed:", retryErr);
        if (cached) return cached;                  // serve stale if possible
        return json({
          error: "Internal error",
          message: retryErr.message || "Failed after retry"
        }, { status: 502 }); // Use 502 (bad upstream) instead of 500
      }
    }


    /* clone / buffer so we can reuse the body twice -------------- */
    let cacheCopy, userCopy;
    if (resp.body && resp.clone) {
      cacheCopy = resp.clone();
      userCopy  = resp;
    } else {
      const buf = await resp.arrayBuffer();
      cacheCopy = new Response(buf.slice(0), resp);
      userCopy  = new Response(buf,         resp);
    }

    /* header helper ---------------------------------------------- */
    const addHeaders = (h = new Headers(userCopy.headers)) => {
      if (userCopy.status === 200) {
        const cc = `public, max-age=${ttl}, ` +
                   `stale-while-revalidate=${ttl}, ` +
                   `stale-if-error=${ttl}`;
        h.set("Cache-Control", cc);
      } else {
        h.set("Cache-Control", "no-store");
      }
      for (const [k, v] of Object.entries(CORS_HEADERS))
        if (!h.has(k)) h.set(k, v);
      return h;
    };

    /* write to edge cache only if 200 ---------------------------- */
    if (userCopy.status === 200) {
      event.waitUntil(cache.put(
        cacheKey,
        new Response(cacheCopy.body, { status: 200, headers: addHeaders() })
      ));
    }

    /* send to caller -------------------------------------------- */
    return new Response(userCopy.body, {
      status:  userCopy.status,
      headers: addHeaders()
    });
  })();

  inflight.set(keyStr, promise);
  promise.finally(() => inflight.delete(keyStr));
  return promise;
}

function addCacheHeaders(response, ttl) {
  const headers = new Headers(response.headers);

  if (response.status === 200) {
    const cc = `public, max-age=${ttl}, ` +
               `stale-while-revalidate=${ttl}, ` +
               `stale-if-error=${ttl}`;
    headers.set("Cache-Control", cc);
  } else {
    headers.set("Cache-Control", "no-store");
  }

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }

  return headers;
}


/** SSE helpers */
export function generateCacheKey(req) {
  return new Request(canonical(req.url));
}

/**
 * Read cache manually (used by SSE)
 */
export async function readEdgeCache(request) {
  const cache    = caches.default;
  const cacheKey = generateCacheKey(request);
  return await cache.match(cacheKey);
}

/**
 * Write to cache manually (used by SSE)
 */
export async function writeEdgeCache(request, response, ttl = DEFAULT_TTL) {
  if (response.status !== 200) return;

  const cache    = caches.default;
  const cacheKey = generateCacheKey(request);

  const clone = response.clone();
  const headers = addCacheHeaders(clone, ttl);

  await cache.put(cacheKey, new Response(clone.body, {
    status: 200,
    headers
  }));
}