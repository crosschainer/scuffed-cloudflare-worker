/**
 * Handler for GET /pairs?offset=<n>&limit=<m>&order=<asc|desc>
 *
 * • Pull PairCreated events (contract = "con_pairs", event = "PairCreated").
 * • Order by CREATED_  ↔  oldest / newest.  (Pair ids are assigned in
 *   creation order, so this is effectively pair-id ASC / DESC.)
 * • Slice + return   { pair, token0, token1 }[]   with classic pagination.
 */

import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function getPairs(request /*, event */) {
  try {
    /* ── 0.  query params ───────────────────────────────────── */
    const url    = new URL(request.url);
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0", 10));
    const limit  = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10)), 50);
    const order  = (url.searchParams.get("order") || "asc").toLowerCase();

    if (order !== "asc" && order !== "desc")
      return json({ error: 'Invalid "order" – use "asc" or "desc"' }, { status: 400 });

    const orderBy = order === "asc" ? "CREATED_ASC" : "CREATED_DESC";
    const fetchLimit = limit + 1;                 // one extra row to test “hasMore”

    /* ── 1.  GraphQL query ──────────────────────────────────── */
    const gqlQuery = `
      query Pairs($first: Int!, $offset: Int!) {
        allEvents(
          condition: { contract: "con_pairs", event: "PairCreated" }
          orderBy:   ${orderBy}
          first:     $first
          offset:    $offset
        ) {
          totalCount
          edges {
            node {
              data
              dataIndexed   # token0 / token1 live here
            }
          }
        }
      }
    `;

    const res = await executeGraphQLQuery(
      gqlQuery,
      { first: fetchLimit, offset },
      "Upstream GraphQL error on /pairs query"
    );

    const edges       = res?.data?.allEvents?.edges       ?? [];
    const totalCount  = res?.data?.allEvents?.totalCount  ?? 0;
    const hasMore     = edges.length > limit;
    const slice       = edges.slice(0, limit);

    /* ── 2.  shape response ─────────────────────────────────── */
    const pairs = slice.map(({ node }) => ({
      pair:   node?.data?.pair ?? null,
      token0: node?.dataIndexed?.token0 ?? null,
      token1: node?.dataIndexed?.token1 ?? null
    }));

    return json({
      pairs,
      pagination: {
        offset,
        limit,
        total: totalCount,
        next:     hasMore           ? offset + limit : null,
        previous: offset > 0        ? Math.max(0, offset - limit) : null,
        order
      }
    });
  } catch (err) {
    if (err instanceof Response) return err;       // propagate wrapped error
    return json(
      { error: "Failed to fetch pairs", message: err.message },
      { status: 500 }
    );
  }
}
