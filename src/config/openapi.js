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
    {
      name: "Tokens",
      description: "Endpoints related to token contracts and metadata",
    },
    {
      name: "Markets",
      description: "Endpoints related to token markets and pricing",
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
    "/tokens": {
      get: {
        tags: ["Tokens"],
        summary: "Get all tokens with metadata",
        description: "Returns a paginated list of all tokens with their metadata",
        parameters: [
          {
            name: "offset",
            in: "query",
            description: "Number of items to skip",
            schema: {
              type: "integer",
              default: 0,
              minimum: 0
            }
          },
          {
            name: "limit",
            in: "query",
            description: "Maximum number of items to return (max 20)",
            schema: {
              type: "integer",
              default: 10,
              minimum: 1,
              maximum: 20
            }
          }
        ],
        responses: {
          "200": {
            description: "Returns a list of tokens with pagination information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tokens: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          contractName: { type: "string", example: "con_usdc" },
                          token_name: { type: "string", example: "USDC" },
                          token_symbol: { type: "string", example: "USDC" },
                          token_logo_url: { type: "string", example: "https://example.com/logo.png", nullable: true },
                          token_website: { type: "string", example: "https://www.example.com", nullable: true },
                          total_supply: { type: "number", example: 1000000, nullable: true },
                          operator: { type: "string", example: "k:abc123...", nullable: true },
                          display: { type: "string", example: "USDC (USDC)" },
                          created_at: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z" }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        offset: { type: "integer", example: 0 },
                        limit: { type: "integer", example: 10 },
                        total: { type: "integer", example: 100 },
                        next: { type: "integer", example: 10, nullable: true },
                        previous: { type: "integer", example: null, nullable: true }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/tokens/{contractName}": {
      get: {
        tags: ["Tokens"],
        summary: "Get metadata for a specific token",
        description: "Returns detailed metadata for a specific token by contract name",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Contract name of the token",
            schema: {
              type: "string"
            },
            example: "con_usdc"
          }
        ],
        responses: {
          "200": {
            description: "Returns token metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contractName: { type: "string", example: "con_usdc" },
                    token_name: { type: "string", example: "USDC" },
                    token_symbol: { type: "string", example: "USDC" },
                    token_logo_url: { type: "string", example: "https://example.com/logo.png", nullable: true },
                    token_website: { type: "string", example: "https://www.example.com", nullable: true },
                    total_supply: { type: "number", example: 1000000, nullable: true },
                    operator: { type: "string", example: "k:abc123...", nullable: true },
                    display: { type: "string", example: "USDC (USDC)" },
                    created_at: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z" }
                  }
                }
              }
            }
          },
          "404": {
            description: "Token contract not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Token contract not found" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/tokens/{contractName}/holders": {
      get: {
        tags: ["Tokens"],
        summary: "Get holders of a specific token",
        description: "Returns a paginated list of token holders with their balances",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Contract name of the token",
            schema: {
              type: "string"
            },
            example: "con_usdc"
          },
          {
            name: "offset",
            in: "query",
            required: false,
            description: "Number of items to skip",
            schema: {
              type: "integer",
              default: 0,
              minimum: 0
            }
          },
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Number of holders per page (max 20)",
            schema: {
              type: "integer",
              default: 10,
              minimum: 1,
              maximum: 20
            }
          }
        ],
        responses: {
          "200": {
            description: "Returns token holders with pagination",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contractName: { type: "string", example: "con_usdc" },
                    holders: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          address: { type: "string", example: "k:abc123..." },
                          balance: { type: "number", example: 1000.5 }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        offset: { type: "integer", example: 0 },
                        limit: { type: "integer", example: 10 },
                        total: { type: "integer", example: 100 },
                        next: { type: "integer", example: 10, nullable: true },
                        previous: { type: "integer", example: null, nullable: true }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Token contract not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Token contract not found" }
                  }
                }
              }
            }
          },
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to fetch token holders" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/markets": {
      get: {
        tags: ["Markets"],
        summary: "Get all markets (token pairs)",
        description: "Returns a list of all markets (token pairs) with price information",
        parameters: [
          {
            name: "limit",
            in: "query",
            description: "Maximum number of markets to return",
            schema: {
              type: "integer",
              default: 100
            }
          },
          {
            name: "offset",
            in: "query",
            description: "Number of markets to skip",
            schema: {
              type: "integer",
              default: 0
            }
          }
        ],
        responses: {
          "200": {
            description: "List of markets with price information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    markets: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          pair: { type: "string", example: "con_pair_currency_usdc" },
                          token0: { type: "string", example: "currency" },
                          token1: { type: "string", example: "con_usdc" },
                          token0Symbol: { type: "string", example: "XIAN" },
                          token1Symbol: { type: "string", example: "USDC" },
                          label: { type: "string", example: "XIAN / USDC" },
                          price0: { type: ["number", "null"], example: 0.12 },
                          price1: { type: ["number", "null"], example: 8.33 },
                          changePct0: { type: ["number", "null"], example: 2.5 },
                          changePct1: { type: ["number", "null"], example: -1.2 },
                          usdPrice0: { type: ["number", "null"], example: 0.12 },
                          usdPrice1: { type: ["number", "null"], example: null },
                          volume24h: { type: "number", example: 15000 }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        offset: { type: "integer", example: 0 },
                        limit: { type: "integer", example: 100 },
                        total: { type: "integer", example: 57 },
                        next: { type: ["integer", "null"], example: 100 },
                        previous: { type: ["integer", "null"], example: null }
                      }
                    }
                  }
                }
              }
            }
          },
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to fetch markets data" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/tokens/{contractName}/markets": {
      get: {
        tags: ["Markets"],
        summary: "Get markets for a specific token",
        description: "Returns markets (token pairs) that include the specified token with price information",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Token contract name",
            schema: {
              type: "string"
            }
          }
        ],
        responses: {
          "200": {
            description: "Markets for the specified token",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contractName: { type: "string", example: "currency" },
                    markets: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          pair: { type: "string", example: "con_pair_currency_usdc" },
                          token0: { type: "string", example: "currency" },
                          token1: { type: "string", example: "con_usdc" },
                          token0Symbol: { type: "string", example: "XIAN" },
                          token1Symbol: { type: "string", example: "USDC" },
                          label: { type: "string", example: "XIAN / USDC" },
                          price: { type: "number", example: 0.12 },
                          pairedToken: { type: "string", example: "con_usdc" },
                          pairedSymbol: { type: "string", example: "USDC" },
                          baseSymbol: { type: "string", example: "XIAN" },
                          changePct: { type: "number", example: 2.5 },
                          usdPrice: { type: ["number", "null"], example: 0.12 },
                          volume24h: { type: "number", example: 15000 },
                          lastTraded: { type: ["string", "null"], example: "2025-05-30T12:34:56.789" }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Token not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Token not found" }
                  }
                }
              }
            }
          },
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to fetch markets data for token" }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
};
