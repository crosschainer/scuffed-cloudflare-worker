/* ------------------------------------------------------------------ */
/*  router/index.js                                                   */
/* ------------------------------------------------------------------ */

import { json }          from "../utils/response.js";
import { withEdgeCache } from "../middleware/cache.js";

/* ── handlers ────────────────────────────────────────────────────── */
import { swaggerHandler }            from "../handlers/swagger.js";
import { totalSupplyHandler }        from "../handlers/totalSupply.js";
import { circulatingSupplyHandler }  from "../handlers/circulatingSupply.js";
import { totalHoldersHandler }       from "../handlers/totalHolders.js";

import { getAllTokens, getTokenByName }              from "../handlers/tokens.js";
import { getTokenHolders }                           from "../handlers/tokenHolders.js";
import { getAllContracts, getContractCode }          from "../handlers/contracts.js";
import { getTokenBalance }                           from "../handlers/tokenBalance.js";
import { getPairs }                                  from "../handlers/pairs.js";
import { pairReservesHandler }                       from "../handlers/pairReserves.js";
import { pairVolume24hHandler }                      from "../handlers/tokenVolume.js";
import { pairPriceChange24hHandler }                 from "../handlers/tokenPriceChange.js";
import { transactionsHandler,
         getTransactionByHash,
         getTransactionsBySender }                   from "../handlers/transactions.js";
import { getPairById }                               from "../handlers/getPairById.js";

/* ── TTL helpers ─────────────────────────────────────────────────── */
const TTL_5S     = 5;                    // volatile
const TTL_10M    = 60 * 10;             // lists that change occasionally
const TTL_1H     = 60 * 60;
const TTL_30_D   = 60 * 60 * 24 * 30;   // immutable metadata (≈ 30 days)

/* ── static lookup table (exact paths) ───────────────────────────── */
const STATIC = {
  "/":                    { handler: swaggerHandler,          ttl: TTL_1H },
  "/openapi.json":        { handler: swaggerHandler,          ttl: TTL_1H },
  "/total-supply":        { handler: totalSupplyHandler,      ttl: TTL_1H },
  "/circulating-supply":  { handler: circulatingSupplyHandler,ttl: TTL_1H },
  "/total-holders":       { handler: totalHoldersHandler,     ttl: TTL_1H },

  "/pairs":               { handler: getPairs,                ttl: TTL_10M },
  "/tokens":              { handler: getAllTokens,            ttl: TTL_10M },
  "/contracts":           { handler: getAllContracts,         ttl: TTL_10M },

  "/transactions":        { handler: transactionsHandler,     ttl: TTL_5S }
};

/* ------------------------------------------------------------------ */
/*  Entry point                                                       */
/* ------------------------------------------------------------------ */
export async function handleRequest(event) {
  const req = event.request;
  if (req.method !== "GET")
    return json({ error: "Only GET allowed." }, { status: 405 });

  const url  = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  /* ── dynamic routes --------------------------------------------- */

  /* /token/<contract>/balance/<address> */
  const mBal = path.match(/^\/token\/([^\/]+)\/balance\/([^\/]+)$/);
  if (mBal)
    return withEdgeCache(
      req, event,
      () => getTokenBalance(req, { contractName: mBal[1], address: mBal[2] })
    );

  /* /tokens/<contract>/holders */
  const mHold = path.match(/^\/tokens\/([^\/]+)\/holders$/);
  if (mHold)
    return withEdgeCache(
      req, event,
      () => getTokenHolders(req, { contractName: mHold[1] })
    );

  /* /tokens/<contract> – token metadata (mutable) */
  const mTok = path.match(/^\/tokens\/([^\/]+)$/);
  if (mTok)
    return withEdgeCache(
      req, event,
      () => getTokenByName(req, { contractName: mTok[1] }),
      TTL_1H
    );

  /* /contracts/<contract> – contract code (immutable) */
  const mCon = path.match(/^\/contracts\/([^\/]+)$/);
  if (mCon)
    return withEdgeCache(
      req, event,
      () => getContractCode(req, { contractName: mCon[1] }),
      TTL_30_D
    );

  /* /transactions/sender/<sender> */
  const mTxSender = path.match(/^\/transactions\/sender\/(.+)$/);
  if (mTxSender)
    return withEdgeCache(
      req, event,
      () => getTransactionsBySender(req, { sender: decodeURIComponent(mTxSender[1]) }),
      TTL_5S
    );

  /* /transactions/<hash> – immutable once on chain */
  const mTx = path.match(/^\/transactions\/([^\/]+)$/);
  if (mTx)
    return withEdgeCache(
      req, event,
      () => getTransactionByHash(req, { hash: mTx[1] }),
      TTL_30_D
    );

  /* /pairs/<pairId>/volume24h */
  const mPairVol = path.match(/^\/pairs\/([^\/]+)\/volume24h$/);
  if (mPairVol) {
    const u = new URL(req.url);
    u.searchParams.set("pair", mPairVol[1]);
    return withEdgeCache(
      req, event,
      () => pairVolume24hHandler(new Request(u.toString(), req), event)
    );
  }

  /* /pairs/<pairId>/pricechange24h */
  const mPairChg = path.match(/^\/pairs\/([^\/]+)\/pricechange24h$/);
  if (mPairChg) {
    const u = new URL(req.url);
    u.searchParams.set("pair", mPairChg[1]);
    return withEdgeCache(
      req, event,
      () => pairPriceChange24hHandler(new Request(u.toString(), req), event)
    );
  }

  /* /pairs/<pairId>/reserves */
  const mPairRes = path.match(/^\/pairs\/([^\/]+)\/reserves$/);
  if (mPairRes) {
    const u = new URL(req.url);
    u.searchParams.set("pair", mPairRes[1]);
    return withEdgeCache(
      req, event,
      () => pairReservesHandler(new Request(u.toString(), req), event)
    );
  }

  /* /pairs/<pairId> – pair metadata (immutable) */
  const mPairMeta = path.match(/^\/pairs\/([^\/]+)$/);
  if (mPairMeta && !path.match(/^\/pairs\/[^\/]+\/.+/)) {
    const u = new URL(req.url);
    u.searchParams.set("pair", mPairMeta[1]);
    return withEdgeCache(
      req, event,
      () => getPairById(new Request(u.toString(), req), event),
      TTL_30_D
    );
  }

  /* ── static routes ---------------------------------------------- */
  const entry = STATIC[path];
  if (!entry) return json({ error: "Route not found" }, { status: 404 });

  const { handler, ttl } =
    typeof entry === "function"
      ? { handler: entry, ttl: undefined }
      : entry;

  return withEdgeCache(req, event, () => handler(req, event), ttl);
}
