/* ------------------------------------------------------------------ */
/*  router/index.js                                                   */
/* ------------------------------------------------------------------ */

import { json }           from "../utils/response.js";
import { withEdgeCache }  from "../middleware/cache.js";

/* ── handlers ─────────────────────────────────────────────────────── */
import { swaggerHandler }           from "../handlers/swagger.js";
import { totalSupplyHandler }       from "../handlers/totalSupply.js";
import { circulatingSupplyHandler } from "../handlers/circulatingSupply.js";
import { totalHoldersHandler }      from "../handlers/totalHolders.js";

import { getAllTokens, getTokenByName }     from "../handlers/tokens.js";
import { getTokenHolders }                  from "../handlers/tokenHolders.js";
import { getAllContracts, getContractCode } from "../handlers/contracts.js";
import { getTokenBalance }                  from "../handlers/tokenBalance.js";

/* ── static lookup table (exact paths) ────────────────────────────── */
const STATIC = {
  "/":                   swaggerHandler,
  "/openapi.json":       swaggerHandler,
  "/total-supply":       totalSupplyHandler,
  "/circulating-supply": circulatingSupplyHandler,
  "/total-holders":      totalHoldersHandler,
  "/tokens":             getAllTokens,
  "/contracts":          getAllContracts,
};

/* ------------------------------------------------------------------ */
/*  Entry point                                                       */
/* ------------------------------------------------------------------ */
export async function handleRequest(event) {
  const req = event.request;
  if (req.method !== "GET")
    return json({ error: "Only GET allowed." }, { status: 405 });

  const url      = new URL(req.url);
  let   path     = url.pathname.replace(/\/+$/, "") || "/";
  const canonKey = path + url.search;          // full key for cache helper

  /* ── dynamic routes ------------------------------------------------ */

  //  /token/<contract>/balance/<address>
  const mBal = path.match(/^\/token\/([^\/]+)\/balance\/([^\/]+)$/);
  if (mBal)
    return withEdgeCache(req, event,
      () => getTokenBalance(req, { contractName: mBal[1], address: mBal[2] }));

  //  /tokens/<contract>/holders
  const mHold = path.match(/^\/tokens\/([^\/]+)\/holders$/);
  if (mHold)
    return withEdgeCache(req, event,
      () => getTokenHolders(req, { contractName: mHold[1] }));

  //  /tokens/<contract>
  const mTok = path.match(/^\/tokens\/([^\/]+)$/);
  if (mTok)
    return withEdgeCache(req, event,
      () => getTokenByName(req, { contractName: mTok[1] }));

  //  /contracts/<contract>
  const mCon = path.match(/^\/contracts\/([^\/]+)$/);
  if (mCon)
    return withEdgeCache(req, event,
      () => getContractCode(req, { contractName: mCon[1] }));

  /* ── static routes ------------------------------------------------- */
  const h = STATIC[path];
  if (!h) return json({ error: "Route not found" }, { status: 404 });

  return withEdgeCache(req, event, () => h(req, event));
}
