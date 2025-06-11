import { json }          from "../utils/response.js";
import { CORS_HEADERS }  from "../middleware/cache.js";

const CONCURRENCY   = 5;   // sub-requests in parallel
const EST_SUBREQ    = 3;   // worst-case fetch + cache.match + GraphQL
const MAX_PATHS     = Math.floor(50 / EST_SUBREQ); // 16 safe per call

/* ── tiny promise-pool ─────────────────────────────────────────── */
async function pool(items, fn, n = CONCURRENCY) {
  const it   = items[Symbol.iterator]();
  const out  = [];
  const work = new Set();
  const run  = () => {
    const { value, done } = it.next();
    if (done) return;
    const p = Promise.resolve(fn(value))
      .then(r => { work.delete(p); out.push(r); run(); })
      .catch(e => { work.delete(p); out.push(e); run(); });
    work.add(p);
  };
  Array.from({ length: n }).forEach(run);
  await Promise.all(work);
  return out;
}

/* parse JSON if possible, else text */
const safeBody = async r =>
  (r.headers.get("Content-Type") || "").includes("json")
    ? await r.json().catch(() => null)
    : await r.text().catch(() => null);

export async function batchHandler(req, env, ctx) {
  if (req.method !== "POST")
    return json({ error: "Use POST with JSON body" }, { status: 405, headers: CORS_HEADERS });

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS }); }

  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length)
    return json({ error: "'paths' must be non-empty array" }, { status: 400, headers: CORS_HEADERS });

  const offset = Math.max(0, parseInt(body.offset || 0, 10));
  const slice  = paths.slice(offset, offset + MAX_PATHS);
  if (!slice.length)
    return json({ error: "offset out of range" }, { status: 400, headers: CORS_HEADERS });

  /* fan-out ------------------------------------------------------ */
  const origin = new URL(req.url).origin;
  const init   = { headers: { Accept: "application/json" } };

  const results = await pool(slice, async p => {
    const full = origin + p;
    try {
      const resp   = await fetch(full, init);
      const data   = await safeBody(resp);
      const max    = +(resp.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 0);
      return { path: p, ok: resp.ok, status: resp.status, url: full, data, max };
    } catch (e) {
      return { path: p, ok: false, status: 599, url: full, data: { error: e.message }, max: 0 };
    }
  });

  /* assemble ------------------------------------------------------ */
  const out  = {};
  let ttl    = Infinity;
  for (const r of results) {
    out[r.path] = r.ok
      ? r.data
      : { error: "Sub-request failed", status: r.status, url: r.url, body: r.data };
    ttl = Math.min(ttl, r.max || Infinity);
  }
  if (!isFinite(ttl)) ttl = 5;

  out._meta = {
    maxAge: ttl,
    nextOffset: offset + slice.length < paths.length ? offset + slice.length : null
  };

  return json(out, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl}`
    }
  });
}
