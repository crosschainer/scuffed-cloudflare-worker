/* ------------------------------------------------------------------ */
/*   edge-cache helper (fresh 10 s, serve stale up to 70 s)           */
/* ------------------------------------------------------------------ */

import { json } from "../utils/response.js";

const FRESH   = 10;      // seconds users see as “realtime”
const GRACE   = 60;      // serve stale for another minute
const TTL_HDR = FRESH + GRACE;   // Cloudflare keeps it this long

/* URL → Promise<Response>  so we don’t duplicate work */
const inflight = new Map();
const canon    = url => { const u = new URL(url); u.searchParams.sort(); return u; };

export async function withEdgeCache(request, event, compute) {
  const cache   = caches.default;
  const keyReq  = new Request(canon(request.url));
  const key     = keyReq.url;

  /* 1) try cache -------------------------------------------------- */
  const cached = await cache.match(keyReq);
  if (cached) {
    const age = (Date.now() - +(cached.headers.get("X-Gen") || 0)) / 1000;
    if (age < FRESH)      return cached;          // still fresh
    if (age < TTL_HDR) {                         // stale but usable
      // kick refresh in BG once
      if (!inflight.has(key))
        event.waitUntil(refreshAndPut(cache, keyReq, compute).finally(()=>inflight.delete(key)));
      return cached;                             // user sees stale copy
    }
  }

  /* 2) miss / too old -------------------------------------------- */
  if (inflight.has(key)) return inflight.get(key);      // dedup

  const p = refreshAndPut(cache, keyReq, compute).finally(()=>inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/* --------------------------------------------------------------- */
async function refreshAndPut(cache, keyReq, compute) {
  let resp;
  try {
    resp = await compute();
  } catch (e) {
    return json({ error: e.message || "Internal error" }, { status: 500 });
  }

  const buf = await resp.arrayBuffer();                   // read once
  const headers = new Headers(resp.headers);
  headers.set("Cache-Control", `public, max-age=${TTL_HDR}`);
  headers.set("X-Gen", Date.now().toString());

  if (resp.status < 500) {
    const toCache = new Response(buf.slice(0), { status: resp.status, headers });
    caches.default.put(keyReq, toCache).catch(()=>{});
  }

  return new Response(buf, { status: resp.status, headers });
}
