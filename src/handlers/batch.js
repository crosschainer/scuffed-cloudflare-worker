import { json } from "../utils/response.js";
import { CORS_HEADERS } from "../middleware/cache.js";

const CONCURRENCY = 5;

/* helper: run N promises in parallel */
async function pool(items, fn, n = CONCURRENCY) {
  const it = items[Symbol.iterator]();
  const out = [];
  const running = new Set();

  const step = () => {
    const { value, done } = it.next();
    if (done) return;
    const p = Promise.resolve(fn(value))
      .then(x => { running.delete(p); out.push(x); step(); })
      .catch(e => { running.delete(p); out.push(e); step(); });
    running.add(p);
  };
  Array.from({ length: n }).forEach(step);
  await Promise.all(running);
  return out;
}

/* try JSON, fall back to text */
async function safeParse(resp) {
  const ct = resp.headers.get("Content-Type") || "";
  if (ct.includes("application/json")) {
    return await resp.json().catch(() => null);
  }
  return await resp.text().catch(() => null);
}

export async function batchHandler(request, env, ctx) {
  if (request.method !== "POST")
    return json({ error: "Use POST with JSON body" }, { status: 405, headers: CORS_HEADERS });

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON." }, { status: 400, headers: CORS_HEADERS }); }

  const paths = Array.isArray(body.paths) ? body.paths : [];
  if (!paths.length)
    return json({ error: "Body must contain non-empty 'paths' array" },
                { status: 400, headers: CORS_HEADERS });

  const origin = new URL(request.url).origin;
  const init   = { headers: { Accept: "application/json" } };

  const results = await pool(paths, async p => {
    const full = origin + p;
    try {
      const resp   = await fetch(full, init);
      const data   = await safeParse(resp);
      const cc     = resp.headers.get("Cache-Control") || "";
      const max    = (cc.match(/max-age=(\d+)/) || [0,0])[1] | 0;
      return { path: p, url: full, ok: resp.ok, status: resp.status, data, max };
    } catch (e) {
      return { path: p, url: full, ok: false, status: 599,
               data: { error: e.message }, max: 0 };
    }
  });

  /* assemble */
  const out = {};
  let ttl   = Infinity;

  for (const r of results) {
    out[r.path] = r.ok
      ? r.data
      : { error: "Sub-request failed", status: r.status, url: r.url, body: r.data };

    ttl = Math.min(ttl, r.max || Infinity);
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
