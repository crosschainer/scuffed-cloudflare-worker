import { json } from "../utils/response.js";
import { CORS_HEADERS } from "../middleware/cache.js";   // re-use common CORS set

/* How many sub-requests may run in parallel */
const CONCURRENCY = 5;

/* optional: retry once on transient 5xx */
async function fetchJson(url, init) {
  let resp = await fetch(url, init);
  if (resp.status >= 500) {          // retry once after 250 ms
    await new Promise(r => setTimeout(r, 250));
    resp = await fetch(url, init);
  }
  return resp;
}

/* micro promise-pool */
async function pool(items, fn) {
  const it   = items[Symbol.iterator]();
  const out  = [];
  const work = new Set();

  const spin = () => {
    const { value, done } = it.next();
    if (done) return;
    const p = Promise.resolve(fn(value))
      .then(r => { work.delete(p); out.push(r); spin(); })
      .catch(e => { work.delete(p); out.push(e); spin(); });
    work.add(p);
  };

  Array.from({ length: CONCURRENCY }).forEach(spin);
  await Promise.all(work);
  return out;
}

export async function batchHandler(request, env, ctx) {
  if (request.method !== "POST")
    return json({ error: "Use POST with JSON body" }, { status: 405, headers: CORS_HEADERS });

  /* ── body parsing ------------------------------------------------ */
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON." }, { status: 400, headers: CORS_HEADERS }); }

  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length)
    return json({ error: "Body must contain non-empty 'paths' array" },
                { status: 400, headers: CORS_HEADERS });

  /* ── fan-out ----------------------------------------------------- */
  const origin   = new URL(request.url).origin;
  const init     = { headers: { Accept: "application/json" } };

  const results  = await pool(paths, async p => {
    try {
      const resp   = await fetchJson(origin + p, init);
      const data   = await resp.json().catch(() => null);
      const cc     = resp.headers.get("Cache-Control") || "";
      const m      = cc.match(/max-age=(\d+)/);
      const maxAge = m ? parseInt(m[1], 10) : 0;
      return { path: p, ok: resp.ok, status: resp.status, data, maxAge };
    } catch (e) {
      return { path: p, ok: false, status: 599, data: { error: e.message }, maxAge: 0 };
    }
  });

  /* ── assemble response ------------------------------------------ */
  const out  = {};
  let ttl    = Infinity;

  for (const r of results) {
    out[r.path] = r.ok
      ? r.data
      : { error: "Sub-request failed", status: r.status, details: r.data };

    ttl = Math.min(ttl, r.maxAge || Infinity);
  }
  if (!isFinite(ttl)) ttl = 5;

  out._meta = { maxAge: ttl };

  return json(out, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`
    }
  });
}
