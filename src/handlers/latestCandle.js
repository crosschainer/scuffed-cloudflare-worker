// handlers/latestCandle.js
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json } from "../utils/response.js";

// reuse from pairCandles.js
import { price0 } from "./pairCandles.js";

export async function getLatestCandleHandler(req) {
  const url = new URL(req.url);
  const pairId = url.pathname.match(/^\/pairs\/([^\/]+)\/candles$/)?.[1];
  const token = url.searchParams.get("token") ?? "0";
  const interval = url.searchParams.get("interval") ?? "1h";

  if (!pairId) return json({ error: "Missing pairId" }, { status: 400 });

  const ivMs = interval === "1h" ? 3600e3  // or use your intervalMs() util
              : interval === "5m" ? 5 * 60e3
              : 3600e3;

  const now = Date.now();
  const bucketStart = Math.floor(now / ivMs) * ivMs;
  const sinceIso = new Date(bucketStart).toISOString();
  const untilIso = new Date(bucketStart + ivMs).toISOString();

  const gql = `
    query Swaps(
      $pair: String!,
      $since: Datetime!,
      $until: Datetime!
    ) {
      allEvents(
        condition: {contract:"con_pairs",event:"Swap"}
        filter: {
          dataIndexed:{contains:{pair:$pair}}
          created: {greaterThanOrEqualTo:$since, lessThan:$until}
        }
        orderBy: CREATED_DESC
        first: 1000
      ) {
        edges { node { created data } }
      }
    }
  `;

  const res = await executeGraphQLQuery(gql, {
    pair: pairId,
    since: sinceIso,
    until: untilIso
  });

  const edges = res?.data?.allEvents?.edges || [];
  if (!edges.length) {
    // Return empty candle if no trades
    return json({
      t: new Date(bucketStart).toISOString(),
      open: null, high: null, low: null, close: null,
      volume: 0
    });
  }

  const raw = [];
  for (const { node: { created, data } } of edges) {
    const p0 = price0(data);
    if (p0 != null) raw.push({ ts: Date.parse(created), p0, data });
  }

  raw.sort((a, b) => a.ts - b.ts);

  const prices = raw.map(r => r.p0);
  const open = prices[0];
  const close = prices.at(-1);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const v0 = raw.reduce((acc, r) => acc + (+r.data.amount0In || 0) + (+r.data.amount0Out || 0), 0);
  const v1 = raw.reduce((acc, r) => acc + (+r.data.amount1In || 0) + (+r.data.amount1Out || 0), 0);

  const candle = {
    t: new Date(bucketStart).toISOString(),
    open: token === "0" ? open : 1 / open,
    high: token === "0" ? high : 1 / low,
    low:  token === "0" ? low  : 1 / high,
    close: token === "0" ? close : 1 / close,
    volume: token === "0" ? v0 : v1
  };

  return json(candle);
}
