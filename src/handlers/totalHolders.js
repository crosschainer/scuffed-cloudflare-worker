/**
 * Handler for the /total-holders endpoint
 */

import { executeGraphQLQuery } from '../utils/graphql.js';
import { json } from '../utils/response.js';

/**
 * Handler for GET /total-holders
 *
 * 1) Run a GraphQL query to count all holders.
 * 2) Return JSON { totalHolders: <number> }.
 * 
 * @param {Request} request - The original request
 * @param {FetchEvent} event - The fetch event
 * @returns {Promise<Response>} JSON response with totalHolders
 */
export async function totalHoldersHandler(request, event) {
  try {
    const holdersQuery = `
      query {
        allStates(
          filter: {
            key: { startsWith: "currency.balances:", notLike: "%:%:%" }
          }
        ) {
          totalCount
        }
      }
    `;
    
    const data = await executeGraphQLQuery(
      holdersQuery, 
      {}, 
      "Upstream GraphQL error on total-holders query"
    );
    
    const totalCountRaw = data?.data?.allStates?.totalCount;
    const totalHolders = totalCountRaw != null ? parseInt(totalCountRaw, 10) : 0;

    return json({ totalHolders });
  } catch (error) {
    // If error is already a Response (from executeGraphQLQuery), return it
    if (error instanceof Response) {
      return error;
    }
    // Otherwise, create a new error response
    return json({ error: error.message || "Internal error" }, { status: 500 });
  }
}