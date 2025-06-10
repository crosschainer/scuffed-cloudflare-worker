/* ------------------------------------------------------------------ */
/*  router/index.js                                                   */
/* ------------------------------------------------------------------ */

import { json } from "../utils/response.js";
import { withEdgeCache } from "../middleware/cache.js";

/* ── handlers ─────────────────────────────────────────────────────── */
import { swaggerHandler } from "../handlers/swagger.js";
import { totalSupplyHandler } from "../handlers/totalSupply.js";
import { circulatingSupplyHandler } from "../handlers/circulatingSupply.js";
import { totalHoldersHandler } from "../handlers/totalHolders.js";

import { getAllTokens, getTokenByName } from "../handlers/tokens.js";
import { getTokenHolders } from "../handlers/tokenHolders.js";
import { getAllContracts, getContractCode } from "../handlers/contracts.js";
import { getTokenBalance } from "../handlers/tokenBalance.js";
import { getPairs }                         from "../handlers/pairs.js";
import { pairVolume24hHandler } from "../handlers/tokenVolume.js";
import { pairPriceChange24hHandler } from "../handlers/tokenPriceChange.js";
import { transactionsHandler, getTransactionByHash, getTransactionsBySender } from "../handlers/transactions.js";

/* ── static lookup table (exact paths) ────────────────────────────── */
const STATIC = {
  "/": swaggerHandler,
  "/openapi.json": swaggerHandler,
  "/total-supply": totalSupplyHandler,
  "/circulating-supply": circulatingSupplyHandler,
  "/total-holders": totalHoldersHandler,
  "/pairs": getPairs,
  "/tokens": getAllTokens,
  "/contracts": getAllContracts,
  "/transactions": transactionsHandler,
};

/* ------------------------------------------------------------------ */
/*  Entry point                                                       */
/* ------------------------------------------------------------------ */
export async function handleRequest(event) {
  const req = event.request;
  if (req.method !== "GET")
    return json({ error: "Only GET allowed." }, { status: 405 });

  const url = new URL(req.url);
  let path = url.pathname.replace(/\/+$/, "") || "/";
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

  //  /transactions/sender/<sender>
  const mTxSender = path.match(/^\/transactions\/sender\/(.+)$/);
  if (mTxSender)
    return withEdgeCache(req, event,
      () => getTransactionsBySender(req, { sender: decodeURIComponent(mTxSender[1]) }));

  //  /transactions/<hash>
  const mTx = path.match(/^\/transactions\/([^\/]+)$/);
  if (mTx)
    return withEdgeCache(req, event,
      () => getTransactionByHash(req, { hash: mTx[1] }));

  //  /pairs/<pairId>/volume24h
const mPairVol = path.match(/^\/pairs\/([^\/]+)\/volume24h$/);
if (mPairVol) {
  // build a fresh URL that keeps old params and adds `pair=<id>`
  const u = new URL(req.url);
  u.searchParams.set("pair", mPairVol[1]);      // add/overwrite

  return withEdgeCache(req, event,
    () => pairVolume24hHandler(
      // clone the request with the new URL but same method/headers/etc.
      new Request(u.toString(), req),
      event
    ));
}

//  /pairs/<pairId>/pricechange24h
const mPairChg = path.match(/^\/pairs\/([^\/]+)\/pricechange24h$/);
if (mPairChg) {
  const u = new URL(req.url);
  u.searchParams.set("pair", mPairChg[1]);   // preserve other params

  return withEdgeCache(req, event,
    () => pairPriceChange24hHandler(
      new Request(u.toString(), req),
      event
    ));
}
  /* ── static routes ------------------------------------------------- */
  const h = STATIC[path];
  if (!h) return json({ error: "Route not found" }, { status: 404 });

  return withEdgeCache(req, event, () => h(req, event));
}
