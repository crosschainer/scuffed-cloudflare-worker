// routes/transactions.js
import { executeGraphQLQuery } from "../utils/graphql.js";
import { json }                from "../utils/response.js";

/* A reusable mapper so all three endpoints format identically */
function mapTx(node) {
  return {
    block_time  : node.blockTime,
    block_height: node.blockHeight,
    hash        : node.hash,
    contract    : node.contract,
    function    : node.function,
    stamps      : node.stamps,
    result      : node.result,
    success     : node.success,
    sender      : node.sender,
    created     : node.created,
    nonce       : node.nonce,
    jsonContent : node.jsonContent,
  };
}

/* Helper to build the standard paginated response */
function paginated(list, offset, limit, total) {
  const next     = offset + limit < total ? offset + limit : null;
  const previous = offset > 0 ? Math.max(0, offset - limit) : null;
  return { transactions: list, pagination: { offset, limit, total, next, previous } };
}

/* ================================================================ *
 *  GET /transactions?offset=&limit=                                 *
 * ================================================================ */
export async function transactionsHandler(request /*, event */) {
  try {
    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
    const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "25", 10)));

    const query = `
      query AllTxs($offset:Int!, $limit:Int!) {
        allTransactions(first:$limit, offset:$offset, orderBy:BLOCK_HEIGHT_DESC) {
          edges      { node { blockTime blockHeight hash contract function stamps
                               result success sender created nonce jsonContent } }
          totalCount
        }
      }
    `;

    const { data } = await executeGraphQLQuery(query, { offset, limit }, "Upstream GraphQL error on transactions query");
    const edges      = data?.allTransactions?.edges ?? [];
    const totalCount = data?.allTransactions?.totalCount ?? 0;

    return json(paginated(edges.map(({ node }) => mapTx(node)), offset, limit, totalCount));
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

/* ================================================================ *
 *  GET /transactions/sender/:sender?offset=&limit=                  *
 * ================================================================ */
export async function getTransactionsBySender(request, { sender }) {
  try {
    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));
    const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "25", 10)));

    const query = `
      query TxsBySender($sender:String!, $offset:Int!, $limit:Int!) {
        allTransactions(
          filter: { sender: { equalTo: $sender } }
          first: $limit
          offset: $offset
          orderBy: BLOCK_HEIGHT_DESC
        ) {
          edges      { node { blockTime blockHeight hash contract function stamps
                               result success sender created nonce jsonContent } }
          totalCount
        }
      }
    `;

    const { data } = await executeGraphQLQuery(query, { sender, offset, limit }, "Upstream GraphQL error on tx-by-sender query");
    const edges      = data?.allTransactions?.edges ?? [];
    const totalCount = data?.allTransactions?.totalCount ?? 0;

    return json(paginated(edges.map(({ node }) => mapTx(node)), offset, limit, totalCount));
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

/* ================================================================ *
 *  GET /transactions/:hash                                          *
 * ================================================================ */
export async function getTransactionByHash(_request, { hash }) {
  try {
    if (!hash)
      return json({ error: "Bad request", message: "Missing hash." }, { status: 400 });

    const query = `
      query TxByHash($hash:String!) {
        transactionByHash(hash:$hash) {
          blockTime blockHeight hash contract function stamps
          result success sender created nonce jsonContent
        }
      }
    `;

    const { data } = await executeGraphQLQuery(query, { hash }, "Upstream GraphQL error on tx-by-hash query");
    const tx = data?.transactionByHash;
    if (!tx) return json({ error: "Transaction not found" }, { status: 404 });

    return json(mapTx(tx));
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }
}
