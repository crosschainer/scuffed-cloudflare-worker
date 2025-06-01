/**
 * Market data handlers
 */

import axios from 'axios';
import { json } from '../utils/response.js';
import { GRAPHQL_ENDPOINT } from '../config/constants.js';

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
    // GraphQL query to fetch specific pair details
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "PairCreated"}
          filter: {data: {contains: "{\\"pair\\":\\"${pairAddress}\\"}"}}
          first: 1
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
    
    if (edges.length === 0) {
      return json({ error: "Pair not found" }, { status: 404 });
    }
    
    const { node } = edges[0];
    const pairData = typeof node.data === 'string' ? JSON.parse(node.data) : node.data;
    
    // Now fetch additional details about the tokens in this pair
    const token0Query = `
      query {
        contractByName(name: "${node.dataIndexed.token0}") {
          name
          variables
        }
      }
    `;
    
    const token1Query = `
      query {
        contractByName(name: "${node.dataIndexed.token1}") {
          name
          variables
        }
      }
    `;
    
    const [token0Response, token1Response] = await Promise.all([
      axios.post(GRAPHQL_ENDPOINT, { query: token0Query }, { headers: { 'Content-Type': 'application/json' } }),
      axios.post(GRAPHQL_ENDPOINT, { query: token1Query }, { headers: { 'Content-Type': 'application/json' } })
    ]);
    
    // Extract token details
    const token0Details = token0Response.data?.data?.contractByName?.variables || {};
    const token1Details = token1Response.data?.data?.contractByName?.variables || {};
    
    // Format the pair details with token information
    const pairDetails = {
      pair_address: pairData.pair,
      token0: {
        contract: node.dataIndexed.token0,
        name: token0Details.token_name || node.dataIndexed.token0,
        symbol: token0Details.token_symbol || "",
        logo_url: token0Details.token_logo_url || null
      },
      token1: {
        contract: node.dataIndexed.token1,
        name: token1Details.token_name || node.dataIndexed.token1,
        symbol: token1Details.token_symbol || "",
        logo_url: token1Details.token_logo_url || null
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