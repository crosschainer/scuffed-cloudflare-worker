/**
 * Handler for the /circulating-supply endpoint
 */

import { EXCLUDED_KEYS } from '../config/constants.js';
import { executeGraphQLQuery } from '../utils/graphql.js';
import { json } from '../utils/response.js';
import { totalSupplyHandler } from './totalSupply.js';

/**
 * Handler for GET /circulating-supply
 *
 * 1) Call totalSupplyHandler() to get { totalSupply }.
 * 2) Run a single GraphQL query to fetch all "excluded" keys & values.
 * 3) Sum parseFloat(value) of each returned node → excludedSum.
 * 4) circulatingSupply = totalSupply − excludedSum.
 * 5) Return JSON { totalSupply, excludedSupply: excludedSum, circulatingSupply, excludedAddresses }.
 * 
 * @param {Request} request - The original request
 * @param {FetchEvent} event - The fetch event
 * @returns {Promise<Response>} JSON response with circulating supply data
 */
export async function circulatingSupplyHandler(request, event) {
  try {
    // 1) Get totalSupply
    const totalResp = await totalSupplyHandler(request, event);
    if (totalResp.status !== 200) {
      // If totalSupplyHandler returned an error, forward it
      return totalResp;
    }
    const totalJson = await totalResp.json();
    const totalSupply = parseFloat(totalJson.totalSupply) || 0;

    // 2) Fetch key & value for each excluded address
    const excludedQuery = `
      query {
        allStates(
          filter: {
            key: { in: [${EXCLUDED_KEYS.map((k) => `"${k}"`).join(", ")}] }
          }
        ) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    `;
    
    const exclJson = await executeGraphQLQuery(
      excludedQuery, 
      {}, 
      "Upstream GraphQL error on excluded-supply query"
    );
    
    const edges = exclJson?.data?.allStates?.edges || [];

    // 3) Build an array of { key, value } and sum numeric values
    const excludedAddresses = [];
    let excludedSum = 0;
    for (const edge of edges) {
      const key = edge.node?.key;
      const rawVal = edge.node?.value;
      const numericVal = rawVal != null ? parseFloat(rawVal) || 0 : 0;

      if (key != null) {
        excludedAddresses.push({ key, value: numericVal });
        excludedSum += numericVal;
      }
    }

    const circulatingSupply = totalSupply - excludedSum;
    const maximumSupply = 111111111; // Assuming 111111111 is the total supply of the token
    const burnedSupply = maximumSupply - totalSupply; // Assuming 111111111 is the total supply of the token
    return json({
      maximumSupply,
      maximum_supply: maximumSupply, // For backward compatibility
      max_supply: maximumSupply, // For backward compatibility
      burnedSupply,
      burned_supply: burnedSupply, // For backward compatibility
      totalSupply,
      total_supply: totalSupply, // For backward compatibility
      circulatingSupply,
      circulating_supply: circulatingSupply, // For backward compatibility
      excludedSupply: excludedSum,
      excludedAddresses,

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