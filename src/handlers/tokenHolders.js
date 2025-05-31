import { json } from '../utils/response.js';
import { executeGraphQLQuery } from '../utils/graphql.js';

/**
 * Get holders of a specific token with pagination
 * @param {Request} request - The incoming request
 * @param {Object} params - URL parameters
 * @returns {Promise<Response>} - The response with token holders
 */
export async function getTokenHolders(request, { contractName }) {
  try {
    console.log(`Getting token holders for: ${contractName}`);
    
    // Parse query parameters
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);
    
    // Validate and sanitize parameters
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 20); // Max 20 holders per page
    const offset = (safePage - 1) * safeLimit;
    
    // Fetch one extra to determine if there's a next page
    const fetchLimit = safeLimit + 1;
    
    // Query for token holders
    const query = `
      query TokenHolders {
        allStates(
          filter: {
            and: {
              key: { startsWith: "${contractName}.balances:", notLike: "%:%:%" }
              valueNumeric: { greaterThan: "0" }
            }
          }
          orderBy: VALUE_NUMERIC_DESC
          first: ${fetchLimit}
          offset: ${offset}
        ) {
          totalCount
          edges { 
            node { 
              key 
              value 
            } 
          }
        }
      }
    `;
    
    console.log(`Executing query: ${query}`);
    const data = await executeGraphQLQuery(query);
    console.log(`Query result: ${JSON.stringify(data)}`);
    
    // Check if we got results
    const edges = data?.data?.allStates?.edges || [];
    const totalCount = data?.data?.allStates?.totalCount || 0;
    
    if (!edges.length) {
      return json({
        contractName,
        holders: [],
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: totalCount,
          next: null,
          previous: safePage > 1 ? safePage - 1 : null
        }
      });
    }
    
    // Determine if there's a next page
    const hasMore = edges.length > safeLimit;
    // Slice to the requested limit
    const holderEdges = edges.slice(0, safeLimit);
    
    // Process holder data
    const holders = holderEdges.map(({ node }) => {
      const address = node.key.split(':')[1];
      return {
        address,
        balance: parseFloat(node.value)
      };
    });
    
    return json({
      contractName,
      holders,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        next: hasMore ? safePage + 1 : null,
        previous: safePage > 1 ? safePage - 1 : null
      }
    });
  } catch (error) {
    console.error(`Error getting token holders: ${error.message}`);
    console.error(error.stack);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch token holders', 
      message: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}