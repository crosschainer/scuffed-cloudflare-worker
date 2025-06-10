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
    description: "API endpoints for retrieving data from Xian. If data is missing, please get it through https://node.xian.org/graphiql instead. All endpoints here have 5 seconds cache.",
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
      name: "Transactions", 
      description: "Endpoints related to blockchain transactions" 
    },
    {
      name: "Pairs",
      description: "Endpoints related to trading pairs",
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
                    maximumSupply: { type: "number", example: 123456789.123 },
                    burnedSupply: { type: "number", example: 12345.123 },
                    totalSupply: { type: "number" },
                    circulatingSupply: { type: "number" },
                    excludedSupply: { type: "number" },
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
    "/transactions": {
      get: {
        tags:       ["Transactions"],
        summary:    "Get recent transactions",
        description:"Returns a paginated list of transactions, newest first",
        parameters: [
          {
            name: "offset",
            in: "query",
            description: "Number of items to skip",
            schema: { type: "integer", default: 0, minimum: 0 }
          },
          {
            name: "limit",
            in: "query",
            description: "Maximum items to return (max 50)",
            schema: { type: "integer", default: 25, minimum: 1, maximum: 50 }
          }
        ],
        responses: {
          "200": {
            description: "Returns transactions with pagination",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    transactions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          block_time:   { type: "string", format: "date-time", example: "2025-01-01T12:34:56Z" },
                          block_height: { type: "integer", example: 123456 },
                          hash:         { type: "string", example: "BE3BE4D5D73C453A0B0AB2AF9267A922508CFF1C075F6801CB7173487ED89EE1" },
                          contract:     { type: "string", example: "con_usdc" },
                          function:     { type: "string", example: "transfer" },
                          stamps:       { type: "integer", example: 50 },
                          result:       { type: "string",  nullable: true, example: "OK" },
                          success:      { type: "boolean", example: true },
                          sender:       { type: "string",  example: "k:abc123…" },
                          created:      { type: "string",  format: "date-time", example: "2025-01-01T12:34:55Z" },
                          nonce:        { type: "integer", example: 42 },
                          jsonContent:  {
                            type: "object",
                            nullable: true,
                            example: { amount: 100, to: "k:def456…" }
                          }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        offset:   { type: "integer", example: 0 },
                        limit:    { type: "integer", example: 25 },
                        next:     { type: "integer", example: 25,  nullable: true },
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
                    error:   { type: "string", example: "Failed to fetch transactions" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/transactions/{hash}": {
      get: {
        tags:       ["Transactions"],
        summary:    "Get a single transaction by hash",
        parameters: [
          {
            name: "hash",
            in: "path",
            required: true,
            description: "Transaction hash",
            schema: { type: "string" },
            example: "BE3BE4D5D73C453A0B0AB2AF9267A922508CFF1C075F6801CB7173487ED89EE1"
          }
        ],
        responses: {
          "200": {
            description: "Returns transaction details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    block_time:   { type: "string", format: "date-time", example: "2025-01-01T12:34:56Z" },
                    block_height: { type: "integer", example: 123456 },
                    hash:         { type: "string", example: "BE3BE4D5D73C453A0B0AB2AF9267A922508CFF1C075F6801CB7173487ED89EE1" },
                    contract:     { type: "string", example: "con_usdc" },
                    function:     { type: "string", example: "transfer" },
                    stamps:       { type: "integer", example: 50 },
                    result:       { type: "string",  nullable: true, example: "OK" },
                          success:      { type: "boolean", example: true },
                          sender:       { type: "string",  example: "k:abc123…" },
                          created:      { type: "string",  format: "date-time", example: "2025-01-01T12:34:55Z" },
                          nonce:        { type: "integer", example: 42 },
                          jsonContent:  {
                            type: "object",
                            nullable: true,
                            example: { amount: 100, to: "k:def456…" }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Transaction not found",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string", example: "Transaction not found" }
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
                    error:   { type: "string", example: "Failed to fetch transaction" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/pairs/{pairId}/volume24h": {
  get: {
    tags: ["Pairs"],
    summary: "Get 24-hour swap volume for a pair",
    parameters: [
      {
        name: "pairId",
        in: "path",
        required: true,
        description: "Pair identifier (the value stored in dataIndexed.pair)",
        schema: { type: "string" },
        example: "1"
      },
      {
        name: "token",
        in:   "query",
        required: false,
        description: "Denomination: 0 = token0 (default), 1 = token1",
        schema: {
          type: "string",
          enum: ["0", "1"],
          default: "0"
        },
        example: "1"
      }
    
    ],
    responses: {
       "200": {
        description: "24-hour volume for the requested pair, denominated in the chosen token",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                pairId:    { type: "string", example: "1" },
                token:     { type: "string", example: "1" },
                volume24h: { type: "number", format: "float", example: 98765.43 }
              }
            }
          }
        }
      },
      "400": {
        description: "Missing or invalid pairId",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "Missing \"pair\" query parameter" }
              }
            }
          }
        }
      },
      "404": {
        description: "Pair not found",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "Pair not found" }
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
                error:   { type: "string", example: "Internal error" },
                message: { type: "string", example: "Error message details" }
              }
            }
          }
        }
      }
    }
  }
},

    "/transactions/sender/{sender}": {
      get: {
        tags: ["Transactions"],
        summary: "Get transactions by sender",
        description:
          "Returns a paginated list of transactions for a single `sender`, ordered by newest block height first.",
        parameters: [
          {
            name: "sender",
            in: "path",
            required: true,
            description: "Wallet address that signed the transaction",
            schema: { type: "string" },
            example: "f15da2827e73a4a53c6fb44e446ab2863bc7d4389c7671a383a61943a97bb7b3"
          },
          {
            name: "offset",
            in: "query",
            description: "Number of items to skip",
            schema: { type: "integer", default: 0, minimum: 0 }
          },
          {
            name: "limit",
            in: "query",
            description: "Maximum items to return (max 50)",
            schema: { type: "integer", default: 25, minimum: 1, maximum: 50 }
          }
        ],
        responses: {
          "200": {
            description: "Paginated list of transactions for the sender",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    transactions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          block_time:   { type: "string", format: "date-time", example: "2025-01-01T12:34:56Z" },
                          block_height: { type: "integer", example: 534115 },
                          hash:         { type: "string", example: "BE3BE4D5D73C453A0B0AB2AF9267A922508CFF1C075F6801CB7173487ED89EE1" },
                          contract:     { type: "string", example: "con_usdc" },
                          function:     { type: "string", example: "transfer" },
                          stamps:       { type: "integer", example: 14 },
                          result:       { type: "string", nullable: true, example: "OK" },
                          success:      { type: "boolean", example: true },
                          sender:       { type: "string", example: "k:abc123def456…" },
                          created:      { type: "string", format: "date-time", example: "2025-01-01T12:34:55Z" },
                          nonce:        { type: "integer", example: 42 },
                          jsonContent:  {
                            type: "object",
                            nullable: true,
                            example: { amount: 100, to: "k:def456…" }
                          }
                        }
                      }
                    },
                    pagination: {
                      type: "object",
                      properties: {
                        offset:   { type: "integer", example: 0 },
                        limit:    { type: "integer", example: 25 },
                        next:     { type: "integer", example: 25, nullable: true },
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
                    error:   { type: "string", example: "Failed to fetch transactions" },
                    message: { type: "string", example: "Error message details" }
                  }
                }
              }
            }
          }
        }
      }
    },

  },
};
