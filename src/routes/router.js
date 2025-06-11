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
import { tokenDistributionHandler }                  from "../handlers/tokenDistribution.js";
import { batchHandler }                              from "../handlers/batch.js";
import { pairCandlesHandler }                         from "../handlers/pairCandles.js";
import { pairTradesHandler }                          from "../handlers/pairTrades.js";

/* ── TTL helpers ─────────────────────────────────────────────────── */
const TTL_5S   = 5;
const TTL_10M  = 60 * 10;
const TTL_1H   = 60 * 60;
const TTL_30_D = 60 * 60 * 24 * 30;

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
/*  Entry point – export in Wrangler style                            */
/* ------------------------------------------------------------------ */
export default {
  async fetch(req, env, ctx) {
    /* ── CORS pre-flight ------------------------------------------ */
    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
      

    const url  = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    /* ── /batch (POST)  ------------------------------------------- */
    if (req.method === "POST" && path === "/batch")
      return batchHandler(req, env, ctx);          // no edge cache on wrapper

    /* Reject any non-GET after /batch is handled */
    if (req.method !== "GET")
      return json({ error: "Only GET endpoints or POST /batch allowed." }, { status: 405 });

    /* ── dynamic GET routes -------------------------------------- */

    /* /token/<contract>/balance/<address> */
    const mBal = path.match(/^\/token\/([^\/]+)\/balance\/([^\/]+)$/);
    if (mBal)
      return withEdgeCache(req, ctx,
        () => getTokenBalance(req, { contractName: mBal[1], address: mBal[2] })
      );

    /* /tokens/<contract>/holders */
    const mHold = path.match(/^\/tokens\/([^\/]+)\/holders$/);
    if (mHold)
      return withEdgeCache(req, ctx,
        () => getTokenHolders(req, { contractName: mHold[1] })
      );

    /* /tokens/<contract> */
    const mTok = path.match(/^\/tokens\/([^\/]+)$/);
    if (mTok)
      return withEdgeCache(req, ctx,
        () => getTokenByName(req, { contractName: mTok[1] }),
        TTL_1H
      );

    /* /contracts/<contract> */
    const mCon = path.match(/^\/contracts\/([^\/]+)$/);
    if (mCon)
      return withEdgeCache(req, ctx,
        () => getContractCode(req, { contractName: mCon[1] }),
        TTL_30_D
      );

    /* /transactions/sender/<sender> */
    const mTxSender = path.match(/^\/transactions\/sender\/(.+)$/);
    if (mTxSender)
      return withEdgeCache(req, ctx,
        () => getTransactionsBySender(req, { sender: decodeURIComponent(mTxSender[1]) }),
        TTL_5S
      );

    /* /transactions/<hash> */
    const mTx = path.match(/^\/transactions\/([^\/]+)$/);
    if (mTx)
      return withEdgeCache(req, ctx,
        () => getTransactionByHash(req, { hash: mTx[1] }),
        TTL_30_D
      );

    /* /pairs/<id>/volume24h */
    const mPairVol = path.match(/^\/pairs\/([^\/]+)\/volume24h$/);
    if (mPairVol) {
      url.searchParams.set("pair", mPairVol[1]);
      return withEdgeCache(req, ctx,
        () => pairVolume24hHandler(new Request(url.toString(), req), ctx)
      );
    }

    /* /pairs/<id>/pricechange24h */
    const mPairChg = path.match(/^\/pairs\/([^\/]+)\/pricechange24h$/);
    if (mPairChg) {
      url.searchParams.set("pair", mPairChg[1]);
      return withEdgeCache(req, ctx,
        () => pairPriceChange24hHandler(new Request(url.toString(), req), ctx)
      );
    }

    /* /pairs/<id>/reserves */
    const mPairRes = path.match(/^\/pairs\/([^\/]+)\/reserves$/);
    if (mPairRes) {
      url.searchParams.set("pair", mPairRes[1]);
      return withEdgeCache(req, ctx,
        () => pairReservesHandler(new Request(url.toString(), req), ctx)
      );
    }

    /* /pairs/<id>/trades */
const mTrades = path.match(/^\/pairs\/([^\/]+)\/trades$/);
if (mTrades)
  return withEdgeCache(
    req, ctx,
    () => pairTradesHandler(req),
    TTL_5S
  );


    /* /pairs/<id> */
    const mPairMeta = path.match(/^\/pairs\/([^\/]+)$/);
    if (mPairMeta && !path.match(/^\/pairs\/[^\/]+\/.+/)) {
      url.searchParams.set("pair", mPairMeta[1]);
      return withEdgeCache(req, ctx,
        () => getPairById(new Request(url.toString(), req), ctx),
        TTL_30_D
      );
    }

    /* /tokens/<contract>/distribution */
    const mDist = path.match(/^\/tokens\/([^\/]+)\/distribution$/);
    if (mDist)
      return withEdgeCache(req, ctx,
        () => tokenDistributionHandler(req, { contractName: mDist[1] }),
        30
      );

    const mCandles = path.match(/^\/pairs\/([^\/]+)\/candles$/);
if (mCandles) {
  return withEdgeCache(
    req, ctx,
    () => pairCandlesHandler(req),
    TTL_5S      // small cache; each candle query is heavy
  );
}

    /* ── static GET routes --------------------------------------- */
    const entry = STATIC[path];
    if (!entry) return json({ error: "Route not found" }, { status: 404 });

    const { handler, ttl } =
      typeof entry === "function" ? { handler: entry, ttl: undefined } : entry;

    return withEdgeCache(req, ctx, () => handler(req, ctx), ttl);
  }
};
