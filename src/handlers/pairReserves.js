import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function pairReservesHandler(request /*, event */) {
  try {
    const url    = new URL(request.url);
    const pairId = url.searchParams.get("pair");
    if (!pairId)
      return json({ error: 'Missing "pair" query parameter' }, { status: 400 });

    /* build the two exact keys on the JS side */
    const key0 = `con_pairs.pairs:${pairId}:balance0`;
    const key1 = `con_pairs.pairs:${pairId}:balance1`;

    const gql = `
      query Reserves($key0: String!, $key1: String!) {
        token0: allStates(filter: { key: { equalTo: $key0 } }) {
          edges { node { valueNumeric } }
        }
        token1: allStates(filter: { key: { equalTo: $key1 } }) {
          edges { node { valueNumeric } }
        }
      }
    `;

    const data = await executeGraphQLQuery(
      gql,
      { key0, key1 },                        // ⇦ variables map
      "Upstream GraphQL error on /pairs reserves query"
    );

    const reserve0 = parseFloat(
      data?.data?.token0?.edges?.[0]?.node?.valueNumeric ?? 0
    );
    const reserve1 = parseFloat(
      data?.data?.token1?.edges?.[0]?.node?.valueNumeric ?? 0
    );

    return json({ pairId, reserve0, reserve1 });
  } catch (err) {
    if (err instanceof Response) return err;
    return json(
      { error: "Failed to fetch reserves", message: err.message },
      { status: 500 }
    );
  }
}
