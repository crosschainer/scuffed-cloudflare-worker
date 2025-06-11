/**
 * Main entry point for the Cloudflare Worker
 * ------------------------------------------
 * The router module now exports a *default* object with a `.fetch()` method,
 * so we simply delegate to that instead of importing a named handleRequest.
 */

import router from './routes/router.js';

addEventListener("fetch", (event) => {
  // router.fetch(request, env?, ctx?) — in a Service-Worker build
  // `env` is not injected, so pass undefined; the ExecutionContext is `event`.
  event.respondWith(router.fetch(event.request, undefined, event));
});
