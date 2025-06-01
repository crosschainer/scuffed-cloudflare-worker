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
 * Get the price for a pair at a specific time
 * @param {string} pairAddress - The pair address
 * @param {Date|null} beforeTime - Get price before this time (null for latest)
 * @returns {Promise<{price: number|null, timestamp: string|null}>} The price and timestamp
 */
async function getPriceForPair(pairAddress, beforeTime = null) {
  try {
    let filterClause = `dataIndexed:{contains:{pair:"${pairAddress}"}}`;
    
    // Add time filter if provided
    if (beforeTime) {
      const formattedTime = beforeTime.toISOString().replace("Z", ""); // remove trailing 'Z'
      filterClause += `, created:{lessThan:"${formattedTime}"}`;
    }
    
    const query = `
      query { 
        allEvents(
          condition: {contract:"con_pairs", event:"Swap"}, 
          filter: {${filterClause}}, 
          orderBy: CREATED_DESC, 
          first: 1
        ) { 
          edges { 
            node { 
              data 
              created
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

    const swapData = data?.data?.allEvents?.edges?.[0]?.node;
    
    if (!swapData) {
      return { price: null, timestamp: null };
    }

    const { amount0In, amount0Out, amount1In, amount1Out } = swapData.data;
    
    // Calculate price based on the swap data
    let price = null;
    
    // If token0 was sold for token1
    if (parseFloat(amount0In) > 0 && parseFloat(amount1Out) > 0) {
      price = parseFloat(amount1Out) / parseFloat(amount0In);
    } 
    // If token1 was sold for token0
    else if (parseFloat(amount1In) > 0 && parseFloat(amount0Out) > 0) {
      price = parseFloat(amount1In) / parseFloat(amount0Out);
    }
    
    return { 
      price, 
      timestamp: swapData.created 
    };
  } catch (error) {
    console.error(`Error fetching price for pair ${pairAddress}:`, error);
    return { price: null, timestamp: null };
  }
}

/**
 * Get the latest price for a pair
 * @param {string} pairAddress - The pair address
 * @returns {Promise<{price: number|null, timestamp: string|null}>} The price and timestamp
 */
async function getLatestPriceForPair(pairAddress) {
  return getPriceForPair(pairAddress);
}

/**
 * Get the price for a pair 24 hours ago
 * @param {string} pairAddress - The pair address
 * @returns {Promise<{price: number|null, timestamp: string|null}>} The price and timestamp
 */
async function get24hAgoPriceForPair(pairAddress) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return getPriceForPair(pairAddress, yesterday);
}

/**
 * Get 24-hour trading volume for a pair
 * @param {string} pairAddress - The pair address
 * @param {string} token0 - The first token in the pair
 * @param {string} token1 - The second token in the pair
 * @returns {Promise<{volumeToken0: number, volumeToken1: number, volumeUSD: number|null}>} The trading volumes
 */
async function get24hVolumeForPair(pairAddress, token0, token1) {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const formattedYesterday = yesterday.toISOString().replace("Z", "");
    
    let volumeToken0 = 0;
    let volumeToken1 = 0;
    let hasMore = true;
    let offset = 0;
    const CHUNK_SIZE = 100;
    
    // Get the XIAN/USD price for USD volume calculation
    const xianUsdPrice = await getXianUsdPrice();
    
    while (hasMore) {
      const query = `
        query {
          allEvents(
            condition: {contract: "con_pairs", event: "Swap"},
            filter: {
              dataIndexed: {contains: {pair: "${pairAddress}"}},
              created: {greaterThanOrEqualTo: "${formattedYesterday}"}
            },
            orderBy: CREATED_DESC,
            first: ${CHUNK_SIZE},
            offset: ${offset}
          ) {
            totalCount
            edges {
              node {
                data
                created
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
      
      if (edges.length === 0) {
        hasMore = false;
        break;
      }
      
      // Process this chunk of swap events
      for (const edge of edges) {
        const swapData = edge.node.data;
        
        // Calculate volume from this swap
        // For token0, we add both in and out amounts
        volumeToken0 += parseFloat(swapData.amount0In || 0) + parseFloat(swapData.amount0Out || 0);
        
        // For token1, we add both in and out amounts
        volumeToken1 += parseFloat(swapData.amount1In || 0) + parseFloat(swapData.amount1Out || 0);
      }
      
      // Update offset for next iteration
      offset += CHUNK_SIZE;
      
      // If we got fewer results than requested, we've reached the end
      if (edges.length < CHUNK_SIZE) {
        hasMore = false;
      }
    }
    
    // Calculate USD volume
    let volumeUSD = null;
    
    // If one of the tokens is XIAN (currency), we can calculate USD volume
    if (token0 === "currency" && xianUsdPrice !== null) {
      volumeUSD = volumeToken0 * xianUsdPrice;
    } else if (token1 === "currency" && xianUsdPrice !== null) {
      volumeUSD = volumeToken1 * xianUsdPrice;
    }
    
    // Divide by 2 to avoid double counting (each swap counts both tokens)
    return {
      volumeToken0: volumeToken0 / 2,
      volumeToken1: volumeToken1 / 2,
      volumeUSD
    };
  } catch (error) {
    console.error(`Error fetching 24h volume for pair ${pairAddress}:`, error);
    return {
      volumeToken0: 0,
      volumeToken1: 0,
      volumeUSD: null
    };
  }
}

/**
 * Get the latest XIAN/USD price
 * @returns {Promise<number|null>} The XIAN/USD price or null if not available
 */
async function getXianUsdPrice() {
  try {
    // Pair 1 is con_usdc/currency (USDC/XIAN)
    const { price } = await getLatestPriceForPair("1");
    
    if (price === null) {
      return null;
    }
    
    // The price from the pair is XIAN/USDC, so we need to take the inverse for USD/XIAN
    return 1 / price;
  } catch (error) {
    console.error("Error fetching XIAN/USD price:", error);
    return null;
  }
}

/**
 * Calculate price change percentage
 * @param {number|null} currentPrice - Current price
 * @param {number|null} previousPrice - Previous price
 * @returns {number|null} - Price change percentage or null if either price is null
 */
function calculatePriceChangePercentage(currentPrice, previousPrice) {
  if (currentPrice === null || previousPrice === null || previousPrice === 0) {
    return null;
  }
  
  return ((currentPrice - previousPrice) / previousPrice) * 100;
}

/**
 * Enhance pair data with price information
 * @param {Array} pairs - The pairs data
 * @returns {Promise<Array>} The enhanced pairs data with price information
 */
async function enhancePairsWithPrices(pairs) {
  // Get the XIAN/USD price once for all pairs
  const xianUsdPrice = await getXianUsdPrice();
  
  // Process all pairs in parallel for better performance
  const enhancedPairsPromises = pairs.map(async (pair) => {
    const { price: currentPrice, timestamp } = await getLatestPriceForPair(pair.pair_address);
    const { price: price24hAgo } = await get24hAgoPriceForPair(pair.pair_address);
    const { volumeToken0, volumeToken1, volumeUSD } = await get24hVolumeForPair(
      pair.pair_address, 
      pair.token0, 
      pair.token1
    );
    
    // Clone the pair object and initialize price fields with null
    const enhancedPair = { 
      ...pair,
      priceXian: null,
      priceUSD: null,
      priceChange24h: null,
      volume24h: {
        token0: volumeToken0,
        token1: volumeToken1,
        usd: volumeUSD
      },
      lastPriceUpdate: null
    };
    
    if (currentPrice !== null) {
      let priceXian, priceUSD, price24hAgoXian;
      
      // If token1 is currency (XIAN), then price is already in XIAN
      if (pair.token1 === "currency") {
        priceXian = currentPrice;
        price24hAgoXian = price24hAgo;
        
        // If we have the XIAN/USD price, calculate the USD price
        if (xianUsdPrice !== null) {
          priceUSD = currentPrice * xianUsdPrice;
        }
      } 
      // If token0 is currency (XIAN), then we need to take the inverse
      else if (pair.token0 === "currency") {
        priceXian = 1 / currentPrice;
        price24hAgoXian = price24hAgo ? 1 / price24hAgo : null;
        
        // If we have the XIAN/USD price, calculate the USD price
        if (xianUsdPrice !== null) {
          priceUSD = (1 / currentPrice) * xianUsdPrice;
        }
      }
      
      enhancedPair.priceXian = priceXian;
      enhancedPair.priceUSD = priceUSD;
      enhancedPair.priceChange24h = calculatePriceChangePercentage(priceXian, price24hAgoXian);
      enhancedPair.lastPriceUpdate = timestamp;
    }
    
    return enhancedPair;
  });
  
  return Promise.all(enhancedPairsPromises);
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
    let pairs = edges.map(edge => {
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
    
    // Always add price information
    pairs = await enhancePairsWithPrices(pairs);
    
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
          created_at: node.created
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

    // Always add price information
    allPairs = await enhancePairsWithPrices(allPairs);

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