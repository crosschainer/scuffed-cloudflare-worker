# Xian API Cloudflare Worker

A modular Cloudflare Worker that provides API endpoints for Xian cryptocurrency data.

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
