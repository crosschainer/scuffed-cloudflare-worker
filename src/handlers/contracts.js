// src/routes/contracts.js
import { json } from "../utils/response.js";
import { executeGraphQLQuery } from "../utils/graphql.js";

/* ------------------------------------------------------------------ */
/* 1) GET /contracts?offset=…&limit=…                                  */
/* ------------------------------------------------------------------ */
export async function getAllContracts(request /*, _params, _env */) {
  try {
    /* 1a. Pagination params (limit hard-capped at 20) */
    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, Number.parseInt(searchParams.get("offset") ?? "0", 10));
    const limit  = Math.min(
      20,
      Math.max(1, Number.parseInt(searchParams.get("limit")  ?? "10", 10)),
    );

    /* 1b. GraphQL query */
    const query = `
      query GetContracts($offset:Int!, $first:Int!) {
        allContracts(offset: $offset, first: $first, orderBy: CREATED_DESC) {
          nodes      { name created }
          totalCount
        }
      }
    `;

    /* 1c. Call the API */
    const { data, errors } = await executeGraphQLQuery(query, { offset, first: limit });
    if (errors?.length) throw new Error(errors[0].message);

    const { nodes = [], totalCount = 0 } = data?.allContracts ?? {};

    /* 1d. Normalise + paginate */
    const contracts = nodes.map(({ name, created }) => ({
      name,
      created_at: created,
    }));
    const next     = offset + limit < totalCount ? offset + limit : null;
    const previous = offset > 0 ? Math.max(0, offset - limit)  : null;

    return json(
      { contracts, pagination: { offset, limit, total: totalCount, next, previous } },
      { status: 200, headers: { "Cache-Control": "max-age=120" } },
    );
  } catch (err) {
    console.error("getAllContracts error:", err);
    return json(
      { error: "Failed to fetch contracts", message: err.message },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/* 2) GET /contracts/:contractName/code                                */
/* ------------------------------------------------------------------ */
export async function getContractCode(_request, { contractName }) {
  try {
    /* 2a. Basic validation */
    if (!contractName || contractName.includes(":")) {
      return json(
        { error: "Bad request", message: "Invalid or missing contractName." },
        { status: 400 },
      );
    }

    /* 2b. GraphQL query (using a variable to stay injection-safe) */
    const query = `
      query GetContractCode($name:String!) {
        contractByName(name: $name) {
          name code created
        }
      }
    `;

    const { data, errors } = await executeGraphQLQuery(query, { name: contractName });
    if (errors?.length) throw new Error(errors[0].message);

    const contract = data?.contractByName;
    if (!contract) {
      return json({ error: "Contract not found" }, { status: 404 });
    }

    /* 2c. Success */
    return json(
      {
        name       : contract.name,
        code       : contract.code,
        created_at : contract.created,
      },
      { status: 200, headers: { "Cache-Control": "max-age=120" } },
    );
  } catch (err) {
    console.error("getContractCode error:", err);
    return json(
      { error: "Failed to fetch contract code", message: err.message },
      { status: 500 },
    );
  }
}
