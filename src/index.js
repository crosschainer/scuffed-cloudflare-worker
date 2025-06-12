/**
 * src/index.js  –  Worker entry (Modules syntax)
 * ------------------------------------------------
 * Exposes the StatsObject Durable Object and delegates requests to
 * routes/router.js, passing along `env` and `ctx`.
 */

import router            from "./routes/router.js";
import { StatsObject }   from "./objects/statsObject.js";

/* ---- expose DO class to Wrangler ---- */
export { StatsObject };

export default {
  async fetch(request, env, ctx) {
    // router.fetch is the default export of routes/router.js
    return router.fetch(request, env, ctx);
  }
};
