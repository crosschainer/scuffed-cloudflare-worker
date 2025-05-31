/**
 * worker.js
 *
 * A single‐file Cloudflare Worker (ES Module) that exposes:
 *   • GET  /total-supply
 *   • GET  /circulating-supply
 *   • GET  / (Swagger UI)
 *   • GET  /openapi.json (OpenAPI spec)
 *
 * It includes:
 *   1) A simple router (ROUTES map) that dispatches based on pathname.
 *   2) Two supply‐related handlers (totalSupplyHandler, circulatingSupplyHandler).
 *   3) A Swagger handler (serves minimal HTML + OpenAPI JSON).
 *   4) A caching utility withCache() that wraps each handler in a 2-minute edge cache.
 *   5) A json() helper to return JSON responses.
 *
 * Once you paste this into “worker.js” in the Cloudflare Web IDE (Module mode),
 * save/publish, and then navigate to your Worker’s URL:
 *   • https://<your-worker>.workers.dev/            → Swagger UI
 *   • https://<your-worker>.workers.dev/openapi.json → OpenAPI JSON
 *   • https://<your-worker>.workers.dev/total-supply → { totalSupply: … }
 *   • https://<your-worker>.workers.dev/circulating-supply → { … }
 */

// ───────────────────────────────────────────────────────────────────────────────
// Shared Constants & Helpers
// ───────────────────────────────────────────────────────────────────────────────

// The upstream GraphQL endpoint:
const GRAPHQL_ENDPOINT = "https://node.xian.org/graphql";

// When summing balances in chunks, fetch this many records per request:
const CHUNK_SIZE = 2000;

// How many seconds to cache each endpoint’s response at the edge:
const CACHE_TTL_SECONDS = 120;

/**
 * Wraps a JavaScript value (object/array) into a JSON Response.
 * Automatically sets Content-Type: application/json.
 *
 * Usage:
 *   return json({ foo: 123 }, { status: 200 });
 */
function json(obj, options = {}) {
  const { status = 200, headers = {} } = options;
  const baseHeaders = { "Content-Type": "application/json", ...headers };
  return new Response(JSON.stringify(obj), {
    status,
    headers: baseHeaders,
  });
}

/**
 * A helper that wraps any handler in a 2-minute edge cache.
 *
 * Steps:
 *   1) Look in caches.default for an entry under the cacheKey (the full request URL).
 *   2) If found, immediately return that cached Response.
 *   3) If not found, call computeResponse() to get a fresh Response.
 *   4) Attach `Cache-Control: public, max-age=<CACHE_TTL_SECONDS>` to its headers.
 *   5) Put it into caches.default (edge) asynchronously.
 *   6) Return the new Response (with Cache-Control).
 *
 * Usage inside fetch listener:
 *   return await withCache(pathname, request, event, () => myHandler(request, event));
 */
async function withCache(pathname, request, event, computeResponse) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  // 1) Attempt to match in edge cache
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // 2) Cache miss → compute fresh
  let freshResponse;
  try {
    freshResponse = await computeResponse();
  } catch (err) {
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }

  // 3) Clone & attach Cache-Control
  const headers = new Headers(freshResponse.headers);
  headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);

  const responseToCache = new Response(freshResponse.body, {
    status: freshResponse.status,
    headers: headers,
  });

  // 4) Put into edge cache (don’t await—run in background)
  event.waitUntil(cache.put(cacheKey, responseToCache.clone()));

  // 5) Return the new response (with Cache-Control)
  return responseToCache;
}

// ───────────────────────────────────────────────────────────────────────────────
// Route #1: GET /total-supply
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Handler for GET /total-supply
 *
 * 1) Run a GraphQL “count” query to find totalCount of nonzero balances.
 * 2) If totalCount === 0, immediately return { totalSupply: 0 }.
 * 3) Otherwise, loop in chunks of CHUNK_SIZE, fetching `edges { node { value } }`,
 *    summing parseFloat(value) each time.
 * 4) Return JSON { totalSupply: <number> }.
 */
async function totalSupplyHandler(request, event) {
  // 1a) Count all nonzero balances
  const countQuery = `
    query {
      allStates(
        filter: {
          and: {
            key: { startsWith: "currency.balances:", notLike: "%:%:%" }
            valueNumeric: { greaterThan: "0" }
          }
        }
      ) {
        totalCount
      }
    }
  `;
  const countResp = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: countQuery }),
  });

  if (!countResp.ok) {
    const text = await countResp.text();
    return json(
      {
        error: "Upstream GraphQL error on count",
        status: countResp.status,
        details: text,
      },
      { status: 502 }
    );
  }

  const countJson = await countResp.json();
  const totalCountRaw = countJson?.data?.allStates?.totalCount;
  const totalCount = totalCountRaw != null ? parseInt(totalCountRaw, 10) : 0;

  // 2) If zero nonzero balances:
  if (totalCount === 0) {
    return json({ totalSupply: 0 });
  }

  // 3) Otherwise, fetch in chunks of CHUNK_SIZE
  let offset = 0;
  let runningSum = 0;

  const chunkQuery = `
    query FetchChunk($first: Int!, $offset: Int!) {
      allStates(
        filter: {
          and: {
            key: { startsWith: "currency.balances:", notLike: "%:%:%" }
            valueNumeric: { greaterThan: "0" }
          }
        }
        orderBy: VALUE_DESC
        first: $first
        offset: $offset
      ) {
        edges {
          node {
            value
          }
        }
      }
    }
  `;

  while (offset < totalCount) {
    const variables = { first: CHUNK_SIZE, offset: offset };
    const chunkResp = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: chunkQuery, variables }),
    });

    if (!chunkResp.ok) {
      const text = await chunkResp.text();
      return json(
        {
          error: "Upstream GraphQL error on chunk fetch",
          status: chunkResp.status,
          details: text,
        },
        { status: 502 }
      );
    }

    const chunkJson = await chunkResp.json();
    const edges = chunkJson?.data?.allStates?.edges || [];

    for (const edge of edges) {
      const rawVal = edge.node?.value;
      if (rawVal != null) {
        runningSum += parseFloat(rawVal) || 0;
      }
    }

    if (edges.length < CHUNK_SIZE) {
      // Fewer than CHUNK_SIZE items → we’re done
      break;
    }
    offset += CHUNK_SIZE;
  }

  return json({ burnedSupply: (111111111 - runningSum), maximumSupply: 111111111, totalSupply: runningSum });
}

// ───────────────────────────────────────────────────────────────────────────────
// Route #2: GET /circulating-supply
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Handler for GET /circulating-supply
 *
 * 1) Call totalSupplyHandler() to get { totalSupply }.
 * 2) Run a single GraphQL query to fetch all “excluded” keys & values:
 *       [ "currency.balances:team_lock", "currency.balances:dao_funding_stream", … ]
 * 3) Sum parseFloat(value) of each returned node → excludedSum.
 * 4) circulatingSupply = totalSupply − excludedSum.
 * 5) Return JSON { totalSupply, excludedSupply: excludedSum, circulatingSupply, excludedAddresses }.
 */
async function circulatingSupplyHandler(request, event) {
  // 1) Get totalSupply
  const totalResp = await totalSupplyHandler(request, event);
  if (totalResp.status !== 200) {
    // If totalSupplyHandler returned an error, forward it
    return totalResp;
  }
  const totalJson = await totalResp.json();
  const totalSupply = parseFloat(totalJson.totalSupply) || 0;

  // 2) Define which keys to exclude
  const excludedKeys = [
    "currency.balances:team_lock",
    "currency.balances:dao_funding_stream",
    "currency.balances:dao",
    "currency.balances:con_team_y1_linear_vesting",
    "currency.balances:masternodes",
    "currency.balances:con_farm_xian_usdc",
  ];

  // 3) Fetch key & value for each excluded address
  const excludedQuery = `
    query {
      allStates(
        filter: {
          key: { in: [${excludedKeys.map((k) => `"${k}"`).join(", ")}] }
        }
      ) {
        edges {
          node {
            key
            value
          }
        }
      }
    }
  `;
  const exclResp = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: excludedQuery }),
  });

  if (!exclResp.ok) {
    const text = await exclResp.text();
    return json(
      {
        error: "Upstream GraphQL error on excluded-supply query",
        status: exclResp.status,
        details: text,
      },
      { status: 502 }
    );
  }

  const exclJson = await exclResp.json();
  const edges = exclJson?.data?.allStates?.edges || [];

  // 4) Build an array of { key, value } and sum numeric values
  const excludedAddresses = [];
  let excludedSum = 0;
  for (const edge of edges) {
    const key = edge.node?.key;
    const rawVal = edge.node?.value;
    const numericVal = rawVal != null ? parseFloat(rawVal) || 0 : 0;

    if (key != null) {
      excludedAddresses.push({ key, value: numericVal });
      excludedSum += numericVal;
    }
  }

  const circulatingSupply = totalSupply - excludedSum;
  return json({
    totalSupply,
    excludedSupply: excludedSum,
    circulatingSupply,
    excludedAddresses,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// Route #3: GET /total-holders
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Handler for GET /total-holders
 *
 * 1) Run a GraphQL query to count all holders:
 *       query {
 *         allStates(filter: key: { startsWith: "currency.balances:", notLike: "%:%:%" } }) {
 *           totalCount
 *         }
 *       }
 * 2) Return JSON { totalHolders: <number> }.
 */
async function totalHoldersHandler(request, event) {
  const holdersQuery = `
    query {
      allStates(
        filter: {
          key: { startsWith: "currency.balances:", notLike: "%:%:%" }
        }
      ) {
        totalCount
      }
    }
  `;
  const resp = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: holdersQuery }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return json(
      {
        error: "Upstream GraphQL error on total-holders query",
        status: resp.status,
        details: text,
      },
      { status: 502 }
    );
  }

  const data = await resp.json();
  const totalCountRaw = data?.data?.allStates?.totalCount;
  const totalHolders = totalCountRaw != null ? parseInt(totalCountRaw, 10) : 0;

  return json({ totalHolders });
}

// ───────────────────────────────────────────────────────────────────────────────
// Route #4: GET /  (Swagger UI HTML)  &  GET /openapi.json  (OpenAPI spec)
// ───────────────────────────────────────────────────────────────────────────────

/**
 * Minimal OpenAPI 3.0 specification for our two supply endpoints.
 * We’ll serve it at GET /openapi.json.
 */
const openapiSpec = {
  openapi: "3.0.0",
  info: {
    title: "General Xian API",
    version: "1.0.0",
    description: "API endpoints for retrieving data from Xian. If data is missing or you need real-time data, please get it through https://node.xian.org/graphiql instead. All endpoints here have 2-minute edge cache.",
  },
  tags: [
    {
      name: "Supply",
      description: "Endpoints related to coin supply",
    },
  ],
  paths: {
    "/total-supply": {
      get: {
        tags: ["Supply"],
        summary: "Get total Xian supply",
        responses: {
          "200": {
            description: "Returns { totalSupply: number }",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    burnedSupply: { type: "number", example: 12345.123 },
                    maximumSupply: { type: "number", example: 123456789.123 },
                    totalSupply: { type: "number", example: 123456789.123 },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/circulating-supply": {
      get: {
        tags: ["Supply"],
        summary: "Get circulating Xian supply",
        responses: {
          "200": {
            description:
              "Returns { totalSupply, excludedSupply, circulatingSupply, excludedAddresses }",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalSupply: { type: "number" },
                    excludedSupply: { type: "number" },
                    circulatingSupply: { type: "number" },
                    excludedAddresses: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          key: { type: "string" },
                          value: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/total-holders": {
      get: {
        tags: ["Supply"],
        summary: "Get total number of Xian holders",
        responses: {
          "200": {
            description: "Returns { totalHolders: number }",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalHolders: { type: "number", example: 12345 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};


/**
 * Handler for both:
 *   GET "/"           → returns HTML page loading Swagger UI from CDN
 *   GET "/openapi.json" → returns the JSON OpenAPI spec above
 */
async function swaggerHandler(request, event) {
  const url = new URL(request.url);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") {
    pathname = "/";
  }

  if (pathname === "/") {
    // Serve a minimal HTML page that loads Swagger UI from unpkg.com
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>General Xian API Docs</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"
  />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui'
      });
    };
  </script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (pathname === "/openapi.json") {
    // Serve the OpenAPI JSON
    return json(openapiSpec);
  }

  // Any other path → 404
  return json({ error: "Not found" }, { status: 404 });
}

// ───────────────────────────────────────────────────────────────────────────────
// Simple Router & Fetch Event Listener
// ───────────────────────────────────────────────────────────────────────────────

/**
 * A mapping of normalized pathname → handler(request, event)
 *  "/"                    → swaggerHandler
 *  "/openapi.json"        → swaggerHandler
 *  "/total-supply"        → totalSupplyHandler
 *  "/circulating-supply"  → circulatingSupplyHandler
 *
 * To add a new route, simply register it here, e.g.:
 *   "/foo": fooHandler
 */
const ROUTES = {
  "/": swaggerHandler,
  "/openapi.json": swaggerHandler,
  "/total-supply": totalSupplyHandler,
  "/circulating-supply": circulatingSupplyHandler,
  "/total-holders": totalHoldersHandler,
};

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});

async function handleRequest(event) {
  const request = event.request;
  const url = new URL(request.url);

  // Normalize pathname: strip trailing slashes → if empty, set to "/"
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") {
    pathname = "/";
  }

  // Only allow GET on all routes
  if (request.method !== "GET") {
    return json({ error: "Only GET allowed." }, { status: 405 });
  }

  // Lookup which handler should run
  const routeHandler = ROUTES[pathname];
  if (!routeHandler) {
    return json({ error: "Route not found" }, { status: 404 });
  }

  // Wrap the handler in a 2-minute edge cache
  return await withCache(pathname, request, event, () =>
    routeHandler(request, event)
  );
}
