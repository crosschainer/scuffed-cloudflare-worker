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
        description: "Returns a paginated list of all trading pairs created through the con_pairs contract",
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
          },
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
                          pair_address: { type: "string", example: "con_pair_usdc_xian" },
                          block_height: { type: "integer", example: 12345 },
                          created_at: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z" },
                          priceXian: { type: "number", example: 0.0123, nullable: true, description: "Price in XIAN" },
                          priceUSD: { type: "number", example: 0.0045, nullable: true, description: "Price in USD" },
                          lastPriceUpdate: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z", nullable: true, description: "Timestamp of the last price update" }
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
        description: "Returns detailed information about trading pairs for specific contract",
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
                          block_height: { type: "integer" },
                          created_at: { type: "string" },
                          priceXian: { type: "number", example: 0.0123, nullable: true, description: "Price in XIAN" },
                          priceUSD: { type: "number", example: 0.0045, nullable: true, description: "Price in USD" },
                          lastPriceUpdate: { type: "string", format: "date-time", example: "2023-01-01T00:00:00Z", nullable: true, description: "Timestamp of the last price update" }
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
