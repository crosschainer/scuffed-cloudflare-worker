/* middleware/swrCache.js ------------------------------------------ */
import { json } from "../utils/response.js";

const MAX_AGE   = 10;      // seconds a response is considered “fresh”
const inflight  = new Map();

function canon(u) { const x=new URL(u); x.searchParams.sort(); return x; }

export async function withSWR(request, event, computeResponse) {
  const cache    = caches.default;
  const keyReq   = new Request(canon(request.url));
  const key      = keyReq.url;

  /* 1 — return any cached value immediately ---------------------- */
  const cached = await cache.match(keyReq);
  if (cached) {
    const age = (Date.now() - Number(cached.headers.get("X-Gen")||0))/1000;
    if (age > MAX_AGE) {
      /* stale – refresh in background but don’t block the caller */
      queueMicrotask(() =>
        event.waitUntil(refresh(cache, keyReq, computeResponse))
      );
    }
    return cached;                            // instant
  }

  /* 2 — no cache yet → generate (dedup concurrent) -------------- */
  if (inflight.has(key)) return inflight.get(key);   // join
  const p = refresh(cache, keyReq, computeResponse);
  inflight.set(key, p);
  p.finally(() => inflight.delete(key));
  return p;
}

/* helper to run handler, buffer body once, store & return --------- */
async function refresh(cache, keyReq, compute) {
  let resp;
  try { resp = await compute(); }
  catch(e){return json({error:e.message||"Internal"}, {status:500});}

  const buf = await resp.arrayBuffer();           // consume once
  const hdr = new Headers(resp.headers);
  hdr.set("Cache-Control", `public, max-age=${MAX_AGE}`);
  hdr.set("X-Gen", Date.now().toString());

  /* store for future visitors (if success) */
  if (resp.status<500) {
    const toCache = new Response(buf.slice(0), { status: resp.status, headers: hdr });
    cache.put(keyReq, toCache).catch(()=>{});
  }

  return new Response(buf, { status: resp.status, headers: hdr });
}
