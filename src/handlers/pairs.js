/* ------------------------------------------------------------------ */
/*  handlers/getPairs.js                                              */
/* ------------------------------------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

const CHUNK      = 1_000;          // swaps page size
const WINDOW_MS  = 86_400_000;     // 24 h
const NOW        = () => Date.now();

/* helper – price of token0 in token1 units ------------------------- */
const price0 = d => {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  return amount0In > 0 && amount1Out > 0 ? amount0In / amount1Out
       : amount1In > 0 && amount0Out > 0 ? amount0Out / amount1In
       : null;
};

/* tiny util -------------------------------------------------------- */
const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/* ------------------------------------------------------------------ */
/*  GET /pairs?offset=X&limit=Y – ordered by 24 h volume (DESC)       */
/* ------------------------------------------------------------------ */
export async function getPairs(request) {
  try {
    /* ── 0. pagination ---------------------------------------- */
    const url     = new URL(request.url);
    const offset  = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit   = Math.min(Math.max(1, parseInt(url.searchParams.get("limit")  || "25", 10)), 100);

    /* ── 1-a. swaps inside the last 24 h ---------------------- */
    const sinceIso = new Date(NOW() - WINDOW_MS).toISOString();   // keep “Z”

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

    const stats = new Map();   // pair → {v0,v1,close,open,baseline}
    let pageOff = 0, done = false;

    while (!done) {
      const res = await executeGraphQLQuery(
        swaps24hGql,
        { since: sinceIso, first: CHUNK, offset: pageOff },
        "GraphQL error on /pairs aggregation"
      );

      const edges = res?.data?.allEvents?.edges ?? [];
      if (!edges.length) break;

      for (const { node } of edges) {
        const { data, dataIndexed } = node;
        const pair = dataIndexed?.pair;
        if (!pair) continue;

        const rec = stats.get(pair) || { v0:0, v1:0, open:undefined, close:undefined };
        /* volumes ---------------------------------------------------- */
        rec.v0 += (+data.amount0In  || 0) + (+data.amount0Out || 0);
        rec.v1 += (+data.amount1In  || 0) + (+data.amount1Out || 0);

        /* open / close for price change ------------------------------ */
        const p0 = price0(data);
        if (p0 !== null) {
          if (rec.close === undefined) rec.close = p0;  // newest ⇒ close
          rec.open = p0;                                // will end oldest
        }
        stats.set(pair, rec);
      }

      done    = edges.length < CHUNK;
      pageOff += CHUNK;
    }

    /* ── 1-b. one baseline swap (≤ since) *per pair* ---------- */
    const needBaseline = [...stats.keys()]
      .filter(id => stats.get(id).close !== undefined && stats.get(id).baseline === undefined);

    if (needBaseline.length) {
      /* reuse the single-pair baseline query from /pricechange24h */
      const baselineGql = `
        query Baseline($pair:String!,$since:Datetime!){
          allEvents(
            first:1 orderBy:CREATED_DESC
            condition:{contract:"con_pairs",event:"Swap"}
            filter:{
              dataIndexed:{contains:{pair:$pair}}
              created:{lessThanOrEqualTo:$since}
            }
          ){ edges{ node{ data }} }
        }`;

      /* polite concurrency: fetch up to 25 baselines in parallel ---- */
      const GROUP = 25;
      for (const grp of chunk(needBaseline, GROUP)) {
        await Promise.all(grp.map(async pairId => {
          const res = await executeGraphQLQuery(
            baselineGql,
            { pair: pairId, since: sinceIso },
            "GraphQL error on baseline fetch"
          );
          const node = res?.data?.allEvents?.edges?.[0]?.node;
          if (node) {
            const p0 = price0(node.data);
            if (p0 !== null) stats.get(pairId).baseline = p0;
          }
        }));
      }
    }

    /* ── 2. static pair metadata ------------------------------------ */
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

    /* ── 3. enrich with volume + Δ% --------------------------- */
    const enriched = pairsMeta.map(m => {
      const s = stats.get(m.pair) || {};

      const volume24h = s.v1 || 0;      // token-1 side (USD)
      let changePct   = null;

      const now0 = s.close;
      const old0 = s.baseline ?? s.open;   // prefer true baseline
      if (now0 && old0) {
        const now1 = 1 / now0;
        const old1 = 1 / old0;
        changePct = ((now1 - old1) / old1) * 100;
      }

      return {
        pair        : m.pair,
        token0      : m.token0,
        token1      : m.token1,
        volume24h,
        pricePct24h : changePct
      };
    });

    /* ── 4. rank by volume24h DESC & paginate ----------------- */
    enriched.sort((a,b) => b.volume24h - a.volume24h);

    const page    = enriched.slice(offset, offset + limit);
    const hasNext = offset + limit < enriched.length;
    const hasPrev = offset > 0;

    /* ── 5. response ----------------------------------------- */
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
    return json({ error:"Internal error", message:err.message }, { status:500 });
  }
}
