/**
 * Router for handling API requests
 */

import { json } from '../utils/response.js';
import { withCache } from '../middleware/cache.js';
import { totalSupplyHandler } from '../handlers/totalSupply.js';
import { circulatingSupplyHandler } from '../handlers/circulatingSupply.js';
import { totalHoldersHandler } from '../handlers/totalHolders.js';
import { swaggerHandler } from '../handlers/swagger.js';
import { getAllTokens, getTokenByName } from '../handlers/tokens.js';
import { getTokenHolders } from '../handlers/tokenHolders.js';

/**
 * A mapping of normalized pathname → handler(request, event)
 */
export const ROUTES = {
  "/": swaggerHandler,
  "/openapi.json": swaggerHandler,
  "/total-supply": totalSupplyHandler,
  "/circulating-supply": circulatingSupplyHandler,
  "/total-holders": totalHoldersHandler,
  "/tokens": getAllTokens,
};

/**
 * Main request handler that routes requests to the appropriate handler
 * 
 * @param {FetchEvent} event - The fetch event
 * @returns {Promise<Response>} The response from the appropriate handler
 */
export async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Normalize pathname: strip trailing slashes → if empty, set to "/"
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") {
    pathname = "/";
  }

  // Only allow GET on all routes
  if (request.method !== "GET") {
    return json({ error: "Only GET allowed." }, { status: 405 });
  }

  // Check for dynamic routes first
  
  // Token metadata route: /tokens/{contractName}
  const tokenMatch = pathname.match(/^\/tokens\/([^\/]+)$/);
  if (tokenMatch) {
    const contractName = tokenMatch[1];
    return await withCache(pathname + url.search, request, event, () =>
      getTokenByName(request, { contractName })
    );
  }
  
  // Token holders route: /tokens/{contractName}/holders
  const holdersMatch = pathname.match(/^\/tokens\/([^\/]+)\/holders$/);
  if (holdersMatch) {
    const contractName = holdersMatch[1];
    // Cache this endpoint like other endpoints
    return await withCache(pathname + url.search, request, event, () =>
      getTokenHolders(request, { contractName })
    );
  }

  // Lookup which handler should run for static routes
  const routeHandler = ROUTES[pathname];
  if (!routeHandler) {
    return json({ error: "Route not found" }, { status: 404 });
  }

  // Wrap the handler in a cache, include query parameters in cache key
  return await withCache(pathname + url.search, request, event, () =>
    routeHandler(request, event)
  );
}