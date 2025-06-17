/* ------------------------------------------------------------------ */
/*  handlers/getPairs.js                                              */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

const CHUNK      = 1_000;          // GraphQL page size
const WINDOW_MS  = 86_400_000;     // 24 h
const NOW        = () => Date.now();

/* helper – price of token0 in token1 units ------------------------- */
const price0 = d => {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  return amount0In > 0 && amount1Out > 0 ? amount0In / amount1Out
       : amount1In > 0 && amount0Out > 0 ? amount0Out / amount1In
       : null;
};

/* ------------------------------------------------------------------ */
/*  GET /pairs?offset=X&limit=Y   – ordered by 24 h-volume DESC       */
/* ------------------------------------------------------------------ */
export async function getPairs(request) {
  try {
    /* ── 0. pagination ───────────────────────────────────────── */
    const url     = new URL(request.url);
    const offset  = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit   = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "25", 10)), 100);

    /* ── 1-a. swaps within the last 24 h ─────────────────────── */
    const sinceIso = new Date(NOW() - WINDOW_MS).toISOString();   // keep the “Z”

    const swaps24hGql = `
      query Swaps24h($since:Datetime!,$first:Int!,$offset:Int!){
        allEvents(
          condition:{contract:"con_pairs",event:"Swap"}
          filter:{created:{greaterThan:$since}}
          orderBy:CREATED_DESC
          first:$first
          offset:$offset
        ){ edges{ node{ data dataIndexed created }} }
      }`;

    const stats = new Map();   // pair → { v0,v1, close, open, baseline }
    let pageOff = 0, done = false;

    while (!done) {
      const res = await executeGraphQLQuery(
        swaps24hGql,
        { since: sinceIso, first: CHUNK, offset: pageOff },
        "GraphQL error on /pairs(24 h) loop"
      );

      const edges = res?.data?.allEvents?.edges ?? [];
      if (!edges.length) break;

      for (const { node } of edges) {
        const { data, dataIndexed } = node;
        const pair = dataIndexed?.pair;
        if (!pair) continue;

        const rec = stats.get(pair) || { v0:0, v1:0, open:undefined, close:undefined };

        /* volume aggregation */
        rec.v0 += (+data.amount0In  || 0) + (+data.amount0Out || 0);
        rec.v1 += (+data.amount1In  || 0) + (+data.amount1Out || 0);

        /* open / close for price-change calc (token-0 side) */
        const p0 = price0(data);
        if (p0 !== null) {
          if (rec.close === undefined) rec.close = p0;   // newest ⇒ close
          rec.open  = p0;                                 // will end oldest
        }
        stats.set(pair, rec);
      }

      done    = edges.length < CHUNK;
      pageOff += CHUNK;
    }

    /* ── 1-b. ONE baseline swap (<=24 h ago) per pair ─────────── */
    const pairsNeedBaseline = [...stats.keys()]
      .filter(id => stats.get(id).close !== undefined && stats.get(id).baseline === undefined);

    if (pairsNeedBaseline.length) {
      const baselineGql = `
        query Baselines($pairs:[String!],$since:Datetime!,$first:Int!,$offset:Int!){
          allEvents(
            condition:{contract:"con_pairs",event:"Swap"}
            filter:{
              dataIndexed:{pair:{in:$pairs}}
              created:{lessThanOrEqualTo:$since}
            }
            orderBy:CREATED_DESC
            first:$first
            offset:$offset
          ){ edges{ node{ data dataIndexed }} }
        }`;

      let off = 0, gotAll = false;
      while (!gotAll) {
        const res = await executeGraphQLQuery(
          baselineGql,
          { pairs:pairsNeedBaseline, since:sinceIso, first:CHUNK, offset:off },
          "GraphQL error on baseline batch"
        );
        const edges = res?.data?.allEvents?.edges ?? [];
        if (!edges.length) break;

        for (const { node } of edges) {
          const pair = node.dataIndexed?.pair;
          const rec  = stats.get(pair);
          if (rec && rec.baseline === undefined) {
            const p0 = price0(node.data);
            if (p0 !== null) rec.baseline = p0;
          }
        }
        gotAll = edges.length < CHUNK;
        off   += CHUNK;
      }
    }

    /* ── 2. static pair metadata (once) ──────────────────────── */
    const metaGql = `
      query PairsMeta {
        allEvents(condition:{contract:"con_pairs",event:"PairCreated"}) {
          edges { node { dataIndexed data } }
        }
      }`;
    const metaRes  = await executeGraphQLQuery(metaGql);
    const pairsMeta = (metaRes?.data?.allEvents?.edges ?? []).map(e => ({
      pair   : e.node.data.pair,
      token0 : e.node.dataIndexed.token0,
      token1 : e.node.dataIndexed.token1
    }));

    /* ── 3. enrich + compute pricePct24h (token-1 denom) ─────── */
    const enriched = pairsMeta.map(m => {
      const s = stats.get(m.pair) || {};

      /* volume: always token-1 (the “USD side”) */
      const volume24h = s.v1 || 0;

      /* price change identical to /pricechange24h?token=1 */
      const pNow0 = s.close;
      const pOld0 = s.baseline ?? s.open;
      let changePct = null;
      if (pNow0 && pOld0) {
        const pNow1 = 1 / pNow0;
        const pOld1 = 1 / pOld0;
        changePct = ((pNow1 - pOld1) / pOld1) * 100;
      }

      return {
        pair        : m.pair,
        token0      : m.token0,
        token1      : m.token1,
        volume24h,
        pricePct24h : changePct
      };
    });

    /* ── 4. rank by volume24h-DESC & paginate ────────────────── */
    enriched.sort((a, b) => b.volume24h - a.volume24h);

    const page    = enriched.slice(offset, offset + limit);
    const hasNext = offset + limit < enriched.length;
    const hasPrev = offset > 0;

    /* ── 5. respond ──────────────────────────────────────────── */
    return json({
      pairs : page,
      pagination : {
        offset,
        limit,
        total   : enriched.length,
        next    : hasNext ? offset + limit : null,
        previous: hasPrev ? Math.max(0, offset - limit) : null
      }
    });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Internal error", message: err.message }, { status: 500 });
  }
}
