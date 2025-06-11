/**
 * GET /tokens/<contract>/distribution
 *
 * 1. Count non-zero balances.
 * 2. Stream through balances in DESC order, chunk-by-chunk.
 * 3. While iterating:
 *      • keep a running total (totalSupply)
 *      • accumulate buckets: top1 / 10 / 25 / 100
 * 4. “Others” = totalSupply − top100.
 * 5. Return JSON with absolute balances and % of total supply.
 *
 * NOTE: uses the same CHUNK_SIZE and executeGraphQLQuery helpers as
 *       totalSupplyHandler so it’s memory-safe on large holder sets.
 */

import { CHUNK_SIZE }         from "../config/constants.js";
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

export async function tokenDistributionHandler(request, { contractName }) {
  try {
    /* ── 1. totalCount ------------------------------------------------ */
    const countQry = `
      query Count {
        allStates(
          filter: {
            and: {
              key: { startsWith: "${contractName}.balances:", notLike: "%:%:%" }
              valueNumeric: { greaterThan: "0" }
            }
          }
        ) { totalCount }
      }`;
    const cntJson  = await executeGraphQLQuery(countQry);
    const totalCnt = parseInt(cntJson?.data?.allStates?.totalCount || "0", 10);
    if (!totalCnt)
      return json({ contractName, distribution: null, totalSupply: 0 });

    /* ── 2. iterate in chunks ---------------------------------------- */
    const chunkQry = `
      query Chunk($first:Int!,$offset:Int!){
        allStates(
          filter:{
            and:{
              key:{startsWith:"${contractName}.balances:",notLike:"%:%:%"}
              valueNumeric:{greaterThan:"0"}
            }
          }
          orderBy: VALUE_NUMERIC_DESC
          first: $first
          offset:$offset
        ){
          edges{ node{ key value } }
        }
      }`;

    let offset = 0, idx = 0;
    let total = 0;
    const bucket = { top1:0, top10:0, top25:0, top100:0 };
    const addToBucket = (amt) => {
      idx++; total += amt;
      if      (idx === 1)        bucket.top1  += amt;
      if      (idx <= 10)        bucket.top10 += amt;
      if      (idx <= 25)        bucket.top25 += amt;
      if      (idx <= 100)       bucket.top100+= amt;
    };

    while (offset < totalCnt) {
      const v  = { first: CHUNK_SIZE, offset };
      const j  = await executeGraphQLQuery(chunkQry, v);
      const es = j?.data?.allStates?.edges || [];
      if (!es.length) break;

      for (const { node } of es) addToBucket(parseFloat(node.value) || 0);

      if (es.length < CHUNK_SIZE) break;
      offset += CHUNK_SIZE;
    }

    /* ── 3. derive “others” and percentages -------------------------- */
    const pct = (n) => (total ? (n / total) * 100 : 0);

    const distribution = {
      top1  : { balance: bucket.top1,
                percent: pct(bucket.top1) },

      top10 : { balance: bucket.top10,
                percent: pct(bucket.top10) },

      top25 : { balance: bucket.top25,
                percent: pct(bucket.top25) },

      top100: { balance: bucket.top100,
                percent: pct(bucket.top100) },

      others: { balance: total - bucket.top100,
                percent: pct(total - bucket.top100) }
    };

    return json({ contractName, totalSupply: total, distribution });

  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: "Failed to compute distribution",
                  message: err.message }, { status: 500 });
  }
}
