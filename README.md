# Xian API Cloudflare Worker

A modular Cloudflare Worker that provides API endpoints for Xian cryptocurrency data.

## Endpoints

### Supply Endpoints
- `GET /total-supply` - Get the total supply of Xian
- `GET /circulating-supply` - Get the circulating supply of Xian
- `GET /total-holders` - Get the total number of Xian holders

### Token Endpoints
- `GET /tokens` - Get a list of all tokens with pagination
- `GET /tokens/{contractName}` - Get detailed information about a specific token
- `GET /tokens/{contractName}/holders` - Get a list of token holders with pagination

### Market Endpoints
- `GET /markets` - Get a list of all markets (token pairs) with price information
  - Query parameters:
    - `limit` - Maximum number of markets to return (default: 100)
    - `offset` - Number of markets to skip (default: 0)
  - Response includes:
    - Token symbols and contract names
    - Current prices for both tokens in the pair
    - 24-hour price change percentages
    - USD prices (when paired with stablecoins)
    - 24-hour trading volume
    - Pagination information
- `GET /tokens/{contractName}/markets` - Get markets for a specific token with price information
  - Response includes:
    - All markets where the specified token is traded
    - Price from the token's perspective
    - Paired token information
    - 24-hour price change percentage
    - USD price (when paired with stablecoins)
    - 24-hour trading volume
    - Last traded timestamp

### Documentation
- `GET /` - Swagger UI documentation
- `GET /openapi.json` - OpenAPI specification

## Project Structure

```
src/
├── config/           # Configuration constants and settings
│   ├── constants.js  # Application-wide constants
│   └── openapi.js    # OpenAPI specification
├── handlers/         # Request handlers for each endpoint
│   ├── circulatingSupply.js
│   ├── markets.js    # Market-related endpoints
│   ├── swagger.js
│   ├── tokenHolders.js
│   ├── tokens.js
│   ├── totalHolders.js
│   └── totalSupply.js
├── middleware/       # Middleware functions
│   └── cache.js      # Caching middleware
├── routes/           # Routing logic
│   └── router.js     # Main router
├── utils/            # Utility functions
│   ├── graphql.js    # GraphQL utilities
│   └── response.js   # Response formatting utilities
└── index.js          # Main entry point
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Login to Cloudflare:
   ```
   wrangler login
   ```

3. Start local development server:
   ```
   wrangler dev
   ```

### Deployment

#### Multi-Environment Deployment

This project supports multiple deployment environments to safely test changes without affecting production users.

1. **Staging Environment** (for testing new features):
   ```
   wrangler deploy --env staging
   ```
   This deploys to `xian-api-staging.poc.workers.dev`

2. **Production Environment** (live API used by users):
   ```
   wrangler deploy --env production
   ```
   This deploys to `xian-api.poc.workers.dev`

#### Deployment Workflow

For safe deployments, follow this workflow:

1. Develop and test locally using `wrangler dev`
2. Deploy to staging and verify all features work correctly
3. Once verified, deploy to production
4. Monitor for any issues after deployment

## Adding New Endpoints

1. Create a new handler file in `src/handlers/`
2. Add the route to `src/routes/router.js`
3. Update the OpenAPI specification in `src/config/openapi.js`