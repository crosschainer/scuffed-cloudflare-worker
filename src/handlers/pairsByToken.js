import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

const MAX_LIMIT = 50;

export async function pairsByTokenHandler(req /*, ctx */) {
  try {
    /* ── inputs ─────────────────────────────────────────────── */
    const url   = new URL(req.url);
    const m     = url.pathname.match(/^\/pairs\/with\/([^\/]+)$/);
    const token = m?.[1];
    if (!token)
      return json({ error:"Missing token contract" }, { status:400 });

    const limit  = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(url.searchParams.get("limit")  || "10", 10))
    );
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const order  = (url.searchParams.get("order") || "desc").toLowerCase();
    if (!["asc","desc"].includes(order))
      return json({ error:'order must be "asc" or "desc"' }, { status:400 });

    /* ── GraphQL ------------------------------------------------ */
    const gql = `
      query Pairs($tok:String!,$first:Int!,$offset:Int!) {
        allEvents(
          condition:{ contract:"con_pairs", event:"PairCreated" }
          filter:{
            or:[
              { dataIndexed:{ contains:{ token0:$tok } } }
              { dataIndexed:{ contains:{ token1:$tok } } }
            ]
          }
          orderBy: CREATED_${order.toUpperCase()}
          first:   $first
          offset:  $offset
        ){
          totalCount
          edges{
            node{
              created
              dataIndexed          # ← scalar JSON, no sub-selection
            }
          }
        }
      }`;

    const res   = await executeGraphQLQuery(
      gql,
      { tok: token, first: limit, offset },
      "Upstream GraphQL error /pairs/with"
    );

    const total = res?.data?.allEvents?.totalCount ?? 0;
    const edges = res?.data?.allEvents?.edges      ?? [];

    /* ── transform -------------------------------------------- */
    const pairs = edges.map(({ node }) => {
      const j = node.dataIndexed || {};
      return {
        pair   : j.pair,
        token0 : j.token0,
        token1 : j.token1,
        created: node.created
      };
    });

    const hasMore = offset + limit < total;

    return json({
      token,
      pairs,
      pagination:{
        offset, limit, total,
        next:     hasMore ? offset + limit : null,
        previous: offset > 0 ? Math.max(0, offset - limit) : null,
        order
      }
    });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status:500 });
  }
}
