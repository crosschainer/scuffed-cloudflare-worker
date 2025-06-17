/* ------------------------------------------------------------------ */
/*  handlers/getPairs.js                                              */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

const CHUNK = 1_000;                     // GraphQL page size
const WINDOW_MS = 86_400_000;            // 24 h
const NOW = () => Date.now();

/* helper – price of token0 in token1 units ------------------------- */
const price0 = d => {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  return amount0In > 0 && amount1Out > 0 ? amount0In / amount1Out
       : amount1In > 0 && amount0Out > 0 ? amount0Out / amount1In
       : null;
};

/* ------------------------------------------------------------------ */
/*  GET  /pairs?offset=X&limit=Y                                      */
/*         (always ordered by volume24h-DESC)                         */
/* ------------------------------------------------------------------ */
export async function getPairs(request) {
  try {
    /* ── 0.  pagination params ─────────────────────────────────── */
    const url    = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit  = Math.min(Math.max(1, parseInt(url.searchParams.get("limit")  || "25",10)), 100);

    /* ── 1.  query **all** swaps in the last 24 h ───────────────── */
    const sinceIso = new Date(NOW() - WINDOW_MS).toISOString();   // keep Z → UTC

    const gql = `
      query Swaps24h($since:Datetime!,$first:Int!,$offset:Int!){
        allEvents(
          condition:{contract:"con_pairs", event:"Swap"}
          filter:{created:{greaterThan:$since}}
          orderBy:CREATED_DESC
          first:$first
          offset:$offset
        ){ edges{node{ data dataIndexed created }} }
      }`;

    const stats = new Map();    // pair → { v0,v1, open?, close? }
    let pageOffset = 0, done = false;

    while (!done) {
      const res = await executeGraphQLQuery(
        gql,
        { since: sinceIso, first: CHUNK, offset: pageOffset },
        "GraphQL error on /pairs aggregation"
      );

      const edges = res?.data?.allEvents?.edges ?? [];
      if (!edges.length) break;

      for (const { node } of edges) {
        const { data, dataIndexed, created } = node;
        const pair = dataIndexed?.pair;
        if (!pair) continue;

        const rec = stats.get(pair) || { v0:0, v1:0, open:undefined, close:undefined };

        /* volume aggregation */
        rec.v0 += (+data.amount0In  || 0) + (+data.amount0Out || 0);
        rec.v1 += (+data.amount1In  || 0) + (+data.amount1Out || 0);

        /* price change (token-0 side) */
        const p0 = price0(data);
        if (p0 !== null) {
          if (rec.close === undefined) rec.close = p0;  // newest ⇒ close
          rec.open = p0;   
        }
        stats.set(pair, rec);
      }

      done        = edges.length < CHUNK;
      pageOffset += CHUNK;
    }

    /* ── 2.  fetch *static* pair metadata (once) ───────────────── */
    const metaGql = `
      query PairsMeta {
        allEvents(
          condition:{contract:"con_pairs",event:"PairCreated"}
        ){ edges{ node{ dataIndexed data } } }
      }`;
    const metaRes = await executeGraphQLQuery(metaGql);
    const pairsMeta = (metaRes?.data?.allEvents?.edges ?? []).map(e => ({
      pair   : e.node.data.pair,
      token0 : e.node.dataIndexed.token0,
      token1 : e.node.dataIndexed.token1
    }));

    /* ── 3.  enrich with stats & compute pricePct24h ───────────── */
    const enriched = pairsMeta.map(meta => {
      const s = stats.get(meta.pair) || {};

      /* ---------- 24 h volume (token-1 side) ---------- */
      const volume24h = s.v1 || 0;           // always token-1 amounts

      /* ---------- price change, EXACTLY like endpoint ----------
         /pairs/<id>/pricechange24h?token=1 inverts price0.       */
      const pNow0 = s.close;                 // newest trade inside window
      const pOld0 = s.open;                  // oldest trade inside window

      let changePct = null;
      if (pNow0 && pOld0) {
        const pNowInv = 1 / pNow0;           // token=1 perspective
        const pOldInv = 1 / pOld0;
        changePct = ((pNowInv - pOldInv) / pOldInv) * 100;
      }

      return {
        pair        : meta.pair,
        token0      : meta.token0,
        token1      : meta.token1,
        volume24h,
        pricePct24h : changePct
      };
    });

    /* ── 4.  rank by volume24h-DESC, slice page ───────────────── */
    enriched.sort((a,b) => b.volume24h - a.volume24h);

    const page  = enriched.slice(offset, offset + limit);
    const hasNext  = offset + limit < enriched.length;
    const hasPrev  = offset > 0;

    /* ── 5.  respond ──────────────────────────────────────────── */
    return json({
      pairs : page,
      pagination : {
        offset,
        limit,
        total   : enriched.length,
        next    : hasNext ? offset + limit       : null,
        previous: hasPrev ? Math.max(0, offset - limit) : null
      }
    });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error:"Internal error", message:err.message }, { status:500 });
  }
}
