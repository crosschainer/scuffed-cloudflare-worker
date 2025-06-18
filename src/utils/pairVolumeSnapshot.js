/* utils/pairVolumeSnapshot.js ------------------------------------ */
import { executeGraphQLQuery } from "../utils/graphql.js";

const WINDOW_MS = 86_400_000;          // 24 h
const CHUNK_LIMIT = 1_000;               // hard-coded upstream cap

/**
 * Return { pairId, token, volume24h } identical to GET /volume24h.
 * @param {{ pairId:string, token:number }} opts
 * @returns {Promise<{pairId:string, token:number, volume24h:number}>}
 */
export async function buildPairVolumeSnapshot({ pairId, token = 0 }) {
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
            volume24h += parseFloat(data.amount0In || 0);
            volume24h += parseFloat(data.amount0Out || 0);
        } else {
            volume24h += parseFloat(data.amount1In || 0);
            volume24h += parseFloat(data.amount1Out || 0);
        }
    }
    return { pairId, token, volume24h };
}
