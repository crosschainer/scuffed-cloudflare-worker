/**
 * Get the balance of a specific address for a given token contract
 *
 * Route shape (example):
 *   GET /balance/:contractName/:address
 *
 *   • contractName → on-chain contract that holds the balances mapping, e.g. `con_usdc`
 *   • address      → any valid Lamden address (64-char hex or a named key like `currency`)
 *
 * Response:
 *   {
 *     "contractName": "con_usdc",
 *     "address": "79ce1de9c6…",
 *     "balance": 12345.6789          // 0   if address not found
 *   }
 */

import { json } from "../utils/response.js";
import { executeGraphQLQuery } from "../utils/graphql.js";

/**
 * Get token balance for (contractName, address)
 * @param {Request} request      – incoming request (unused, but kept for symmetry)
 * @param {{ contractName:string, address:string }} params – extracted by the router
 */
export async function getTokenBalance(request, { contractName, address }) {
  try {
    /* ------------------------------------------------------------ */
    /* 1) Basic validation / sanitisation                            */
    /* ------------------------------------------------------------ */
    if (!contractName || !address) {
      return json(
        { error: "Bad request", message: "contractName and address are required." },
        { status: 400 }
      );
    }

    // Prevent accidental key-injection: strip any embedded colon
    if (contractName.includes(":") || address.includes(":")) {
      return json(
        { error: "Bad request", message: "Illegal ':' in contractName or address." },
        { status: 400 }
      );
    }

    /* ------------------------------------------------------------ */
    /* 2) Build the state-key and GraphQL query                      */
    /* ------------------------------------------------------------ */
    // State keys look like:    "<contract>.balances:<address>"
    const stateKey = `${contractName}.balances:${address}`;

    const query = `
      query Balance {
        allStates(
          filter: { key: { equalTo: "${stateKey}" } }
          first: 1
        ) {
          edges { node { value } }
        }
      }
    `;

    /* ------------------------------------------------------------ */
    /* 3) Execute query                                              */
    /* ------------------------------------------------------------ */
    const gql = await executeGraphQLQuery(query);
    const edge = gql?.data?.allStates?.edges?.[0];
    const balanceRaw = edge ? edge.node.value : null;

    /* ------------------------------------------------------------ */
    /* 4) Normalise result                                           */
    /* ------------------------------------------------------------ */
    const balance = balanceRaw !== null ? parseFloat(balanceRaw) : 0;

    return json({ contractName, address, balance }, { status: 200 });
  } catch (err) {
    /* ------------------------------------------------------------ */
    /* 5) Error handling                                             */
    /* ------------------------------------------------------------ */
    console.error("getTokenBalance error:", err);
    return json(
      { error: "Failed to fetch balance", message: err.message },
      { status: 500 }
    );
  }
}
