/* ------------------------------------------------------------------ */
/* cache.js  – final, robust SWR                                       */
/* ------------------------------------------------------------------ */
import { json } from "../utils/response.js";

export const CACHE_TTL_SECONDS = 5;   // fresh window
const SWR_SECONDS = 3600;            // serve-stale window

/* -------- canonicalise URL: same key independent of header order --- */
function canon(url) {
  const u = new URL(url);
  u.searchParams.sort();
  return u.toString();
}

const inflight = new Map();

/* ------------------------------------------------------------------ */
/* main helper                                                         */
/* ------------------------------------------------------------------ */
export async function withCache(pathname, request, event, computeResponse) {
  const cache    = caches.default;
  const cacheKey = new Request(canon(request.url));   // URL only

  /* 1. try cache --------------------------------------------------- */
  const hit = await cache.match(cacheKey);
  if (hit) {
    const age = (Date.now() - Number(hit.headers.get("X-Generated-At") || 0)) / 1000;
    if (age < CACHE_TTL_SECONDS) return hit;                     // fresh
    if (age < CACHE_TTL_SECONDS + SWR_SECONDS) {                 // stale-ok
      queueMicrotask(() =>            // really defer refresh
        event.waitUntil(refresh(cache, cacheKey, computeResponse))
      );
      return hit;
    }
  }

  /* 2. miss / too old – run or join refresh ----------------------- */
  return refresh(cache, cacheKey, computeResponse);
}

/* ------------------------------------------------------------------ */
/* refresh() with body-buffer/dup & in-flight dedup                    */
/* ------------------------------------------------------------------ */
async function refresh(cache, cacheKey, computeResponse) {
  const key = cacheKey.url;

  if (inflight.has(key)) return inflight.get(key);   // join

  const p = (async () => {
    /* run worker handler ------------------------------------------ */
    let resp;
    try {
      resp = await computeResponse();
    } catch (e) {
      return json({ error: e.message || "Internal error" }, { status: 500 });
    }

    /* read body once ---------------------------------------------- */
    const buf = await resp.arrayBuffer();

    /* stamp common headers ---------------------------------------- */
    const common = {
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, stale-while-revalidate=${SWR_SECONDS}`,
      "X-Generated-At": Date.now().toString(),
    };

    /* for cache (if success) -------------------------------------- */
    if (resp.status < 500) {
      const cached = new Response(buf.slice(0), { status: resp.status, headers: common });
      cache.put(cacheKey, cached).catch(() => {});
    }

    /* for caller --------------------------------------------------- */
    return new Response(buf, { status: resp.status, headers: common });
  })();

  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}
