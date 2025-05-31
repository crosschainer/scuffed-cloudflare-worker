import { json } from '../utils/response';
import { executeGraphQLQuery } from '../utils/graphql';

/**
 * Get all tokens with their metadata with pagination
 * @param {Request} request - The incoming request
 * @returns {Promise<Response>} - The response with token data
 */
export async function getAllTokens(request) {
  const url = new URL(request.url);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = parseInt(url.searchParams.get('limit') || '10', 10);
  
  // Cap the limit to prevent excessive queries
  const safeLimit = Math.min(limit, 100);
  
  try {
    // First query - get all contracts with pagination
    const contractListQuery = `
      query TokenContracts {
        allContracts(
          first: ${safeLimit}
          offset: ${offset}
          orderBy: CREATED_DESC
        ) {
          totalCount
          nodes { 
            name 
            created 
          }
        }
      }
    `;
    
    const contractsData = await executeGraphQLQuery(contractListQuery);
    
    const nodes = contractsData?.data?.allContracts?.nodes || [];
    const totalCount = contractsData?.data?.allContracts?.totalCount || 0;
    
    if (!nodes.length) {
      return json({
        tokens: [],
        pagination: {
          offset,
          limit: safeLimit,
          total: totalCount
        }
      });
    }
    
    // Build the list of metadata keys we need
    const metaKeys = [];
    nodes.forEach(({ name }) => {
      metaKeys.push(`${name}.metadata:token_name`);
      metaKeys.push(`${name}.metadata:token_symbol`);
    });
    
    // Second query - pull the metadata in one call
    const metaQuery = `
      query TokenMeta {
        allStates(filter:{ key:{ in:[${metaKeys.map(k => `"${k}"`).join(',')}] } }) {
          edges { node { key value } }
        }
      }
    `;
    
    const metaResp = await executeGraphQLQuery(metaQuery);
    const metaEdges = metaResp?.data?.allStates?.edges || [];
    
    // Build a lookup: { con_usdc: { token_name:'USDC', ... } }
    const metaMap = {};
    metaEdges.forEach(({ node }) => {
      const [contractDotMeta, field] = node.key.split(":");
      const contract = contractDotMeta.replace(".metadata", "");
      if (!metaMap[contract]) metaMap[contract] = {};
      metaMap[contract][field] = node.value;
    });
    
    // Final combine & format
    const tokens = nodes.map(c => {
      const m = metaMap[c.name] || {};
      const display = m.token_name
        ? `${m.token_name}${m.token_symbol ? " (" + m.token_symbol + ")" : ""}`
        : c.name;
      
      return {
        name: c.name,
        token_name: m.token_name || null,
        token_symbol: m.token_symbol || null,
        display,
        created_at: c.created
      };
    });
    
    return json({
      tokens,
      pagination: {
        offset,
        limit: safeLimit,
        total: totalCount,
        next: offset + safeLimit < totalCount ? offset + safeLimit : null,
        previous: offset > 0 ? Math.max(0, offset - safeLimit) : null
      }
    });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch tokens' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get metadata for a specific token by contract name
 * @param {Request} request - The incoming request
 * @param {Object} params - URL parameters
 * @returns {Promise<Response>} - The response with token metadata
 */
export async function getTokenByName(request, { contractName }) {
  try {
    console.log(`Getting token data for: ${contractName}`);
    
    // First, check if the contract exists
    const contractQuery = `
      query GetContract {
        allContracts(filter: {name: {equalTo: "${contractName}"}}) {
          nodes {
            name
            created
          }
        }
      }
    `;
    
    console.log(`Executing contract query: ${contractQuery}`);
    const contractData = await executeGraphQLQuery(contractQuery);
    console.log(`Contract query result: ${JSON.stringify(contractData)}`);
    
    const contract = contractData?.data?.allContracts?.nodes?.[0];
    
    if (!contract) {
      console.log(`Contract not found: ${contractName}`);
      return new Response(JSON.stringify({ error: 'Token contract not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Contract found: ${JSON.stringify(contract)}`);
    
    // Get token metadata
    const metaQuery = `
      query TokenMeta {
        allStates(filter: { key: { in: ["${contractName}.metadata:token_name", "${contractName}.metadata:token_symbol", "${contractName}.metadata:token_decimals"] } }) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    `;
    
    console.log(`Executing metadata query: ${metaQuery}`);
    const metaResp = await executeGraphQLQuery(metaQuery);
    console.log(`Metadata query result: ${JSON.stringify(metaResp)}`);
    
    const metaEdges = metaResp?.data?.allStates?.edges || [];
    
    // Build the metadata object
    const metadata = {};
    metaEdges.forEach(({ node }) => {
      const [, field] = node.key.split(":");
      metadata[field] = node.value;
    });
    
    console.log(`Metadata parsed: ${JSON.stringify(metadata)}`);
    
    // Get token supply if available
    const supplyQuery = `
      query TokenSupply {
        state(key: "${contractName}.supply") {
          key
          value
        }
      }
    `;
    
    console.log(`Executing supply query: ${supplyQuery}`);
    const supplyData = await executeGraphQLQuery(supplyQuery);
    console.log(`Supply query result: ${JSON.stringify(supplyData)}`);
    
    const supply = supplyData?.data?.state?.value;
    
    // Format the response
    const tokenData = {
      name: contract.name,
      token_name: metadata.token_name || null,
      token_symbol: metadata.token_symbol || null,
      token_decimals: metadata.token_decimals ? parseInt(metadata.token_decimals, 10) : null,
      supply: supply || null,
      created_at: contract.created
    };
    
    console.log(`Final token data: ${JSON.stringify(tokenData)}`);
    return json(tokenData);
  } catch (error) {
    console.error('Error fetching token metadata:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch token metadata',
      message: error.message || 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}