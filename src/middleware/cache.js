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

async function safeCompute() {
  try {
    return await Promise.race([ compute(), timeout(3000) ]);
  } catch (err) {
    console.warn("[withEdgeCache] compute() failed, retrying once...", err);
    try {
      await new Promise(r => setTimeout(r, 100));
      return await Promise.race([ compute(), timeout(3000) ]);
    } catch (retryErr) {
      console.error("[withEdgeCache] second attempt failed:", retryErr);
      if (cached) return cached;
      return json({ error: "Internal error", message: retryErr.message }, { status: 502 });
    }
  }
}


/**
 * Edge-cache helper
 */
export async function withEdgeCache(request, event, compute, ttl = DEFAULT_TTL) {
   try {
      // run your real handler
      const resp = await compute();

      const headers = new Headers(resp.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        if (!headers.has(k)) headers.set(k, v);
      }

      return new Response(resp.body, {
        status:  resp.status,
        headers,
      });
    } catch (err) {
      // **return the actual error stack** so you can debug
      const body = err.stack || err.message || String(err);
      const headers = new Headers({
        "Content-Type": "text/plain",
        ...CORS_HEADERS
      });
      return new Response(body, {
        status: 500,
        headers
      });
    }
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