/* ------------------------------------------------------------------ */
/*  handlers/getTokenBalance.js                                       */
/* ------------------------------------------------------------------ */
import { json } from "../utils/response.js";
import { executeGraphQLQuery } from "../utils/graphql.js";

/* RPC node that understands the simulate-tx endpoint */
const RPC = "https://node.xian.org";

/* small helpers ---------------------------------------------------- */
const toHex = bytes =>
  [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");

const b64  = str => typeof atob === "function" ? atob(str) : Buffer.from(str, "base64").toString("binary");

/* ------------------------------------------------------------------ */
/**
 * GET /balance/:contractName/:address
 */
export async function getTokenBalance(_request, { contractName, address }) {
  try {
    /* 1 — basic validation ------------------------------------------- */
    if (!contractName || !address)
      return json({ error: "contractName and address required" }, { status: 400 });

    if (contractName.includes(":") || address.includes(":"))
      return json({ error: "Illegal ':' in parameters" }, { status: 400 });

    /* 2 — try balance_of via simulate_tx ----------------------------- */
    let balance = await tryBalanceOf(contractName, address);

    /* 3 — fallback to state key if simulate failed ------------------- */
    if (balance === null) balance = await fallbackStateKey(contractName, address);

    /* 4 — normalise & return ---------------------------------------- */
    return json(
      { contractName, address, balance: balance ?? 0 },
      { status: 200 }
    );
  } catch (err) {
    console.error("getTokenBalance error:", err);
    return json(
      { error: "Failed to fetch balance", message: err.message },
      { status: 500 }
    );
  }
}

/* ================================================================== */
/*  ────── helpers ──────────────────────────────────────────────────  */
/* ================================================================== */

/**
 * Call contract.balance_of(address) through /simulate_tx.
 * Returns a JS number, or null if the call is unsupported / empty.
 */
async function tryBalanceOf(contract, addr) {
  try {
    const payload = {
      sender:   addr,            // any valid sender works for simulate
      contract,
      function: "balance_of",
      kwargs:   { address: addr }
    };

    const hex = toHex(new TextEncoder().encode(JSON.stringify(payload)));
    const url = `${RPC}/abci_query?path="/simulate_tx/${hex}"`;

    const { result } = await fetch(url).then(r => r.json());
    const raw = result?.response?.value;
    if (!raw) return null;                     // nothing returned

    const decoded = b64(raw);
    if (!decoded || decoded === "\x9Eée" || decoded === "AA==") return null;

    // simulate_tx wraps result inside {"result": "..."}
    const parsed = JSON.parse(decoded)?.result;
    return parsed != null ? Number.parseFloat(parsed) : null;
  } catch {
    return null;                               // network / parse error
  }
}

/**
 * Legacy path: read <contract>.balances:<address> from state table
 */
async function fallbackStateKey(contract, addr) {
  const stateKey = `${contract}.balances:${addr}`;

  const query = `
    query Balance {
      allStates(filter:{ key:{ equalTo:"${stateKey}" } } first:1){
        edges{ node{ value } }
      }
    }`;

  try {
    const gql   = await executeGraphQLQuery(query);
    const edge  = gql?.data?.allStates?.edges?.[0];
    const value = edge ? edge.node.value : null;
    return value !== null ? Number.parseFloat(value) : 0;
  } catch {
    return 0;
  }
}
