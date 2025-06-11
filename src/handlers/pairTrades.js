/**
 * Handler: GET /pairs/<pairId>/trades
 *
 * Query-string parameters
 *   • offset (default 0)   – row offset (newest = 0)
 *   • limit  (default 50)  – rows to return (max 100)
 *   • token  (default 0)   – 0 = price/amount in token0, 1 = token1
 *
 * Returns newest-first trades plus pagination info.
 */

import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

const LIMIT_HARD = 100;     // never more than this per call

/* price in token0 units */
const price0 = (d = {}) => {
  const { amount0In, amount0Out, amount1In, amount1Out } = d;
  if (amount0In > 0 && amount1Out > 0) return amount0In / amount1Out;
  if (amount1In > 0 && amount0Out > 0) return amount0Out / amount1In;
  return null;
};

export async function pairTradesHandler(request /*, ctx */) {
  try {
    const url     = new URL(request.url);
    const pairId  = url.pathname.match(/^\/pairs\/([^\/]+)\/trades$/)?.[1];
    const token   = url.searchParams.get("token") ?? "0";
    if (!pairId)  return json({ error: "Missing pairId" }, { status: 400 });
    if (!["0", "1"].includes(token))
      return json({ error: 'token must be "0" or "1"' }, { status: 400 });

    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit  = Math.min(
      LIMIT_HARD,
      Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10))
    );

    /* ── GraphQL query ─────────────────────────────────────────── */
    const qry = `
      query Trades($pair:String!,$first:Int!,$offset:Int!) {
        allEvents(
          condition:{ contract:"con_pairs", event:"Swap" }
          filter:{ dataIndexed:{ contains:{ pair:$pair } } }
          orderBy: CREATED_DESC
          first:   $first
          offset:  $offset
        ){
          totalCount
          edges{
            node{
              created
              data
            }
          }
        }
      }`;

    const res   = await executeGraphQLQuery(
      qry,
      { pair: pairId, first: limit, offset },
      "Upstream GraphQL error on trades query"
    );

    const total = res?.data?.allEvents?.totalCount ?? 0;
    const rows  = res?.data?.allEvents?.edges      ?? [];

    /* ── transform rows ───────────────────────────────────────── */
    const trades = rows.map(({ node }) => {
      const d   = node.data || {};
      const ts  = node.created;

      const a0in  = parseFloat(d.amount0In  || 0);
      const a0out = parseFloat(d.amount0Out || 0);
      const a1in  = parseFloat(d.amount1In  || 0);
      const a1out = parseFloat(d.amount1Out || 0);

      /* direction & price from token0 perspective */
      const side0  = a0in > 0 ? "buy" : "sell";          // buy token0 with token1
      const p0     = price0(d);
      if (p0 === null) return null;                      // malformed row -> skip

      /* apply denomination */
      const side   = token === "0" ? side0 : side0 === "buy" ? "sell" : "buy";
      const price  = token === "0" ? p0    : 1 / p0;
      const amount = token === "0" ? (a0in || a0out) : (a1in || a1out);

      return { created: ts, side, amount, price };
    }).filter(Boolean);

    const hasMore = offset + limit < total;

    return json({
      pairId,
      token,
      trades,
      pagination: {
        offset,
        limit,
        total,
        next:     hasMore ? offset + limit : null,
        previous: offset > 0 ? Math.max(0, offset - limit) : null
      }
    });
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Internal error", message: err.message }, { status: 500 });
  }
}
