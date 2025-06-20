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
      metaKeys.push(`${name}.metadata:token_logo_url`);
      metaKeys.push(`${name}.metadata:token_website`);
      metaKeys.push(`${name}.metadata:total_supply`);
      metaKeys.push(`${name}.metadata:operator`);
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
        token_logo_url: m.token_logo_url || null,
        token_website: m.token_website || null,
        total_supply: m.total_supply ? parseFloat(m.total_supply) : null,
        operator: m.operator || null,
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
export async function getTokenByName(request, { contractName }) {
  try {
    const contractNames = decodeURIComponent(contractName).split(',').map(name => name.trim()).filter(Boolean);

    console.log(`Getting token data for: ${contractNames.join(', ')}`);

    // Generate dynamic GraphQL filters
    const nameFilters = contractNames.map(name => `{ equalTo: "${name}" }`).join(", ");
    const stateKeys = contractNames.flatMap(name => [
      `${name}.metadata:token_name`,
      `${name}.metadata:token_symbol`,
      `${name}.metadata:token_logo_url`,
      `${name}.metadata:token_website`,
      `${name}.metadata:total_supply`,
      `${name}.metadata:operator`,
    ]);

        const query = `
      query GetTokenData($names: [String!], $stateKeys: [String!], $firstContracts: Int!, $firstStates: Int!) {
        allContracts(
          filter: {
            xsc0001: {equalTo: true},
            name: {in: $names}
          },
          first: $firstContracts
        ) {
          nodes {
            name
            created
         }
        }
        allStates(
          filter: { key: { in: $stateKeys } },
          first: $firstStates
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

    console.log(`Executing query: ${query}`);
    const data = await executeGraphQLQuery(query, {
      names: contractNames,
      stateKeys,
      firstContracts: contractNames.length,    // enough to cover all requested names
      firstStates:    stateKeys.length         // enough to cover every metadata key
    });
    console.log(`Query result: ${JSON.stringify(data)}`);

    const contracts = data?.data?.allContracts?.nodes || [];
    const metaEdges = data?.data?.allStates?.edges || [];

    const results = contractNames.map(name => {
      const contract = contracts.find(c => c.name === name);
      if (!contract) {
        return {
          contractName: name,
          error: 'Token contract not found',
          message: 'The specified contract does not exist or is not a token (XSC-0001 standard)'
        };
      }

      const metadata = {};
      metaEdges.forEach(({ node }) => {
        if (node.key.startsWith(`${name}.metadata:`)) {
          const field = node.key.split(":")[1];
          metadata[field] = node.value;
        }
      });

      return {
        contractName: contract.name,
        token_name: metadata.token_name || null,
        token_symbol: metadata.token_symbol || null,
        token_logo_url: metadata.token_logo_url || null,
        token_website: metadata.token_website || null,
        total_supply: metadata.total_supply ? parseFloat(metadata.total_supply) : null,
        operator: metadata.operator || null,
        display: metadata.token_name
          ? `${metadata.token_name}${metadata.token_symbol ? " (" + metadata.token_symbol + ")" : ""}`
          : contract.name,
        created_at: contract.created
      };
    });

    return json(results.length === 1 ? results[0] : results);

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
