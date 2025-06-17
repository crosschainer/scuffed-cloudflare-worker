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
      /* ------------ normalise “USDC / currency” -------------- */
      let { token0, token1 } = meta;
      let invert = false;                         // will we invert price?

      if (token0 === "con_usdc" && token1 === "currency") {
        [token0, token1] = [token1, token0];      // currency / USDC
        invert = true;                            // p₀ must be flipped
      }

      const s   = stats.get(meta.pair) || {};
      const vol0 = s.v0 || 0;
      const vol1 = s.v1 || 0;

      /* ------ pick the “USD-side” consistently ---------------- */
      const volumeUSD = token1 === "con_usdc" ? vol1
                       : token0 === "con_usdc" ? vol0
                       : vol1;                   // fallback

      /* ------ price change (always token-1 perspective) ------- */
      const pNow0 = s.close;
      const pOld0 = s.open;

      let pNowUSD = pNow0 && (invert ? 1 / pNow0 : pNow0);
      let pOldUSD = pOld0 && (invert ? 1 / pOld0 : pOld0);

      const changePct =
        (pNowUSD && pOldUSD) ? ((pNowUSD - pOldUSD) / pOldUSD) * 100 : null;

      return {
        pair        : meta.pair,
        token0,
        token1,
        volume24h   : volumeUSD,
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
