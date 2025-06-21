"""
Application-wide constants
"""

# The upstream GraphQL endpoint
GRAPHQL_ENDPOINT = "https://node.xian.org/graphql"

# When summing balances in chunks, fetch this many records per request
CHUNK_SIZE = 2000

# How many seconds to cache each endpoint's response at the edge
CACHE_TTL_SECONDS = 120

# Maximum supply of Xian
MAXIMUM_SUPPLY = 111111111

# Excluded addresses for circulating supply calculation
EXCLUDED_KEYS = [
    "currency.balances:team_lock",
    "currency.balances:dao_funding_stream",
    "currency.balances:dao",
    "currency.balances:con_team_y1_linear_vesting",
]

# TTL helpers
TTL_5S = 5
TTL_10M = 60 * 10
TTL_1H = 60 * 60
TTL_30_D = 60 * 60 * 24 * 30