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
    description: "API endpoints for retrieving data from Xian. If data is missing or you need real-time data, please get it through https://node.xian.org/graphiql instead. All endpoints here have a couple seconds cache.",
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
      name: "Contracts",
      description: "Endpoints related to smart contracts",
    },
    {
      name: "Market",
      description: "Endpoints related to trading pairs and market data",
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
    "/token/{contractName}/balance/{address}": {
      get: {
        tags: ["Tokens"],
        summary: "Get balance of an address for a given token contract",
        description:
          "Returns the balance of `address` in the `contractName.balances` mapping. " +
          "If the address has no entry, balance will be `0`.",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Token contract name, e.g. `con_usdc`",
            schema: { type: "string" },
            example: "con_usdc",
          },
          {
            name: "address",
            in: "path",
            required: true,
            description: "Wallet address (64-char hex) or special key",
            schema: { type: "string" },
            example: "79ce1de9c6d4c8c3638f96e4e63e1d6d7f2a9a0d9342bbcfb9c8b0c7e5d4f6a9",
          },
        ],
        responses: {
          "200": {
            description: "Balance found (or zero if not present)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contractName: { type: "string", example: "con_usdc" },
                    address:      { type: "string", example: "79ce1de9c6…" },
                    balance:      { type: "number", example: 1234.5678 },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request (missing / malformed path parts)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error:   { type: "string", example: "Bad request" },
                    message: { type: "string", example: "contractName and address are required." },
                  },
                },
              },
            },
          },
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error:   { type: "string", example: "Failed to fetch balance" },
                    message: { type: "string", example: "Error message details" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/contracts": {
      get: {
        tags: ["Contracts"],
        summary: "Get all contracts",
        description: "Returns a paginated list of all contracts",
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
            description: "Returns a list of contracts with pagination information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    contracts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string", example: "con_mycontract" },
                          created_at: { type: "string", example: "2023-01-01T00:00:00Z" }
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
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to fetch contracts" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/contracts/{contractName}": {
      get: {
        tags: ["Contracts"],
        summary: "Get code for a specific contract",
        description: "Returns the code and metadata for a specific contract by name",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Name of the contract",
            schema: {
              type: "string"
            },
            example: "con_mycontract"
          }
        ],
        responses: {
          "200": {
            description: "Returns contract code and metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", example: "con_mycontract" },
                    code: { type: "string", example: "(module...)" },
                    created_at: { type: "string", example: "2023-01-01T00:00:00Z" }
                  }
                }
              }
            }
          },
          "404": {
            description: "Contract not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Contract not found" }
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
                    error: { type: "string", example: "Failed to fetch contract code" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/pairs": {
      get: {
        tags: ["Market"],
        summary: "Get all trading pairs",
        description: "Returns a paginated list of all trading pairs created through the con_pairs contract. Set **inverse=true** to invert price & volume so they are quoted as token1 / token0 instead of token0 / token1.",
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
            description: "Maximum number of items to return (max 10)",
            schema: {
              type: "integer",
              default: 10,
              minimum: 1,
              maximum: 10
            }
          },
          {
            name: "inverse",
            in: "query",
            required: false,
            description: "If **true**, return price and volume with the tokens swapped (token1 / token0). Default is **false** (token0 / token1).",
            schema: {
              type: "boolean",
              default: false
            }
          }
        ],
        responses: {
          "200": {
            description: "Returns a list of trading pairs with pagination information",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    pairs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          token0: { type: "string", example: "con_usdc" },
                          token1: { type: "string", example: "con_xian" },
                          pair_address: { type: "string", example: "con_pair_usdc_xian" },block_height: { type: "integer", example: 12345 },
                          created_at: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z" },
                          priceXian: { type: "number", example: 0.0123, nullable: true, description: "Price in XIAN" },
                          priceUSD: { type: "number", example: 0.0045, nullable: true, description: "Price in USD" },
                          priceChange24h: { type: "number", example: 5.23, nullable: true, description: "24-hour price change percentage" },
                          lastPriceUpdate: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z", nullable: true, description: "Timestamp of the last price update" },
                          volume24hToken0: { type: "number", example: 1000.5, nullable: true, description: "24-hour trading volume in token0" },
                          volume24hToken1: { type: "number", example: 500.25, nullable: true, description: "24-hour trading volume in token1" },
                          volume24hXian: { type: "number", example: 123.45, nullable: true, description: "24-hour trading volume in XIAN" },
                          volume24hUSD: { type: "number", example: 456.78, nullable: true, description: "24-hour trading volume in USD" }
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
          "500": {
            description: "Server error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Failed to fetch trading pairs" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/pairs/{contractName}": {
      get: {
        tags: ["Market"],
        summary: "Get details about trading pairs for specific contract",
        description: "Returns detailed information about pairs that include the token `contractName`. Supports **inverse=true** like the /pairs endpoint.",
        parameters: [
          {
            name: "contractName",
            in: "path",
            required: true,
            description: "Contract name of the involved token",
            schema: {
              type: "string"
            },
            example: "currency"
          },
          {
            name: "inverse",
            in: "query",
            required: false,
            description: "If **true**, return price and volume with the tokens swapped (token1 / token0). Default is **false** (token0 / token1).",
            schema: {
              type: "boolean",
              default: false
            }
          }
        ],
        responses: {
          "200": {
            description: "Array of matching pairs",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer", example: 2 },
                    pairs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          pair_address: { type: "string" },
                          token0: { type: "string" },
                          token1: { type: "string" },
                          created_at: { type: "string" },
                          priceXian: { type: "number", example: 0.0123, nullable: true, description: "Price in XIAN" },
                          priceUSD: { type: "number", example: 0.0045, nullable: true, description: "Price in USD" },
                          priceChange24h: { type: "number", example: 5.23, nullable: true, description: "24-hour price change percentage" },
                          lastPriceUpdate: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z", nullable: true, description: "Timestamp of the last price update" },
                          volume24hToken0: { type: "number", example: 1000.5, nullable: true, description: "24-hour trading volume in token0" },
                          volume24hToken1: { type: "number", example: 500.25, nullable: true, description: "24-hour trading volume in token1" },
                          volume24hXian: { type: "number", example: 123.45, nullable: true, description: "24-hour trading volume in XIAN" },
                          volume24hUSD: { type: "number", example: 456.78, nullable: true, description: "24-hour trading volume in USD" }
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "404": {
            description: "No pairs found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "No pairs found" }
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
                    error: { type: "string", example: "Failed to fetch pair details" },
                    message: { type: "string", example: "Error message details" }
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
