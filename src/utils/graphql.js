/**
 * GraphQL utilities for making queries to the Xian GraphQL endpoint
 */

import { GRAPHQL_ENDPOINT } from '../config/constants.js';
import { json } from './response.js';

/**
 * Execute a GraphQL query against the Xian GraphQL endpoint
 * 
 * @param {string} query - The GraphQL query string
 * @param {Object} variables - Variables for the GraphQL query
 * @param {string} errorMessage - Custom error message for failures
 * @returns {Promise<Object>} The parsed JSON response
 * @throws {Response} A JSON error response if the query fails
 */
export async function executeGraphQLQuery(query, variables = {}, errorMessage = "GraphQL query failed") {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw json(
      {
        error: errorMessage,
        status: response.status,
        details: text,
      },
      { status: 502 }
    );
  }

  return await response.json();
}