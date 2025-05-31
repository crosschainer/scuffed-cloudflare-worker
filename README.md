# Xian API Cloudflare Worker

A modular Cloudflare Worker that provides API endpoints for Xian cryptocurrency data.

## Endpoints

- `GET /total-supply` - Get the total supply of Xian
- `GET /circulating-supply` - Get the circulating supply of Xian
- `GET /total-holders` - Get the total number of Xian holders
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
│   ├── swagger.js
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

Deploy to production:
```
wrangler publish
```

## Adding New Endpoints

1. Create a new handler file in `src/handlers/`
2. Add the route to `src/routes/router.js`
3. Update the OpenAPI specification in `src/config/openapi.js`