import axios from 'axios';
import { GRAPHQL_ENDPOINT } from '../config/constants.js';

/**
 * Get all contracts with pagination
 * @param {Request} request - The incoming request
 * @param {Object} params - URL parameters
 * @param {Object} env - Environment variables
 * @returns {Response} JSON response with contracts data
 */
export async function getAllContracts(request, params, env) {
  try {
    // Get query parameters
    const url = new URL(request.url);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 20);

    // Construct the GraphQL query
    const query = `
      query GetContracts {
        allContracts(offset: ${offset}, first: ${limit}, orderBy: CREATED_DESC) {
          nodes {
            name
            created
          }
          totalCount
        }
      }
    `;

    // Fetch the contracts using the GraphQL endpoint
    const response = await axios.post(GRAPHQL_ENDPOINT, {
      query: query
    });

    // Check if the response contains data
    const contractsData = (response.data?.data?.allContracts?.nodes) || [];
    const totalCount = response.data?.data?.allContracts?.totalCount || 0;

    // Format the contracts data
    const contracts = contractsData.map(contract => ({
      name: contract.name,
      created_at: contract.created,
      submission_date: new Date(contract.created).toISOString()
    }));

    // Calculate pagination values
    const next = offset + limit < totalCount ? offset + limit : null;
    const previous = offset > 0 ? Math.max(0, offset - limit) : null;

    // Return the formatted response
    return new Response(JSON.stringify({
      contracts,
      pagination: {
        offset,
        limit,
        total: totalCount,
        next,
        previous
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=120' // 2-minute cache
      }
    });
  } catch (error) {
    console.error("Error fetching contracts:", error);
    return new Response(JSON.stringify({
      error: "Failed to fetch contracts",
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}

/**
 * Get contract code by contract name
 * @param {Request} request - The incoming request
 * @param {Object} params - URL parameters
 * @param {Object} env - Environment variables
 * @returns {Response} JSON response with contract code
 */
export async function getContractCode(request, params, env) {
  try {
    const { contractName } = params;

    // Construct the GraphQL query
    const query = `
      query GetContractCode {
        contract(name: "${contractName}") {
          name
          code
          created
        }
      }
    `;

    // Fetch the contract using the GraphQL endpoint
    const response = await axios.post(GRAPHQL_ENDPOINT, {
      query: query
    });

    // Check if the response contains data
    const contractData = response.data?.data?.contract;

    if (!contractData) {
      return new Response(JSON.stringify({
        error: "Contract not found"
      }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Return the formatted response
    return new Response(JSON.stringify({
      name: contractData.name,
      code: contractData.code,
      created_at: contractData.created,
      submission_date: new Date(contractData.created).toISOString()
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=120' // 2-minute cache
      }
    });
  } catch (error) {
    console.error("Error fetching contract code:", error);
    return new Response(JSON.stringify({
      error: "Failed to fetch contract code",
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}