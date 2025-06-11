/**
 * POST /batch
 * {
 *   "paths": [
 *     "/total-supply",
 *     "/circulating-supply",
 *     "/pairs/1/volume24h",
 *     "/pairs/1/pricechange24h",
 *     "/tokens/con_xian/distribution"
 *   ]
 * }
 *
 * → {
 *     "/total-supply":        { totalSupply: 123456 },
 *     "/circulating-supply":  { circulatingSupply: 98765 },
 *     "/pairs/1/volume24h":   { … },
 *     …
 *     "_meta": {
 *       "maxAge": 5           // seconds: min Cache-Control of all parts
 *     }
 *   }
 */

import { json } from "../utils/response.js";

export async function batchHandler(request, env, ctx) {
  if (request.method !== "POST")
    return json({ error: "Use POST with JSON body" }, { status: 405 });

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, { status: 400 });
  }

  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length)
    return json({ error: "Body must contain non-empty 'paths' array" }, { status: 400 });

  /* fan-out – reuse this worker via fetch() so edge-cache still applies */
  const origin = new URL(request.url).origin;

  const results = await Promise.all(paths.map(async p => {
    try {
      const resp = await fetch(origin + p, { headers: { "Accept": "application/json" }});
      const data = await resp.json().catch(() => null);
      const cc   = resp.headers.get("Cache-Control") || "";
      /* extract max-age if present */
      const m = cc.match(/max-age=(\d+)/);
      const maxAge = m ? parseInt(m[1], 10) : 0;
      return { path: p, ok: resp.ok, data, maxAge };
    } catch (e) {
      return { path: p, ok: false, data: { error: e.message }, maxAge: 0 };
    }
  }));

  /* response payload */
  const out = {};
  let ttl   = Infinity;

  for (const r of results) {
    out[r.path] = r.ok ? r.data : { error: "Sub-request failed", details: r.data };
    ttl = Math.min(ttl, r.maxAge || Infinity);
  }
  if (!isFinite(ttl)) ttl = 5;                // fall-back

  out._meta = { maxAge: ttl };

  return json(out, {
    headers: {
      /* let the combined response be cached for the SHORTER of all parts */
      "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`
    }
  });
}
