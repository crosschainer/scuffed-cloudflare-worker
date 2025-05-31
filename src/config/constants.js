/**
 * Application-wide constants
 */

// The upstream GraphQL endpoint
export const GRAPHQL_ENDPOINT = "https://node.xian.org/graphql";

// When summing balances in chunks, fetch this many records per request
export const CHUNK_SIZE = 2000;

// How many seconds to cache each endpoint's response at the edge
export const CACHE_TTL_SECONDS = 120;

// Maximum supply of Xian
export const MAXIMUM_SUPPLY = 111111111;

// Excluded addresses for circulating supply calculation
export const EXCLUDED_KEYS = [
  "currency.balances:team_lock",
  "currency.balances:dao_funding_stream",
  "currency.balances:dao",
  "currency.balances:con_team_y1_linear_vesting",
  "currency.balances:masternodes",
  "currency.balances:con_farm_xian_usdc",
];