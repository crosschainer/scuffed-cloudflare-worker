/**
 * Market data handlers
 */

import axios from 'axios';
import { json } from '../utils/response.js';
import { GRAPHQL_ENDPOINT } from '../config/constants.js';

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
 * Compute 24-hour volume for a pair.
 *
 *  – If the pair includes XIAN (“currency”), we also return volume in XIAN
 *    and in USD (using the latest XIAN/USD price).
 *  – Otherwise volXian / volUSD are null.
 *
 * @param {string} pairAddress
 * @param {string} token0   – pair.token0
 * @param {string} token1   – pair.token1
 * @param {number|null} xianUsdPrice – latest XIAN/USD (or null)
 * @returns {Promise<{volToken0:number, volToken1:number,
 *                    volXian:number|null, volUSD:number|null}>}
 */
async function get24hVolumeForPair(pairAddress, token0, token1, xianUsdPrice) {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .replace("Z", ""); // strip the trailing Z so it matches the stored format

    const query = `
      query {
        allEvents(
          condition: { contract: "con_pairs", event: "Swap" }
          filter: {
             dataIndexed: { contains: { pair: "${pairAddress}" } }
            created: { greaterThan: "${since}" }
          }
          first: 1000        # adjust if you expect >1k swaps / 24 h
        ) {
          edges { node { data } }
        }
      }
    `;

    const { data } = await axios.post(
      GRAPHQL_ENDPOINT,
      { query },
      { headers: { "Content-Type": "application/json" } }
    );

    const edges = data?.data?.allEvents?.edges || [];

    let vol0 = 0;
    let vol1 = 0;

    for (const { node } of edges) {
      const d = node.data;
      vol0 += parseFloat(d.amount0In || 0);
      vol0 += parseFloat(d.amount0Out || 0);
      vol1 += parseFloat(d.amount1In || 0);
      vol1 += parseFloat(d.amount1Out || 0);
    }

    let volXian = null;
    let volUSD  = null;

    // If the pair includes “currency” (XIAN) we can compute extra fields
    if (token0 === "currency") {
      volXian = vol0;                      // token0 is XIAN
    } else if (token1 === "currency") {
      volXian = vol1;                      // token1 is XIAN
    }
    if (volXian !== null && xianUsdPrice !== null) {
      volUSD = volXian * xianUsdPrice;
    }

    return { volToken0: vol0, volToken1: vol1, volXian, volUSD };
  } catch (err) {
    console.error("Volume-24h error for pair", pairAddress, err);
    return { volToken0: 0, volToken1: 0, volXian: null, volUSD: null };
  }
}
/* ------------------------------------------------------------------ */
/*  Utility: simple concurrency-limited mapper                         */
/* ------------------------------------------------------------------ */
function mapWithLimit(list, limit, asyncFn) {
  return new Promise((resolve, reject) => {
    const out = new Array(list.length);
    let next = 0;
    let active = 0;

    const launch = () => {
      if (next >= list.length) {
        if (active === 0) resolve(out);
        return;
      }
      const idx = next++;
      active++;

      Promise.resolve(asyncFn(list[idx], idx))
        .then((res) => { out[idx] = res; })
        .catch(reject)
        .finally(() => {
          active--;
          launch();
        });
    };

    // kick off at most <limit> tasks
    for (let i = 0; i < limit && i < list.length; i++) launch();
  });
}

/* ------------------------------------------------------------------ */
/*  Enhance pair objects with price & 24 h volume                      */
/*  @param {Array}  pairs                                              */
/*  @param {boolean} inverse – if true, return price & volume as       */
/*                             token1/token0 instead of token0/token1  */
/* ------------------------------------------------------------------ */
async function enhancePairsWithPrices(pairs, inverse = false) {
  const xianUsdPrice = await getXianUsdPrice();
  const CONCURRENCY  = 1;

  return mapWithLimit(pairs, CONCURRENCY, async (pair) => {
    /* ───── fetch price data ─────────────────────────────────────── */
    let { price: currentPrice, timestamp } =
      await getLatestPriceForPair(pair.pair_address);
    let { price: price24hAgo } =
      await get24hAgoPriceForPair(pair.pair_address);

    /* invert if caller requested it */
    if (inverse) {
      currentPrice = currentPrice ? 1 / currentPrice : null;
      price24hAgo  = price24hAgo  ? 1 / price24hAgo  : null;
    }

    /* ───── fetch 24 h volume ────────────────────────────────────── */
    let {
      volToken0,
      volToken1,
      volXian,
      volUSD,
    } = await get24hVolumeForPair(
      pair.pair_address,
      pair.token0,
      pair.token1,
      xianUsdPrice
    );

    /* swap volumes when inverse=true so they match price direction */
    if (inverse) {
      [volToken0, volToken1] = [volToken1, volToken0];
    }

    /* ───── assemble result object ──────────────────────────────── */
    const enhanced = {
      ...pair,
      price:            currentPrice,
      price24hAgo,                       // raw, for client if needed
      priceChange24h:  calculatePriceChangePercentage(
                         currentPrice, price24hAgo),
      lastPriceUpdate: timestamp,

      volume24hToken0: volToken0,
      volume24hToken1: volToken1,
      volume24hXian:   volXian,
      volume24hUSD:    volUSD,
    };

    return enhanced;
  });
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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 10);
    const inverse = ["true","1"].includes(url.searchParams.get("inverse"));
    
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
        created_at: node.created
      };
    });
    
    // Always add price information
    pairs = await enhancePairsWithPrices(pairs, inverse);
    
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
    const url     = new URL(request.url);
    const inverse = ["true","1"].includes(url.searchParams.get("inverse"));
    
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
    allPairs = await enhancePairsWithPrices(allPairs, inverse);

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
