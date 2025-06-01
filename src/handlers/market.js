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
 * Get details for a specific trading pair
 * 
 * @param {Request} request - The request object
 * @param {Object} params - Route parameters
 * @param {string} params.pairAddress - The pair address
 * @returns {Promise<Response>} The response with pair details
 */
export async function getPairByAddress(request, { pairAddress }) {
  try {
    // GraphQL query to fetch all pairs and filter client-side
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "PairCreated"}
        ) {
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
      return json({ error: "Failed to fetch pair details" }, { status: 500 });
    }
    
    const { edges } = response.data.data.allEvents;
    
    // Filter the pair by address client-side
    const pairEdge = edges.find(edge => {
      const pairData = typeof edge.node.data === 'string' ? JSON.parse(edge.node.data) : edge.node.data;
      // Compare as strings to handle potential type mismatches
      return String(pairData.pair) === String(pairAddress);
    });
    
    if (!pairEdge) {
      return json({ error: "Pair not found" }, { status: 404 });
    }
    
    const { node } = pairEdge;
    const pairData = typeof node.data === 'string' ? JSON.parse(node.data) : node.data;
    
    // Now fetch additional details about the tokens in this pair
    const token0Query = `
      query {
        contractByName(name: "${node.dataIndexed.token0}") {
          name
          code
        }
      }
    `;
    
    const token1Query = `
      query {
        contractByName(name: "${node.dataIndexed.token1}") {
          name
          code
        }
      }
    `;
    
    const [token0Response, token1Response] = await Promise.all([
      axios.post(GRAPHQL_ENDPOINT, { query: token0Query }, { headers: { 'Content-Type': 'application/json' } }),
      axios.post(GRAPHQL_ENDPOINT, { query: token1Query }, { headers: { 'Content-Type': 'application/json' } })
    ]);
    
    // Extract token details
    const token0Contract = token0Response.data?.data?.contractByName || {};
    const token1Contract = token1Response.data?.data?.contractByName || {};
    
    // Extract symbols from code if available
    const token0Symbol = token0Contract.code ? extractSymbolFromCode(token0Contract.code) : null;
    const token1Symbol = token1Contract.code ? extractSymbolFromCode(token1Contract.code) : null;
    
    const token0Details = {
      token_name: token0Contract.name || node.dataIndexed.token0,
      token_symbol: token0Symbol || "",
      token_logo_url: null
    };
    
    const token1Details = {
      token_name: token1Contract.name || node.dataIndexed.token1,
      token_symbol: token1Symbol || "",
      token_logo_url: null
    };
    
    // Format the pair details with token information
    const pairDetails = {
      pair_address: pairData.pair,
      token0: {
        contract: node.dataIndexed.token0,
        name: token0Details.token_name,
        symbol: token0Details.token_symbol,
        logo_url: token0Details.token_logo_url
      },
      token1: {
        contract: node.dataIndexed.token1,
        name: token1Details.token_name,
        symbol: token1Details.token_symbol,
        logo_url: token1Details.token_logo_url
      },
      block_height: node.id,
      created_at: node.created
    };
    
    return json(pairDetails);
  } catch (error) {
    console.error("Error fetching pair details:", error);
    return json({ 
      error: "Failed to fetch pair details", 
      message: error.message 
    }, { status: 500 });
  }
}