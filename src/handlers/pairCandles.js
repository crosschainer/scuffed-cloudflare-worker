/* ------------------------------------------------------------------ */
/*  handlers/pairCandles.js                                           */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json } from "../utils/response.js";

/* safety knobs --------------------------------------------------- */
const CHUNK = 1_000;   // GraphQL page size
const MAX_CANDLES = 5_000;   // hard ceiling per response
const TOLERANCE = 1e-12;     // price continuity tolerance

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
    /* ── parse & validate params ─────────────────────────────── */
    const url = new URL(request.url);
    const pairId = url.pathname.match(/^\/pairs\/([^\/]+)\/candles$/)?.[1];
    const token = url.searchParams.get("token") ?? "0";
    const ivStr = url.searchParams.get("interval") ?? "1h";
    const rangeStr = url.searchParams.get("range") ?? "1d";
    const beforeQ = url.searchParams.get("before");   // ISO or ms
    const afterQ = url.searchParams.get("after");

    if (!pairId) return json({ error: "Missing pairId" }, { status: 400 });
    if (!["0", "1"].includes(token))
      return json({ error: 'token must be "0" or "1"' }, { status: 400 });
    if (beforeQ && afterQ)
      return json({ error: "Use only one of before or after" }, { status: 400 });

    /* ── time window calc ───────────────────────────────────── */
    const ivMs = intervalMs(ivStr);
    let rangeMs = intervalMs(rangeStr);

    // cursor-mode widens window
    if (beforeQ || afterQ) rangeMs = MAX_CANDLES * ivMs;

    const now = Date.now();
    const beforeMs = beforeQ ? Date.parse(beforeQ) || +beforeQ : null;
    const afterMs = afterQ ? Date.parse(afterQ) || +afterQ : null;

    const sinceMs = beforeMs != null
      ? beforeMs - rangeMs
      : afterMs != null
        ? afterMs
        : now - rangeMs;

    // always set an explicit until
    const untilMs = beforeMs != null
      ? beforeMs
      : afterMs != null
        ? Math.min(afterMs + rangeMs, now)
       : now;
    // sanity check on pure-range
    if (beforeMs == null && afterMs == null) {
      const buckets = Math.ceil(rangeMs / ivMs);
      if (buckets > MAX_CANDLES) {
        const need = rangeMs / MAX_CANDLES, m = 60e3, h = 3600e3, d = 86400e3;
        const sug = need <= m ? `${Math.ceil(need / m)}m`
          : need <= h ? `${Math.ceil(need / h)}h`
            : `${Math.ceil(need / d)}d`;
        return json({
          error: `Too many candles (${buckets}>${MAX_CANDLES})`,
          suggestion: `Use interval ≥ ${sug}`
        }, { status: 400 });
      }
    }

    const sinceIso = new Date(sinceMs).toISOString();   // keep the Z → stays UTC
 const untilIso = new Date(untilMs).toISOString();

    /* ── GraphQL paged load ───────────────────────────────────── */
    const gql = `
      query Swaps(
        $pair: String!,
        $since: Datetime!,
        $until: Datetime!,
        $first: Int!,
        $offset: Int!
      ) {
        allEvents(
          condition:{contract:"con_pairs",event:"Swap"}
          filter:{
            dataIndexed:{contains:{pair:$pair}}
            created:{greaterThanOrEqualTo:$since, lessThanOrEqualTo:$until}
          }
          orderBy: CREATED_DESC
          first:$first
          offset:$offset
        ){
          edges { node { created data } }
        }
      }
    `;

    let offset = 0, done = false;
    const raw = new Map(); // bucketStart → { open,high,low,close,v0,v1,openT,closeT }

    while (!done) {
      const res = await executeGraphQLQuery(
        gql,
        { pair: pairId, since: sinceIso, until: untilIso, first: CHUNK, offset },
        "Upstream GraphQL error on candles"
      );
      const edges = res?.data?.allEvents?.edges || [];
      if (!edges.length) break;

      for (const { node: { created, data } } of edges) {
        const ts = Date.parse(created);
        const bucket = Math.floor(ts / ivMs) * ivMs;
        const p0 = price0(data);
        if (p0 === null) continue;

        let c = raw.get(bucket);
        if (!c) {
          c = {
            t: new Date(bucket).toISOString(),
            open: p0,
            high: p0,
            low: p0,
            close: p0,
            v0: 0,
            v1: 0,
            openT: ts,
            closeT: ts
          };
        }

        // aggregate high/low
        c.high = Math.max(c.high, p0);
        c.low = Math.min(c.low, p0);

        // correct open/close ordering
        if (ts < c.openT) { c.openT = ts; c.open = p0 }
        if (ts > c.closeT) { c.closeT = ts; c.close = p0 }

        // volumes
        c.v0 += (+data.amount0In || 0) + (+data.amount0Out || 0);
        c.v1 += (+data.amount1In || 0) + (+data.amount1Out || 0);

        raw.set(bucket, c);
      }

      done = edges.length < CHUNK;
      offset += CHUNK;
    }

    /* ── fill every bucket  & serialize ───────────────────────── */
    const candles = [];
    let lastClose = null;
    // start at the first full bucket ≥ sinceMs
    const start = Math.ceil(sinceMs / ivMs) * ivMs;
    const end = Math.floor(untilMs / ivMs) * ivMs;

    for (let b = start; b <= end; b += ivMs) {
      const rec = raw.get(b);

      if (rec) {
        // price in current bucket, adjusted for token perspective
        const recOpen = token === "0" ? rec.open : 1 / rec.open;

        // ── continuity check ────────────────────────────────
        if (lastClose != null && Math.abs(recOpen - lastClose) > TOLERANCE) {
          // Insert a synthetic candle that bridges the gap between lastClose and recOpen
          // Use a timestamp 1 ms before the current bucket so ordering stays intact
          candles.push({
            t: new Date(b - 1).toISOString(), // just before current bucket start
            open: lastClose,
            high: Math.max(lastClose, recOpen),
            low: Math.min(lastClose, recOpen),
            close: recOpen,
            volume: 0,
            fake: true
          });
          // After the fake candle, continuity is restored
          lastClose = recOpen;
        }

        const open  = lastClose ?? recOpen; // after possible synthetic insertion
        const close = token === "0" ? rec.close : 1 / rec.close;

        candles.push({
          t: rec.t,
          open,
          high: token === "0" ? rec.high : 1 / rec.low,
          low:  token === "0" ? rec.low  : 1 / rec.high,
          close,
          volume: token === "0" ? rec.v0 : rec.v1
        });

        lastClose = close;

      } else if (lastClose != null) {
        // bucket with no trades – flat candle to keep the chart continuous
        candles.push({
          t: new Date(b).toISOString(),
          open: lastClose,
          high: lastClose,
          low: lastClose,
          close: lastClose,
          volume: 0
        });
        // lastClose remains unchanged
      }
    }

    const page = {
      after: candles.at(-1)?.t ?? null,
      before: candles[0]?.t ?? null,         // include the bucket itself
      hasNext: !!beforeQ || (!beforeQ && sinceMs > 0 && untilMs < now),
      hasPrev: !!afterQ || (untilMs < now)
    };

    return json({ pairId, token, interval: ivStr, candles, page });
  }
  catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
