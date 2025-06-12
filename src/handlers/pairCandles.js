/* ------------------------------------------------------------------ */
/*  handlers/pairCandles.js                                           */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

/* safety knobs --------------------------------------------------- */
const CHUNK       = 1_000;   // GraphQL page size
const MAX_CANDLES = 5_000;   // hard ceiling per response

/* "5m" | "2h" | "7d" → ms ---------------------------------------- */
function intervalMs(str = "1h") {
  const m = str.match(/^(\d+)([mhd])$/i);
  if (!m) throw new Error("Bad interval");
  const n = +m[1];
  return m[2] === "m" ? n * 60e3
       : m[2] === "h" ? n * 3600e3
                      : n * 86400e3;
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
    const url      = new URL(request.url);
    const pairId   = url.pathname.match(/^\/pairs\/([^\/]+)\/candles$/)?.[1];
    const token    = url.searchParams.get("token")    ?? "0";
    const ivStr    = url.searchParams.get("interval") ?? "1h";
    const rangeStr = url.searchParams.get("range")    ?? "1d";
    const beforeQ  = url.searchParams.get("before");
    const afterQ   = url.searchParams.get("after");

    if (!pairId)
      return json({ error:"Missing pairId" }, { status:400 });
    if (!["0","1"].includes(token))
      return json({ error:'token must be "0" or "1"' }, { status:400 });
    if (beforeQ && afterQ)
      return json({ error:"Use only one of before or after" }, { status:400 });

    // parse interval + base window
    const ivMs    = intervalMs(ivStr);
    let   rangeMs = intervalMs(rangeStr);

    // cursor mode: allow up to MAX_CANDLES worth of data
    if (beforeQ || afterQ) rangeMs = MAX_CANDLES * ivMs;

    const now      = Date.now();
    const beforeMs = beforeQ ? Date.parse(beforeQ)||+beforeQ : null;
    const afterMs  = afterQ  ? Date.parse(afterQ) ||+afterQ  : null;

    // compute since/until
    const sinceMs = beforeMs != null
      ? beforeMs - rangeMs
      : afterMs  != null
        ? afterMs
        : now - rangeMs;

    const untilMs = beforeMs != null
      ? beforeMs
      : afterMs  != null
        ? afterMs + rangeMs
        : now;           // in pure range mode, use now as "until"

    // sanity check for too many buckets (only in pure range)
    if (beforeMs==null && afterMs==null) {
      const buckets = Math.ceil(rangeMs/ivMs);
      if (buckets > MAX_CANDLES) {
        const need = rangeMs/MAX_CANDLES;
        const m=60e3, h=3600e3, d=86400e3;
        const sug = need<=m ? `${Math.ceil(need/m)}m`
                 : need<=h ? `${Math.ceil(need/h)}h`
                           : `${Math.ceil(need/d)}d`;
        return json({
          error:`Too many candles (${buckets}>${MAX_CANDLES})`,
          suggestion:`Use interval ≥ ${sug}`
        }, { status:400 });
      }
    }

    const sinceIso = new Date(sinceMs).toISOString().replace("Z",""),
          untilIso = new Date(untilMs).toISOString().replace("Z","");

    /* ── GraphQL loop ------------------------------------------- */
    const gql = `
      query Swaps(
        $pair:   String!,
        $since:  Datetime!,
        $until:  Datetime!,
        $first:  Int!,
        $offset: Int!
      ) {
        allEvents(
          condition:{contract:"con_pairs",event:"Swap"}
          filter:{
            dataIndexed:{contains:{pair:$pair}}
            created:{
              greaterThan:$since
              lessThan:$until
            }
          }
          orderBy: CREATED_DESC
          first:$first
          offset:$offset
        ) {
          edges { node { created data } }
        }
      }
    `;

    let offset=0, done=false;
    const buckets = new Map(); // bucketStart → { open,high,low,close,v0,v1,openT,closeT }

    while (!done) {
      const r = await executeGraphQLQuery(
        gql,
        {
          pair:   pairId,
          since:  sinceIso,
          until:  untilIso,
          first:  CHUNK,
          offset
        },
        "Upstream GraphQL error on candles"
      );
      const edges = r?.data?.allEvents?.edges || [];
      if (!edges.length) break;

      for (const {node:{created,data}} of edges) {
        const ts     = Date.parse(created);
        const bucket = Math.floor(ts/ivMs)*ivMs;
        const p0     = price0(data);
        if (p0===null) continue;

        let rec = buckets.get(bucket);
        if (!rec) {
          rec = {
            t: new Date(bucket).toISOString(),
            open:   p0,
            high:   p0,
            low:    p0,
            close:  p0,
            v0:     0,
            v1:     0,
            openT:  ts,
            closeT: ts
          };
        }

        // high/low
        rec.high = Math.max(rec.high, p0);
        rec.low  = Math.min(rec.low,  p0);

        // true open
        if (ts < rec.openT) {
          rec.openT = ts;
          rec.open  = p0;
        }
        // true close
        if (ts > rec.closeT) {
          rec.closeT = ts;
          rec.close  = p0;
        }

        // volume
        rec.v0 += (+data.amount0In  || 0) + (+data.amount0Out || 0);
        rec.v1 += (+data.amount1In  || 0) + (+data.amount1Out || 0);

        buckets.set(bucket, rec);
      }

      done   = edges.length < CHUNK;
      offset += CHUNK;
    }

    /* ── serialize into sorted array --------------------------- */
    const candles = [...buckets.values()]
      .sort((a,b)=> new Date(a.t) - new Date(b.t))
      .map(c=>({
        t     : c.t,
        open  : token==="0" ? c.open  : 1/c.open,
        high  : token==="0" ? c.high  : 1/c.low,
        low   : token==="0" ? c.low   : 1/c.high,
        close : token==="0" ? c.close : 1/c.close,
        volume: token==="0" ? c.v0    : c.v1
      }));

    const page = {
      after  : candles.at(-1)?.t ?? null,
      before : candles[0]?.t      ?? null,
      hasNext: !!beforeQ  || (!beforeQ  && sinceMs > 0),
      hasPrev: !!afterQ   || ( untilMs < now )
    };

    return json({ pairId, token, interval: ivStr, candles, page });
  }
  catch(err) {
    if (err instanceof Response) return err;
    return json({ error: err.message||"Internal error" }, { status:500 });
  }
}
