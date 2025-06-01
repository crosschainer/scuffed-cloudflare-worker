/**
 * Router for handling API requests
 * --------------------------------
 * All successful GETs are wrapped in withEdgeCache(), which serves the response
 * from Cloudflare’s edge cache for 10 s and then recomputes on the first miss.
 */

import { json } from "../utils/response.js";
import { withEdgeCache } from "../middleware/cache.js";

/* ─── core endpoints ────────────────────────────────────────────── */
import { totalSupplyHandler }       from "../handlers/totalSupply.js";
import { circulatingSupplyHandler } from "../handlers/circulatingSupply.js";
import { totalHoldersHandler }      from "../handlers/totalHolders.js";
import { swaggerHandler }           from "../handlers/swagger.js";

/* ─── token / contract / market endpoints ───────────────────────── */
import { getAllTokens, getTokenByName }      from "../handlers/tokens.js";
import { getTokenHolders }                   from "../handlers/tokenHolders.js";
import { getAllContracts, getContractCode }  from "../handlers/contracts.js";
import { getAllPairs }                       from "../handlers/market.js";
import { getTokenBalance }                   from "../handlers/tokenBalance.js";

/* ─── exact-path map (fast look-up) ─────────────────────────────── */
const STATIC_ROUTES = {
  "/":                   swaggerHandler,
  "/openapi.json":       swaggerHandler,
  "/total-supply":       totalSupplyHandler,
  "/circulating-supply": circulatingSupplyHandler,
  "/total-holders":      totalHoldersHandler,
  "/tokens":             getAllTokens,
  "/contracts":          getAllContracts,
  "/pairs":              getAllPairs,
};

/* ================================================================= */
/*  Main dispatcher                                                   */
/* ================================================================= */
export async function handleRequest(event) {
  const { request } = event;
  const url         = new URL(request.url);

  /* ── allow only GET ──────────────────────────────────────────── */
  if (request.method !== "GET") {
    return json({ error: "Only GET allowed." }, { status: 405 });
  }

  /* ── normalise pathname (strip trailing “/”) ─────────────────── */
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";

  /* ─────────────────────────────────────────────────────────────── */
  /*  Dynamic routes (regex matches)                                 */
  /* ─────────────────────────────────────────────────────────────── */

  /* 1) /token/:contract/balance/:address -------------------------- */
  const mBalance = pathname.match(/^\/token\/([^\/]+)\/balance\/([^\/]+)$/);
  if (mBalance) {
    const [ , contractName, address ] = mBalance;
    return withEdgeCache(request, event, () =>
      getTokenBalance(request, { contractName, address })
    );
  }

  /* 2) /tokens/:contract/holders --------------------------------- */
  const mHolders = pathname.match(/^\/tokens\/([^\/]+)\/holders$/);
  if (mHolders) {
    const contractName = mHolders[1];
    return withEdgeCache(request, event, () =>
      getTokenHolders(request, { contractName })
    );
  }

  /* 3) /tokens/:contract  ---------------------------------------- */
  const mToken = pathname.match(/^\/tokens\/([^\/]+)$/);
  if (mToken) {
    const contractName = mToken[1];
    return withEdgeCache(request, event, () =>
      getTokenByName(request, { contractName })
    );
  }

  /* 4) /contracts/:name  ----------------------------------------- */
  const mContract = pathname.match(/^\/contracts\/([^\/]+)$/);
  if (mContract) {
    const contractName = mContract[1];
    return withEdgeCache(request, event, () =>
      getContractCode(request, { contractName })
    );
  }

  /* ─────────────────────────────────────────────────────────────── */
  /*  Static-path routes                                            */
  /* ─────────────────────────────────────────────────────────────── */
  const handler = STATIC_ROUTES[pathname];
  if (!handler) {
    return json({ error: "Route not found" }, { status: 404 });
  }

  /* Special case: /pairs needs the “inverse” query flag ----------- */
  if (pathname === "/pairs") {
    const inverse = ["true", "1"].includes(url.searchParams.get("inverse"));
    return withEdgeCache(request, event, () =>
      handler(request, event, { inverse })          // handler === getAllPairs
    );
  }

  /* Default static-route handling -------------------------------- */
  return withEdgeCache(request, event, () => handler(request, event));
}
