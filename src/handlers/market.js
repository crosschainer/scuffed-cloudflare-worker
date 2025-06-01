/**
 * Market data handlers
 */

import axios from 'axios';
import { json } from '../utils/response.js';
import { GRAPHQL_ENDPOINT } from '../config/constants.js';

/**
 * Helper function to extract symbol from contract code
 * @param {string} code - The contract code
 * @returns {string|null} The extracted symbol or null if not found
 */
function extractSymbolFromCode(code) {
  // Try to find symbol in the code
  const symbolMatch = code.match(/symbol\s*=\s*["']([^"']+)["']/i);
  if (symbolMatch && symbolMatch[1]) {
    return symbolMatch[1];
  }
  return null;
}

/**
 * Get all trading pairs from the con_pairs contract
 * 
 * @param {Request} request - The request object
 * @returns {Promise<Response>} The response with trading pairs data
 */
export async function getAllPairs(request) {
  try {
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 20);
    
    // GraphQL query to fetch PairCreated events with pagination
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "PairCreated"}
          orderBy: ID_DESC
          first: ${limit + 1}
          offset: ${offset}
        ) {
          totalCount
          edges {
            node {
              id
              dataIndexed
              data
              created
            }
          }
        }
      }
    `;
    
    const response = await axios.post(
      GRAPHQL_ENDPOINT,
      { query },
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    if (!response.data || !response.data.data || !response.data.data.allEvents) {
      return json({ error: "Failed to fetch trading pairs" }, { status: 500 });
    }
    
    const { edges, totalCount } = response.data.data.allEvents;
    
    // Check if we have a next page
    let nextOffset = null;
    if (edges.length > limit) {
      nextOffset = offset + limit;
      // Remove the extra item we fetched to check for next page
      edges.pop();
    }
    
    // Format the pairs data
    const pairs = edges.map(edge => {
      const { node } = edge;
      const pairData = typeof node.data === 'string' ? JSON.parse(node.data) : node.data;
      
      return {
        token0: node.dataIndexed.token0,
        token1: node.dataIndexed.token1,
        pair_address: pairData.pair,
        block_height: node.id,
        created_at: node.created
      };
    });
    
    // Prepare pagination info
    const pagination = {
      offset,
      limit,
      total: totalCount,
      next: nextOffset,
      previous: offset > 0 ? Math.max(0, offset - limit) : null
    };
    
    return json({ pairs, pagination });
  } catch (error) {
    console.error("Error fetching trading pairs:", error);
    return json({ 
      error: "Failed to fetch trading pairs", 
      message: error.message 
    }, { status: 500 });
  }
}

/**
 * Get all pairs that include a given token / contract name
 * 
 * @param {Request} request
 * @param {{ contractName: string }} params  – path-param extracted by router
 * @returns {Promise<Response>}  – JSON array of matching pairs
 */
export async function getPairsByToken(request, { contractName }) {
  try {
    const url = new URL(request.url);
    const CHUNK_SIZE = 50; // Process in smaller chunks
    let allPairs = [];
    let hasMore = true;
    let offset = 0;
    const MAX_PAIRS = 500; // Set a reasonable upper limit
    
    // Process in chunks until we have all pairs or hit a reasonable limit
    while (hasMore && allPairs.length < MAX_PAIRS && offset < 1000) {
      // Build the query with offset-based pagination
      const query = `
        query {
          allEvents(
            condition: { contract: "con_pairs", event: "PairCreated" }
            orderBy: ID_DESC
            first: ${CHUNK_SIZE}
            offset: ${offset}
          ) {
            totalCount
            edges {
              node {
                id
                created
                dataIndexed
                data
              }
            }
          }
        }
      `;

      const { data } = await axios.post(
        GRAPHQL_ENDPOINT,
        { query },
        { headers: { "Content-Type": "application/json" } }
      );

      const edges = data?.data?.allEvents?.edges || [];
      const totalCount = data?.data?.allEvents?.totalCount || 0;
      
      if (edges.length === 0) {
        hasMore = false;
        break;
      }
      
      // Update offset for next iteration
      offset += CHUNK_SIZE;
      hasMore = offset < totalCount;

      // Filter pairs that include the specified token
      const filteredEdges = edges.filter(({ node }) => {
        const { token0, token1 } = node.dataIndexed;
        return token0 === contractName || token1 === contractName;
      });

      // Format and add to our collection
      const pairsChunk = filteredEdges.map(({ node }) => {
        const payload = typeof node.data === "string"
          ? JSON.parse(node.data)
          : node.data;

        return {
          pair_address: payload.pair,
          token0: node.dataIndexed.token0,
          token1: node.dataIndexed.token1,
          block_height: node.id,
          created_at: node.created,
        };
      });
      
      allPairs = [...allPairs, ...pairsChunk];
      
      // If we've processed a significant number of pairs without finding matches,
      // and we're not near the beginning, we might want to stop early
      if (pairsChunk.length === 0 && offset > 200) {
        break;
      }
    }

    if (allPairs.length === 0) {
      return json(
        { error: `No pairs contain token "${contractName}"` },
        { status: 404 }
      );
    }

    // Add pagination info for the client
    const pagination = {
      total: allPairs.length,
      note: "All matching pairs are returned in a single response"
    };

    return json({ pairs: allPairs, count: allPairs.length, pagination });
  } catch (err) {
    console.error("Error fetching pairs by token:", err);
    return json(
      { error: "Failed to fetch pairs", message: err.message },
      { status: 500 }
    );
  }
}