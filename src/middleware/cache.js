/* ------------------------------------------------------------------ */
/* cache.js – final, robust SWR layer                                 */
/* ------------------------------------------------------------------ */
import { json } from "../utils/response.js";

export const CACHE_TTL_SECONDS = 5;     // fresh window
const SWR_SECONDS = 3600;               // serve-stale window

const inflight = new Map();

/* canonicalise URL so param order doesn’t matter, headers ignored */
function canon(u) {
  const x = new URL(u);
  x.searchParams.sort();
  return x.toString();
}

/* ------------------------------------------------------------------ */
/* public helper                                                      */
/* ------------------------------------------------------------------ */
export async function withCache(pathname, request, event, compute) {
  const cache    = caches.default;
  const cacheKey = new Request(canon(request.url));   // URL only

  /* 1 — try cache first ------------------------------------------- */
  const hit = await cache.match(cacheKey);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get("X-Generated-At") || 0)) / 1000;
    if (age < CACHE_TTL_SECONDS) return hit;                     // fresh
    if (age < CACHE_TTL_SECONDS + SWR_SECONDS) {                 // stale-OK
      queueMicrotask(() => event.waitUntil(refresh(cache, cacheKey, compute)));
      return hit;                                                // instant
    }
  }

  /* 2 — miss / too old ------------------------------------------- */
  return refresh(cache, cacheKey, compute);      // deduped inside
}

/* ------------------------------------------------------------------ */
/* refresh() with body-buffer + in-flight dedup                       */
/* ------------------------------------------------------------------ */
async function refresh(cache, cacheKey, compute) {
  const key = cacheKey.url;
  if (inflight.has(key)) return inflight.get(key);   // join

  const p = (async () => {
    /* run the real handler --------------------------------------- */
    let resp;
    try {
      resp = await compute();
    } catch (e) {
      return json({ error: e.message || "Internal error" }, { status: 500 });
    }

    /* buffer body once ------------------------------------------- */
    const buf = await resp.arrayBuffer();

    /* copy original headers, add caching ones -------------------- */
    const makeHeaders = () => {
      const h = new Headers(resp.headers);              // keep Content-Type !
      h.set("Cache-Control",
            `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`);
      h.set("X-Generated-At", Date.now().toString());
      return h;
    };

    /* store in edge cache (success statuses only) ---------------- */
    if (resp.status < 500) {
      cache.put(cacheKey, new Response(buf.slice(0), {
        status: resp.status,
        headers: makeHeaders(),
      })).catch(() => {});
    }

    /* return to caller ------------------------------------------ */
    return new Response(buf, { status: resp.status, headers: makeHeaders() });
  })();

  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}
