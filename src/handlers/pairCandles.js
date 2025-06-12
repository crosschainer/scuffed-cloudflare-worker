/* ------------------------------------------------------------------ */
/*  handlers/pairCandles.js                                           */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

/* safety knobs --------------------------------------------------- */
const CHUNK       = 1_000;   // GraphQL page-size
const MAX_CANDLES = 5_000;   // hard ceiling per response

/* "5m" | "2h" | "7d" → ms ---------------------------------------- */
function intervalMs(str = "1h") {
  const m = str.match(/^(\d+)([mhd])$/i);
  if (!m) throw new Error("Bad interval");
  const n = +m[1];
  return m[2] === "m" ? n * 60 * 1e3
       : m[2] === "h" ? n * 60 * 60 * 1e3
                      : n * 24 * 60 * 60 * 1e3;
}

/* price of token0 in token1 units -------------------------------- */
const price0 = d => {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  return amount0In > 0 && amount1Out > 0 ? amount0In / amount1Out
       : amount1In > 0 && amount0Out > 0 ? amount0Out / amount1In
       : null;
};

export async function pairCandlesHandler(request /*, ctx */) {
  try {
    /* ── params -------------------------------------------------- */
    const url      = new URL(request.url);
    const pairId   = url.pathname.match(/^\/pairs\/([^\/]+)\/candles$/)?.[1];
    const token    = url.searchParams.get("token")    ?? "0";
    const ivStr    = url.searchParams.get("interval") ?? "1h";
    const rangeStr = url.searchParams.get("range")    ?? "1d";
    const beforeQ  = url.searchParams.get("before");   // ms or ISO
    const afterQ   = url.searchParams.get("after");

    if (!pairId)
      return json({ error: "Missing pairId" }, { status: 400 });
    if (!["0", "1"].includes(token))
      return json({ error: 'token must be "0" or "1"' }, { status: 400 });
    if (beforeQ && afterQ)
      return json({ error: "Use only one of before or after" }, { status: 400 });

    /* interval & window ----------------------------------------- */
    const ivMs    = intervalMs(ivStr);               // throws on bad format
    let   rangeMs = intervalMs(rangeStr);

    /* cursor-mode widens the window to MAX_CANDLES * interval */
    if (beforeQ || afterQ) rangeMs = MAX_CANDLES * ivMs;

    const now      = Date.now();
    const beforeMs = beforeQ ? Date.parse(beforeQ) || +beforeQ : null;
    const afterMs  = afterQ  ? Date.parse(afterQ)  || +afterQ  : null;

    const since = beforeMs ? beforeMs - rangeMs
               : afterMs  ? afterMs
                          : now - rangeMs;

    const until = beforeMs ? beforeMs
               : afterMs  ? afterMs + rangeMs
                          : undefined;               // open-ended (= now)

    /* sanity cap for range mode --------------------------------- */
    if (!beforeMs && !afterMs) {
      const buckets = Math.ceil(rangeMs / ivMs);
      if (buckets > MAX_CANDLES) {
        const need = rangeMs / MAX_CANDLES;
        const m=60e3, h=60*m, d=24*h;
        const sug = need<=m ? `${Math.ceil(need/m)}m`
                 : need<=h ? `${Math.ceil(need/h)}h`
                           : `${Math.ceil(need/d)}d`;
        return json({ error:`Too many candles (${buckets}>${MAX_CANDLES})`,
                      suggestion:`Use interval ≥ ${sug}` }, { status: 400 });
      }
    }

    const sinceIso = new Date(since).toISOString().replace("Z", "");
    const untilIso = until ? new Date(until).toISOString().replace("Z", "") : null;
    const useUntil = !!untilIso;

    /* GraphQL ---------------------------------------------------- */
    const gql = `
      query Swaps($pair:String!,$since:Datetime!${useUntil?',$until:Datetime':''},
                  $first:Int!,$offset:Int!){
        allEvents(
          condition:{contract:"con_pairs",event:"Swap"}
          filter:{
            dataIndexed:{contains:{pair:$pair}}
            created:{
              greaterThan:$since
              ${useUntil ? 'lessThan:$until' : ''}
            }
          }
          orderBy:CREATED_DESC
          first:$first
          offset:$offset
        ){ edges{ node{ created data } } }
      }`;

    /* -------- loop & aggregate --------------------------------- */
    const map    = new Map();     // bucketStart → candle
    let   offset = 0, done = false;

    const baseVars = { pair: pairId, since: sinceIso };
    if (useUntil) baseVars.until = untilIso;

    const insert = (k,p0,v0,v1) => {
      const c = map.get(k) ?? {
        t:new Date(k).toISOString(), open:null, high:0, low:Infinity,
        close:null, v0:0, v1:0
      };
      if (c.open === null) c.open = p0;
      c.high = Math.max(c.high, p0);
      c.low  = Math.min(c.low,  p0);
      c.close = c.close === null ? p0 : c.close;   // first in DESC stream
      c.v0 += v0; c.v1 += v1;
      map.set(k, c);
    };

    while (!done) {
      const vars = { ...baseVars, first: CHUNK, offset };
      const r = await executeGraphQLQuery(
        gql, vars, "Upstream GraphQL error on candles"
      );
      const edges = r?.data?.allEvents?.edges ?? [];
      if (!edges.length) break;

      for (const { node:{ created, data } } of edges) {
        const ts  = Date.parse(created);
        const key = Math.floor(ts / ivMs) * ivMs;
        const p0  = price0(data);
        if (p0 === null) continue;
        const v0 = (+data.amount0In  || 0) + (+data.amount0Out || 0);
        const v1 = (+data.amount1In  || 0) + (+data.amount1Out || 0);
        insert(key, p0, v0, v1);
      }
      done   = edges.length < CHUNK;
      offset += CHUNK;
    }

    /* serialise -------------------------------------------------- */
    const candles = [...map.values()]
      .sort((a,b)=> new Date(a.t) - new Date(b.t))
      .map(c => ({
        t: c.t,
        open : token==="0" ? c.open  : 1/c.open,
        high : token==="0" ? c.high  : 1/c.low,
        low  : token==="0" ? c.low   : 1/c.high,
        close: token==="0" ? c.close : 1/c.close,
        volume: token==="0" ? c.v0   : c.v1
      }));

    const page = {
      after : candles.at(-1)?.t ?? null,
      before: candles[0]?.t     ?? null,
      hasNext: !!beforeMs || (!beforeMs && since > 0),
      hasPrev: !!afterMs  || (until ? until < now : false)
    };

    return json({ pairId, token, interval: ivStr, candles, page });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
