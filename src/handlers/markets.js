/**
 * Handlers for market-related endpoints
 */

import { json } from '../utils/response.js';
import { executeGraphQLQuery } from '../utils/graphql.js';

/**
 * Get all markets (token pairs)
 * 
 * @param {Request} request - The incoming request
 * @returns {Promise<Response>} JSON response with markets data
 */
export async function getAllMarkets(request) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  
  try {
    // Query to get all PairCreated events
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "PairCreated"}
        ) {
          edges {
            node {
              dataIndexed
              data
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(
      query,
      {},
      "Failed to fetch markets data"
    );
    
    // Extract and format pairs data
    const edges = result.data?.allEvents?.edges || [];
    const pairs = edges.map(e => ({
      pair: e.node?.data?.pair || null,
      token0: e.node?.dataIndexed?.token0,
      token1: e.node?.dataIndexed?.token1,
      label: `${e.node?.dataIndexed?.token0 || ''} / ${e.node?.dataIndexed?.token1 || ''}`
    })).filter(p => p.pair);
    
    // Sort pairs by pair name
    pairs.sort((a, b) => a.pair.localeCompare(b.pair));
    
    // Apply pagination
    const total = pairs.length;
    const paginatedPairs = pairs.slice(offset, offset + limit);
    
    // Fetch token symbols for all tokens in the pairs
    const allTokens = new Set();
    paginatedPairs.forEach(pair => {
      allTokens.add(pair.token0);
      allTokens.add(pair.token1);
    });
    const tokenSymbols = await fetchTokenSymbols([...allTokens]);
    
    // Fetch latest prices for each pair
    const marketsWithPrices = await Promise.all(
      paginatedPairs.map(async (pair) => {
        const price0 = await getLatestPrice(pair.pair, true);
        const price1 = await getLatestPrice(pair.pair, false);
        
        // Get 24h historical prices
        const price0_24h = await getHistoricalPrice(pair.pair, true);
        const price1_24h = await getHistoricalPrice(pair.pair, false);
        
        // Calculate change percentage
        const changePct0 = price0_24h > 0 ? ((price0 - price0_24h) / price0_24h) * 100 : 0;
        const changePct1 = price1_24h > 0 ? ((price1 - price1_24h) / price1_24h) * 100 : 0;
        
        // Calculate USD price if paired with a stablecoin
        let usdPrice0 = null;
        let usdPrice1 = null;
        
        const stablecoins = ["con_usdc", "con_usdt", "con_dai"];
        
        if (stablecoins.includes(pair.token1) && price0 > 0) {
          usdPrice0 = price0;
        } else if (stablecoins.includes(pair.token0) && price1 > 0) {
          usdPrice1 = price1;
        }
        
        return {
          ...pair,
          token0Symbol: tokenSymbols[pair.token0] || pair.token0,
          token1Symbol: tokenSymbols[pair.token1] || pair.token1,
          price0: price0 || null,
          price1: price1 || null,
          changePct0: price0 > 0 ? changePct0 : null,
          changePct1: price1 > 0 ? changePct1 : null,
          usdPrice0,
          usdPrice1,
          volume24h: await calculateVolume(pair.pair)
        };
      })
    );
    
    return json({
      markets: marketsWithPrices,
      pagination: {
        offset,
        limit,
        total,
        next: offset + limit < total ? offset + limit : null,
        previous: offset > 0 ? Math.max(0, offset - limit) : null
      }
    });
  } catch (error) {
    console.error("Error fetching markets:", error);
    return json({ error: "Failed to fetch markets data" }, { status: 500 });
  }
}

/**
 * Get markets for a specific token
 * 
 * @param {Request} request - The incoming request
 * @param {Object} params - Route parameters
 * @param {string} params.contractName - The token contract name
 * @returns {Promise<Response>} JSON response with token markets data
 */
export async function getMarketsForToken(request, { contractName }) {
  try {
    // Query to get all PairCreated events
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "PairCreated"}
        ) {
          edges {
            node {
              dataIndexed
              data
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(
      query,
      {},
      `Failed to fetch markets data for token ${contractName}`
    );
    
    // Extract and format pairs data
    const edges = result.data?.allEvents?.edges || [];
    const allPairs = edges.map(e => ({
      pair: e.node?.data?.pair || null,
      token0: e.node?.dataIndexed?.token0,
      token1: e.node?.dataIndexed?.token1,
      label: `${e.node?.dataIndexed?.token0 || ''} / ${e.node?.dataIndexed?.token1 || ''}`
    })).filter(p => p.pair);
    
    // Filter pairs related to the specified token
    const relatedPairs = allPairs.filter(p => 
      p.token0 === contractName || p.token1 === contractName
    );
    
    // Get unique paired tokens
    const uniqueTokens = new Set(
      relatedPairs.map(p => (p.token0 === contractName ? p.token1 : p.token0))
    );
    
    // Fetch token symbols
    const tokenSymbols = await fetchTokenSymbols([...uniqueTokens]);
    
    // Process each related pair
    const markets = await Promise.all(
      relatedPairs.map(async (p) => {
        const baseIsToken0 = p.token0 === contractName;
        const pairedToken = baseIsToken0 ? p.token1 : p.token0;
        const pairedSymbol = tokenSymbols[pairedToken] || pairedToken;
        const baseSymbol = tokenSymbols[contractName] || contractName;
        
        // Get current price
        let price = await getLatestPrice(p.pair, baseIsToken0);
        if (price === 0) {
          const inversePrice = await getLatestPrice(p.pair, !baseIsToken0);
          if (inversePrice > 0) price = 1 / inversePrice;
        }
        
        // Skip if no price data
        if (price === 0) return null;
        
        // Get 24h historical price
        let price24h = await getHistoricalPrice(p.pair, baseIsToken0);
        if (price24h === 0) {
          const inversePrice24h = await getHistoricalPrice(p.pair, !baseIsToken0);
          if (inversePrice24h > 0) price24h = 1 / inversePrice24h;
        }
        
        // Calculate change percentage
        const changePct = price24h > 0 ? ((price - price24h) / price24h) * 100 : 0;
        
        // Calculate USD price if paired with a stablecoin
        let usdPrice = null;
        const stablecoins = ["con_usdc", "con_usdt", "con_dai"];
        
        if (stablecoins.includes(pairedToken)) {
          usdPrice = price;
        }
        
        // Calculate 24h volume
        const volume24h = await calculateVolume(p.pair);
        
        return {
          pair: p.pair,
          token0: p.token0,
          token1: p.token1,
          token0Symbol: tokenSymbols[p.token0] || p.token0,
          token1Symbol: tokenSymbols[p.token1] || p.token1,
          label: `${baseSymbol} / ${pairedSymbol}`,
          price,
          pairedToken,
          pairedSymbol,
          baseSymbol,
          changePct,
          usdPrice,
          volume24h,
          lastTraded: await getLastTradedTime(p.pair)
        };
      })
    );
    
    // Filter out null entries (pairs with no price data)
    const validMarkets = markets.filter(m => m !== null);
    
    return json({
      contractName,
      markets: validMarkets
    });
  } catch (error) {
    console.error(`Error fetching markets for token ${contractName}:`, error);
    return json({ error: `Failed to fetch markets data for token ${contractName}` }, { status: 500 });
  }
}

/**
 * Get the latest price for a pair
 * 
 * @param {string} pair - The pair contract name
 * @param {boolean} baseIsToken0 - Whether the base token is token0
 * @returns {Promise<number>} The latest price
 */
async function getLatestPrice(pair, baseIsToken0) {
  try {
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "Swap"},
          filter: {dataIndexed: {contains: {pair: "${pair}"}}},
          orderBy: CREATED_DESC,
          first: 1
        ) {
          edges {
            node {
              data
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(query);
    const data = result.data?.allEvents?.edges?.[0]?.node?.data || {};
    
    const a0in = parseFloat(data.amount0In || 0);
    const a1in = parseFloat(data.amount1In || 0);
    const a0out = parseFloat(data.amount0Out || 0);
    const a1out = parseFloat(data.amount1Out || 0);
    
    if (baseIsToken0 && a0in > 0 && a1out > 0) return a1out / a0in;
    if (!baseIsToken0 && a1in > 0 && a0out > 0) return a0out / a1in;
    
    return 0;
  } catch (error) {
    console.error(`Price fetch failed for ${pair}:`, error);
    return 0;
  }
}

/**
 * Get the historical price (24h ago) for a pair
 * 
 * @param {string} pair - The pair contract name
 * @param {boolean} baseIsToken0 - Whether the base token is token0
 * @returns {Promise<number>} The historical price
 */
async function getHistoricalPrice(pair, baseIsToken0) {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const formatted = yesterday.toISOString().replace("Z", "");
    
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "Swap"},
          filter: {
            dataIndexed: {contains: {pair: "${pair}"}},
            created: {lessThan: "${formatted}"}
          },
          orderBy: CREATED_DESC,
          first: 1
        ) {
          edges {
            node {
              data
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(query);
    const data = result.data?.allEvents?.edges?.[0]?.node?.data || {};
    
    const a0in = parseFloat(data.amount0In || 0);
    const a1in = parseFloat(data.amount1In || 0);
    const a0out = parseFloat(data.amount0Out || 0);
    const a1out = parseFloat(data.amount1Out || 0);
    
    if (baseIsToken0 && a0in > 0 && a1out > 0) return a1out / a0in;
    if (!baseIsToken0 && a1in > 0 && a0out > 0) return a0out / a1in;
    
    return 0;
  } catch (error) {
    console.error(`24h historical price fetch failed for ${pair}:`, error);
    return 0;
  }
}

/**
 * Calculate 24-hour trading volume for a pair
 * 
 * @param {string} pair - The pair contract name
 * @returns {Promise<number>} The 24-hour trading volume
 */
async function calculateVolume(pair) {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const formatted = yesterday.toISOString().replace("Z", "");
    
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "Swap"},
          filter: {
            dataIndexed: {contains: {pair: "${pair}"}},
            created: {greaterThanOrEqualTo: "${formatted}"}
          }
        ) {
          edges {
            node {
              data
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(query);
    const edges = result.data?.allEvents?.edges || [];
    
    let volume = 0;
    edges.forEach(({ node }) => {
      const data = node.data || {};
      const a0in = parseFloat(data.amount0In || 0);
      const a1in = parseFloat(data.amount1In || 0);
      const a0out = parseFloat(data.amount0Out || 0);
      const a1out = parseFloat(data.amount1Out || 0);
      
      // Sum the total volume (in + out) for both tokens
      volume += a0in + a1in + a0out + a1out;
    });
    
    return volume;
  } catch (error) {
    console.error(`Volume calculation failed for ${pair}:`, error);
    return 0;
  }
}

/**
 * Get the timestamp of the last trade for a pair
 * 
 * @param {string} pair - The pair contract name
 * @returns {Promise<string|null>} ISO timestamp of the last trade or null
 */
async function getLastTradedTime(pair) {
  try {
    const query = `
      query {
        allEvents(
          condition: {contract: "con_pairs", event: "Swap"},
          filter: {
            dataIndexed: {contains: {pair: "${pair}"}}
          },
          orderBy: CREATED_DESC,
          first: 1
        ) {
          edges {
            node {
              created
            }
          }
        }
      }
    `;
    
    const result = await executeGraphQLQuery(query);
    const edges = result.data?.allEvents?.edges || [];
    
    if (edges.length > 0) {
      return edges[0].node.created;
    }
    
    return null;
  } catch (error) {
    console.error(`Last traded time fetch failed for ${pair}:`, error);
    return null;
  }
}

/**
 * Fetch token symbols for a list of contracts
 * 
 * @param {string[]} contracts - List of contract names
 * @returns {Promise<Object>} Map of contract name to token symbol
 */
async function fetchTokenSymbols(contracts) {
  if (!contracts.length) return {};
  
  try {
    const keys = contracts.map(c => `"${c}.metadata:token_symbol"`).join(",");
    const query = `
      query {
        allStates(
          filter: {key: {in: [${keys}]}}
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
    
    const result = await executeGraphQLQuery(query);
    const edges = result.data?.allStates?.edges || [];
    
    const tokenSymbols = {};
    edges.forEach(({ node }) => {
      const contract = node.key.split(".")[0];
      tokenSymbols[contract] = node.value;
    });
    
    return tokenSymbols;
  } catch (error) {
    console.error("Failed to fetch token symbols:", error);
    return {};
  }
}