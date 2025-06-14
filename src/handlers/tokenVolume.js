/**
 * Handler for GET /pair-volume24h?pair=<pairId>[&token=<0|1>]
 *
 * 1) Pull last-24-h swaps for the pair (max 1000 rows – old limit).
 * 2) Sum the selected token-side (0 or 1) in the worker.
 * 3) Return JSON { pairId, token, volume24h }.
 */

import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function pairVolume24hHandler(request, event) {
  try {
    /* ── 0. inputs ─────────────────────────────────────────────── */
    const url     = new URL(request.url);
    const pairId  = url.searchParams.get("pair");
    const token   = url.searchParams.get("token") ?? "0";   // default: 0

    if (!pairId)
      return json({ error: 'Missing "pair" query parameter' }, { status: 400 });

    if (token !== "0" && token !== "1")
      return json({ error: 'Invalid "token" param – must be "0" or "1"' },
                  { status: 400 });

    /* ── 1. GraphQL query (unchanged) ──────────────────────────── */
    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000)
                   .toISOString()
                   .replace("Z", "");

    const volumeQuery = `
      query VolumeLast24h($pair: String!, $since: Datetime!) {
        allEvents(
          condition: { contract: "con_pairs", event: "Swap" }
          filter: {
            dataIndexed: { contains: { pair: $pair } }
            created:     { greaterThan: $since }
          }
          first: 1000
        ) {
          edges { node { data } }
        }
      }
    `;

    const data = await executeGraphQLQuery(
      volumeQuery,
      { pair: pairId, since },
      "Upstream GraphQL error on pair-volume24h query"
    );

    /* ── 2. worker-side aggregation ────────────────────────────── */
    const events = data?.data?.allEvents?.edges;
    if (!Array.isArray(events)) {
      return json({
        error: "Malformed or missing data from upstream",
        pairId,
        token,
        volume24h: null
      }, { status: 502 });
    }

    if (events.length === 0) {
      return json({ pairId, token, volume24h: 0 });
    }
    let volume24h = 0;

    for (const { node: { data } } of events) {
      if (token === "0") {
        volume24h += parseFloat(data.amount0In  || 0);
        volume24h += parseFloat(data.amount0Out || 0);
      } else {
        volume24h += parseFloat(data.amount1In  || 0);
        volume24h += parseFloat(data.amount1Out || 0);
      }
    }

    /* ── 3. response ───────────────────────────────────────────── */
    return json({ pairId, token, volume24h });
  } catch (error) {
    if (error instanceof Response) return error; // bubbled up from helper
    return json({ error: error.message || "Internal error" }, { status: 500 });
  }
}
