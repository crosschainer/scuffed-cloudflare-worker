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
    // GraphQL: fetch PairCreated where token0 == contract OR token1 == contract
    // We order newest first; return up to 200 pairs (adjust if you want paging)
    const query = `
      query GetPairsByToken($contract: String!) {
        allEvents(
          condition: { contract: "con_pairs", event: "PairCreated" }
          filter: {
            or: [
              { dataIndexed: { token0: { equalTo: $contract } } }
              { dataIndexed: { token1: { equalTo: $contract } } }
            ]
          }
          orderBy: ID_DESC
          first: 200
        ) {
          edges {
            node {
              id
              created                       # block time
              dataIndexed { token0 token1 } # decoded JSON columns
              data                          # raw JSON string
            }
          }
        }
      }
    `;

    const variables = { contract: contractName };
    const { data } = await axios.post(
      GRAPHQL_ENDPOINT,
      { query, variables },
      { headers: { "Content-Type": "application/json" } }
    );

    const edges = data?.data?.allEvents?.edges || [];

    // Format each edge → nice JSON
    const pairs = edges.map(({ node }) => {
      const payload = typeof node.data === "string"
        ? JSON.parse(node.data)
        : node.data;                          // { pair: "...", token0, token1, … }

      return {
        pair_address: payload.pair,
        token0: node.dataIndexed.token0,
        token1: node.dataIndexed.token1,
        block_height: node.id,
        created_at: node.created,
      };
    });

    if (pairs.length === 0) {
      return json(
        { error: `No pairs contain token “${contractName}”` },
        { status: 404 }
      );
    }

    return json({ pairs, count: pairs.length });
  } catch (err) {
    console.error("Error fetching pairs by token:", err);
    return json(
      { error: "Failed to fetch pairs", message: err.message },
      { status: 500 }
    );
  }
}
