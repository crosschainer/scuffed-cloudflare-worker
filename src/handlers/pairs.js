/* handlers/getPairs.js ------------------------------------------- */
import { buildPairsSnapshot } from "../utils/pairsSnapshot.js";
import { json }               from "../utils/response.js";

export async function getPairs(request /*, ctx */) {
  const url    = new URL(request.url);
  const offset = Math.max(0,  parseInt(url.searchParams.get("offset") || "0", 10));
  const limit  = Math.min(Math.max(1, parseInt(url.searchParams.get("limit")  || "25", 10)), 100);

  const snapshot = await buildPairsSnapshot({ offset, limit });   // ← no env
  return json(snapshot);
}