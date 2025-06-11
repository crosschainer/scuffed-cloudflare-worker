import router           from "../routes/router.js";   // default export with .fetch
import { json }         from "../utils/response.js";
import { CORS_HEADERS } from "../middleware/cache.js";

const CONCURRENCY = 5;
const MAX_PATHS   = 16;               // slice size per batch

/* pool helper ---------------------------------------------------- */
async function pool(items, fn, n = CONCURRENCY) {
  const it   = items[Symbol.iterator]();
  const out  = [];
  const running = new Set();
  const step = () => {
    const { value, done } = it.next();
    if (done) return;
    const p = Promise.resolve(fn(value))
      .then(r => { running.delete(p); out.push(r); step(); })
      .catch(e => { running.delete(p); out.push(e); step(); });
    running.add(p);
  };
  Array.from({ length: n }).forEach(step);
  await Promise.all(running);
  return out;
}

/* --------------------------------------------------------------- */
export async function batchHandler(req, env, ctx) {
  if (req.method !== "POST")
    return json({ error: "Use POST with JSON body" }, { status: 405, headers: CORS_HEADERS });

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS }); }

  const paths  = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length)
    return json({ error: "'paths' must be non-empty array" }, { status: 400, headers: CORS_HEADERS });

  const offset = Math.max(0, parseInt(body.offset || 0, 10));
  const slice  = paths.slice(offset, offset + MAX_PATHS);
  if (!slice.length)
    return json({ error: "offset out of range" }, { status: 400, headers: CORS_HEADERS });

  /* ---- fan-out (internal) ------------------------------------- */
  const makeReq = (p) => new Request(new URL(p, req.url).toString(), {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  const results = await pool(slice, async p => {
    try {
      const r    = await router.fetch(makeReq(p), env, ctx);
      const data = await r.json().catch(() => null);
      const max  = +(r.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 0);
      return { path: p, ok: r.ok, status: r.status, data, max };
    } catch (e) {
      return { path: p, ok: false, status: 599, data: { error: e.message }, max: 0 };
    }
  });

  /* ---- assemble ---------------------------------------------- */
  const out  = {};
  let ttl    = Infinity;
  for (const r of results) {
    out[r.path] = r.ok
      ? r.data
      : { error: "Sub-request failed", status: r.status, body: r.data };
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
