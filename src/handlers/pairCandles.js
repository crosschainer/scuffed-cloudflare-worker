import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

/* safety knobs --------------------------------------------------- */
const CHUNK        = 1000;        // rows per GraphQL call
const MAX_CANDLES  = 5_000;       // hard ceiling on buckets per response

/* helper: "5m" | "1h" | "2d" → ms ------------------------------- */
function intervalMs(str = "1h") {
  const m = str.match(/^(\d+)([mhd])$/i);
  if (!m) throw new Error("Bad interval");
  const n = +m[1];
  return m[2] === "m" ? n * 60 * 1e3
       : m[2] === "h" ? n * 60 * 60 * 1e3
       :                n * 24 * 60 * 60 * 1e3;
}

/* price in token0 units ----------------------------------------- */
function calcPrice0(d = {}) {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  if (amount0In > 0 && amount1Out > 0) return amount0In / amount1Out;
  if (amount1In > 0 && amount0Out > 0) return amount0Out / amount1In;
  return null;
}

export async function pairCandlesHandler(request /*, ctx */) {
  try {
    /* ── query-string params ------------------------------------ */
    const url     = new URL(request.url);
    const pairId  = url.pathname.match(/^\/pairs\/([^\/]+)\/candles$/)?.[1];
    const token   = url.searchParams.get("token")    ?? "0";
    const ivStr   = url.searchParams.get("interval") ?? "1h";
    const rangeStr= url.searchParams.get("range")    ?? "1d";

    if (!pairId)
      return json({ error: "Missing pairId" }, { status: 400 });
    if (!["0", "1"].includes(token))
      return json({ error: 'token must be "0" or "1"' }, { status: 400 });

    /* ── interval / range parsing + guard ----------------------- */
    let ivMs, rangeMs;
    try {
      ivMs    = intervalMs(ivStr);
      rangeMs = intervalMs(rangeStr);
    } catch {
      return json({ error: "Bad interval or range format" }, { status: 400 });
    }

    const bucketCount = Math.ceil(rangeMs / ivMs);
    if (bucketCount > MAX_CANDLES) {
      /* suggest a bigger interval that fits the cap */
      const reqMs = rangeMs / MAX_CANDLES;
      const minute = 60 * 1e3, hour = 60 * minute, day = 24 * hour;
      const nextInt =
        reqMs <= minute ? `${Math.ceil(reqMs / minute)}m`
      : reqMs <= hour   ? `${Math.ceil(reqMs / hour  )}h`
                        : `${Math.ceil(reqMs / day   )}d`;

      return json(
        {
          error: `Too many candles (${bucketCount} > ${MAX_CANDLES})`,
          suggestion: `Use interval >= ${nextInt}`
        },
        { status: 400 }
      );
    }

    /* ── timeframe bounds --------------------------------------- */
    const now      = Date.now();
    const since    = now - rangeMs;
    const sinceIso = new Date(since).toISOString().replace("Z", "");

    /* ── GraphQL loop (DESC order) ------------------------------ */
    const qry = `
      query Swaps($pair:String!,$since:Datetime!,$first:Int!,$offset:Int!) {
        allEvents(
          condition:{ contract:"con_pairs", event:"Swap" }
          filter:{
            dataIndexed:{ contains:{ pair:$pair } }
            created:{ greaterThan:$since }
          }
          orderBy: CREATED_DESC
          first:  $first
          offset: $offset
        ){ edges{ node{ created data } } }
      }`;

    let offset = 0, done = false;
    const candles = new Map();            // bucketStart → candlestick

    const add = (tMs, p0, v0, v1) => {
      const c = candles.get(tMs) ?? {
        t: new Date(tMs).toISOString(),
        open: null, high: 0, low: Infinity, close: null,
        vol0: 0, vol1: 0
      };
      if (c.open === null) c.open = p0;
      c.high  = Math.max(c.high, p0);
      c.low   = Math.min(c.low,  p0);
      c.close = c.close === null ? p0 : c.close;       // first in DESC = close
      c.vol0 += v0;
      c.vol1 += v1;
      candles.set(tMs, c);
    };

    while (!done) {
      const vars = { pair: pairId, since: sinceIso, first: CHUNK, offset };
      const res  = await executeGraphQLQuery(qry, vars,
                    "Upstream GraphQL error on candles query");
      const edges = res?.data?.allEvents?.edges ?? [];
      if (!edges.length) break;

      for (const { node: { created, data } } of edges) {
        const ts  = Date.parse(created);
        const key = Math.floor(ts / ivMs) * ivMs;

        const p0 = calcPrice0(data);
        if (p0 === null) continue;

        const v0 = parseFloat(data.amount0In  || 0) + parseFloat(data.amount0Out || 0);
        const v1 = parseFloat(data.amount1In  || 0) + parseFloat(data.amount1Out || 0);

        add(key, p0, v0, v1);
      }

      done = edges.length < CHUNK;
      offset += CHUNK;
    }

    /* ── serialise map → ASC array ------------------------------ */
    const arr = [...candles.values()]
      .sort((a, b) => new Date(a.t) - new Date(b.t))
      .map(c => ({
        t: c.t,
        open : token === "0" ? c.open            : 1 / c.open,
        high : token === "0" ? c.high            : 1 / c.low,
        low  : token === "0" ? c.low             : 1 / c.high,
        close: token === "0" ? c.close           : 1 / c.close,
        volume: token === "0" ? c.vol0           : c.vol1
      }));

    return json({ pairId, token, interval: ivStr, candles: arr });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
