/**
 * Handler for the /total-supply endpoint
 */

import { CHUNK_SIZE, MAXIMUM_SUPPLY } from '../config/constants.js';
import { executeGraphQLQuery } from '../utils/graphql.js';
import { json } from '../utils/response.js';

/**
 * Handler for GET /total-supply
 *
 * 1) Run a GraphQL "count" query to find totalCount of nonzero balances.
 * 2) If totalCount === 0, immediately return { totalSupply: 0 }.
 * 3) Otherwise, loop in chunks of CHUNK_SIZE, fetching `edges { node { value } }`,
 *    summing parseFloat(value) each time.
 * 4) Return JSON { totalSupply: <number> }.
 * 
 * @param {Request} request - The original request
 * @param {FetchEvent} event - The fetch event
 * @returns {Promise<Response>} JSON response with totalSupply
 */
export async function totalSupplyHandler(request, event) {
  // 1a) Count all nonzero balances
  const countQuery = `
    query {
      allStates(
        filter: {
          and: {
            key: { startsWith: "currency.balances:", notLike: "%:%:%" }
            valueNumeric: { greaterThan: "0" }
          }
        }
      ) {
        totalCount
      }
    }
  `;
  
  try {
    const countJson = await executeGraphQLQuery(
      countQuery, 
      {}, 
      "Upstream GraphQL error on count"
    );
    
    const totalCountRaw = countJson?.data?.allStates?.totalCount;
    const totalCount = totalCountRaw != null ? parseInt(totalCountRaw, 10) : 0;

    // 2) If zero nonzero balances:
    if (totalCount === 0) {
      return json({ burnedSupply: MAXIMUM_SUPPLY, maximumSupply: MAXIMUM_SUPPLY, totalSupply: 0 });
    }

    // 3) Otherwise, fetch in chunks of CHUNK_SIZE
    let offset = 0;
    let runningSum = 0;

    const chunkQuery = `
      query FetchChunk($first: Int!, $offset: Int!) {
        allStates(
          filter: {
            and: {
              key: { startsWith: "currency.balances:", notLike: "%:%:%" }
              valueNumeric: { greaterThan: "0" }
            }
          }
          orderBy: VALUE_DESC
          first: $first
          offset: $offset
        ) {
          edges {
            node {
              value
            }
          }
        }
      }
    `;

    while (offset < totalCount) {
      const variables = { first: CHUNK_SIZE, offset: offset };
      const chunkJson = await executeGraphQLQuery(
        chunkQuery, 
        variables, 
        "Upstream GraphQL error on chunk fetch"
      );
      
      const edges = chunkJson?.data?.allStates?.edges || [];

      for (const edge of edges) {
        const rawVal = edge.node?.value;
        if (rawVal != null) {
          runningSum += parseFloat(rawVal) || 0;
        }
      }

      if (edges.length < CHUNK_SIZE) {
        // Fewer than CHUNK_SIZE items → we're done
        break;
      }
      offset += CHUNK_SIZE;
    }

    return json({ 
      burnedSupply: (MAXIMUM_SUPPLY - runningSum), 
      maximumSupply: MAXIMUM_SUPPLY, 
      totalSupply: runningSum 
    });
  } catch (error) {
    // If error is already a Response (from executeGraphQLQuery), return it
    if (error instanceof Response) {
      return error;
    }
    // Otherwise, create a new error response
    return json({ error: error.message || "Internal error" }, { status: 500 });
  }
}