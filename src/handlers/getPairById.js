/**
 * Handler for GET /pairs/<pairId>
 *
 * Response:
 *   { pairId, token0, token1 }
 *
 * Reads the two keys
 *   con_pairs.pairs:<pairId>:token0
 *   con_pairs.pairs:<pairId>:token1
 * in one GraphQL round-trip.
 */

import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function getPairById(request /*, event */) {
  try {
    const url    = new URL(request.url);
    const pairId = url.searchParams.get("pair");   // added by router helper
    if (!pairId)
      return json({ error: 'Missing "pair" query parameter' }, { status: 400 });

    const key0 = `con_pairs.pairs:${pairId}:token0`;
    const key1 = `con_pairs.pairs:${pairId}:token1`;

    const gql = `
      query PairTokens($k0: String!, $k1: String!) {
        token0: allStates(filter: { key: { equalTo: $k0 } }) {
          edges { node { value } }
        }
        token1: allStates(filter: { key: { equalTo: $k1 } }) {
          edges { node { value } }
        }
      }
    `;

    const data = await executeGraphQLQuery(
      gql,
      { k0: key0, k1: key1 },
      "Upstream GraphQL error on /pairs/<id> query"
    );

    const token0 = data?.data?.token0?.edges?.[0]?.node?.value ?? null;
    const token1 = data?.data?.token1?.edges?.[0]?.node?.value ?? null;

    if (!token0 && !token1)
      return json(
        { error: "Pair not found", pairId },
        { status: 404 }
      );

    return json({ pairId, token0, token1 });
  } catch (err) {
    if (err instanceof Response) return err;
    return json(
      { error: "Failed to fetch pair", message: err.message },
      { status: 500 }
    );
  }
}
