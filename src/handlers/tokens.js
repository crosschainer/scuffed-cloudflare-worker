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
  const safeLimit = Math.min(limit, 20);
  
  try {
    // First query - get all contracts with pagination
    const contractListQuery = `
      query TokenContracts {
        allContracts(
          first: ${safeLimit}
          offset: ${offset}
          filter: {xsc0001: {equalTo: true}}
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
        contractName: c.name,
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
    
    // Simplified approach: Get contract and metadata in a single query
    const query = `
      query GetTokenData {
        # Get contract info
        allContracts(filter: {name: {equalTo: "${contractName}"}, xsc0001: {equalTo: true}}) {
          nodes {
            name
            created
          }
        }
        
        # Get token metadata
        allStates(filter: {key: {in: [
          "${contractName}.metadata:token_name", 
          "${contractName}.metadata:token_symbol"
        ]}}) {
          edges {
            node {
              key
              value
            }
          }
        }
      }
    `;
    
    console.log(`Executing query: ${query}`);
    const data = await executeGraphQLQuery(query);
    console.log(`Query result: ${JSON.stringify(data)}`);
    
    // Check if contract exists
    const contract = data?.data?.allContracts?.nodes?.[0];
    
    if (!contract) {
      console.log(`Token contract not found: ${contractName}`);
      return new Response(JSON.stringify({ 
        error: 'Token contract not found', 
        message: 'The specified contract does not exist or is not a token (XSC-0001 standard)'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log(`Contract found: ${JSON.stringify(contract)}`);
    
    // Process metadata
    const metaEdges = data?.data?.allStates?.edges || [];
    const metadata = {};
    
    metaEdges.forEach(({ node }) => {
      const parts = node.key.split(":");
      if (parts.length === 2) {
        const field = parts[1];
        metadata[field] = node.value;
      }
    });
    
    console.log(`Metadata parsed: ${JSON.stringify(metadata)}`);
    
    // Format the response
    const tokenData = {
      contractName: contract.name,
      token_name: metadata.token_name || null,
      token_symbol: metadata.token_symbol || null,
      display: metadata.token_name
        ? `${metadata.token_name}${metadata.token_symbol ? " (" + metadata.token_symbol + ")" : ""}`
        : contract.name,
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
