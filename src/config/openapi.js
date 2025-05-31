/**
 * OpenAPI specification for the Xian API
 */

/**
 * Minimal OpenAPI 3.0 specification for our endpoints.
 * Served at GET /openapi.json.
 */
export const openapiSpec = {
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