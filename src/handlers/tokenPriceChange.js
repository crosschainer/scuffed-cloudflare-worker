import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function pairPriceChange24hHandler(request, event) {
  try {
    /* ── 0. inputs ─────────────────────────────────────────── */
    const url     = new URL(request.url);
    const pairId  = url.searchParams.get("pair");
    const token   = url.searchParams.get("token") ?? "0";

    if (!pairId)
      return json({ error: 'Missing "pair" query parameter' }, { status: 400 });
    if (token !== "0" && token !== "1")
      return json({ error: 'Invalid "token" param – must be "0" or "1"' },
                  { status: 400 });

    /* ── 1. GraphQL query (one round-trip) ─────────────────── */
    const since = new Date(Date.now() - 86_400_000).toISOString();   // keep “Z”

    const priceQuery = `
      query PriceChangeLast24h($pair:String!,$since:Datetime!){
    latest: allEvents(
      first:1 orderBy:CREATED_DESC
      condition:{contract:"con_pairs",event:"Swap"}
      filter:{dataIndexed:{contains:{pair:$pair}}}
    ){ edges{node{data created}} }

    baseline: allEvents(                       # ⟵ renamed
      first:1 orderBy:CREATED_DESC
      condition:{contract:"con_pairs",event:"Swap"}
      filter:{
        dataIndexed:{contains:{pair:$pair}}
        created:{lessThanOrEqualTo:$since}     # ⟵ OUTside window
      }
    ){ edges{node{data created}} }
  }
    `;

    const gql = await executeGraphQLQuery(
      priceQuery,
      { pair: pairId, since },
      "Upstream GraphQL error on pair-pricechange24h query"
    );

    /* ── 2. helpers ────────────────────────────────────────── */
    const calcPrice0 = (d = {}) => {
      const { amount0In, amount0Out, amount1In, amount1Out } = d;
      if (amount0In > 0 && amount1Out > 0) return amount0In / amount1Out;
      if (amount1In > 0 && amount0Out > 0) return amount0Out / amount1In;
      return 0;
    };

    const latestData   = gql?.data?.latest?.edges?.[0]?.node?.data;
const baselineData = gql?.data?.baseline?.edges?.[0]?.node?.data;

if (!latestData || !baselineData) {
  return json({ pairId, token, priceNow:null, price24hAgo:null,
                changePct:null, error:"Not enough data" }, { status:200 });
}
    


    let priceNow    = calcPrice0(latestData);
    let price24hAgo = calcPrice0(baselineData);

    if (token === "1") {
      priceNow    = priceNow    ? 1 / priceNow    : 0;
      price24hAgo = price24hAgo ? 1 / price24hAgo : 0;
    }

    const changePct =
      price24hAgo > 0 ? ((priceNow - price24hAgo) / price24hAgo) * 100 : null;

    /* ── 3. response ───────────────────────────────────────── */
    return json({ pairId, token, priceNow, price24hAgo, changePct });
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
