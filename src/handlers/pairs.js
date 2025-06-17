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
          rec.close ??= p0;              // first seen (latest) = close
          rec._lastCreated ??= created;
          rec.open  = p0;                // will end up being the oldest
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
    const enriched = pairsMeta.map(m => {
      const s  = stats.get(m.pair) || {};
      const vol0 = s.v0 || 0;
      const vol1 = s.v1 || 0;
      const priceNow    = s.close ?? null;
      const price24hAgo = s.open  ?? null;
      const changePct   = (price24hAgo && priceNow)
                        ? (priceNow - price24hAgo) / price24hAgo * 100
                        : null;
      return {
        pair   : m.pair,
        token0 : m.token0,
        token1 : m.token1,
        volume24h : vol1,          // 👈  use token-1 side (= “USD”)
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
