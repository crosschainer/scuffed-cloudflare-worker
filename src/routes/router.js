/**
 * Router for handling API requests
 */

import { json } from "../utils/response.js";
import { withCache } from "../middleware/cache.js";

/* ─── core endpoints ────────────────────────────────────────────── */
import { totalSupplyHandler }        from "../handlers/totalSupply.js";
import { circulatingSupplyHandler }  from "../handlers/circulatingSupply.js";
import { totalHoldersHandler }       from "../handlers/totalHolders.js";
import { swaggerHandler }            from "../handlers/swagger.js";

/* ─── token / contract / market endpoints ───────────────────────── */
import { getAllTokens,  getTokenByName }   from "../handlers/tokens.js";
import { getTokenHolders }                 from "../handlers/tokenHolders.js";
import { getAllContracts, getContractCode} from "../handlers/contracts.js";
import { getAllPairs,   getPairsByToken }  from "../handlers/market.js";
import { getTokenBalance }                 from "../handlers/tokenBalance.js";

/* ─── static-path table (exact matches) ─────────────────────────── */
export const ROUTES = {
  "/":                     swaggerHandler,
  "/openapi.json":         swaggerHandler,
  "/total-supply":         totalSupplyHandler,
  "/circulating-supply":   circulatingSupplyHandler,
  "/total-holders":        totalHoldersHandler,
  "/tokens":               getAllTokens,
  "/contracts":            getAllContracts,
  "/pairs":                getAllPairs,
};

/**
 * Main request dispatcher
 */
export async function handleRequest(event) {
  const request = event.request;
  const url     = new URL(request.url);

  /* ────────────────── method guard ─────────────────────────────── */
  if (request.method !== "GET") {
    return json({ error: "Only GET allowed." }, { status: 405 });
  }

  /* ────────────────── pathname normalisation ───────────────────── */
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") pathname = "/";

  /* --- read inverse flag once ----------------------------------- */
  const inverse = url.searchParams.get("inverse") === "true";

  /* ────────────────── dynamic routes (regex) ───────────────────── */

  /* 1) /balance/:contractName/:address  --------------------------- */
  const balanceMatch = pathname.match(/^\/token\/([^\/]+)\/balance\/([^\/]+)$/);
  if (balanceMatch) {
    const contractName = balanceMatch[1];
    const address      = balanceMatch[2];
    return withCache(pathname + url.search, request, event, () =>
      getTokenBalance(request, { contractName, address })
    );
  }

  /* 2) /tokens/:contractName/holders  ----------------------------- */
  const holdersMatch = pathname.match(/^\/tokens\/([^\/]+)\/holders$/);
  if (holdersMatch) {
    const contractName = holdersMatch[1];
    return withCache(pathname + url.search, request, event, () =>
      getTokenHolders(request, { contractName })
    );
  }

  /* 3) /tokens/:contractName  ------------------------------------- */
  const tokenMatch = pathname.match(/^\/tokens\/([^\/]+)$/);
  if (tokenMatch) {
    const contractName = tokenMatch[1];
    return withCache(pathname, request, event, () =>
      getTokenByName(request, { contractName })
    );
  }

  /* 4) /contracts/:contractName  ---------------------------------- */
  const contractMatch = pathname.match(/^\/contracts\/([^\/]+)$/);
  if (contractMatch) {
    const contractName = contractMatch[1];
    return withCache(pathname, request, event, () =>
      getContractCode(request, { contractName })
    );
  }

  /* 5) /pairs/:contractName  -------------------------------------- */
  const pairMatch = pathname.match(/^\/pairs\/([^\/]+)$/);
  if (pairMatch) {
    const contractName = pairMatch[1];
    return withCache(pathname + url.search, request, event, () =>
      getPairsByToken(request, { contractName, inverse })
    );
  }

  /* ────────────────── static-path table lookup ─────────────────── */
  const handler = ROUTES[pathname];
  if (!handler) {
    return json({ error: "Route not found" }, { status: 404 });
  }

  if (pathname === "/pairs") {
    return withCache(pathname + url.search, request, event, () =>
      handler(request, event, { inverse })   // handler = getAllPairs
    );
  }

  /* ────────────────── run handler (cached) ─────────────────────── */
  return withCache(pathname + url.search, request, event, () =>
    handler(request, event)
  );
}
