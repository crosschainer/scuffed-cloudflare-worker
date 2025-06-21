"""
Handlers for token-related endpoints
"""
from typing import Dict, List, Optional, Union, Any
from fastapi import Request, HTTPException

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response


async def get_all_tokens(request: Request):
    """
    Get all tokens with their metadata with pagination
    
    Args:
        request: The incoming request
        
    Returns:
        JSON response with token data
    """
    url = request.url
    offset = int(request.query_params.get('offset', '0'))
    limit = int(request.query_params.get('limit', '10'))
    
    # Cap the limit to prevent excessive queries
    safe_limit = min(limit, 20)
    
    try:
        # First query - get all contracts with pagination
        contract_list_query = f"""
            query TokenContracts {{
                allContracts(
                    first: {safe_limit}
                    offset: {offset}
                    filter: {{xsc0001: {{equalTo: true}}}}
                    orderBy: CREATED_DESC
                ) {{
                    totalCount
                    nodes {{ 
                        name 
                        created 
                    }}
                }}
            }}
        """
        
        contracts_data = await execute_graphql_query(contract_list_query)
        
        nodes = contracts_data.get('data', {}).get('allContracts', {}).get('nodes', [])
        total_count = contracts_data.get('data', {}).get('allContracts', {}).get('totalCount', 0)
        
        if not nodes:
            return json_response({
                "tokens": [],
                "pagination": {
                    "offset": offset,
                    "limit": safe_limit,
                    "total": total_count
                }
            })
        
        # Build the list of metadata keys we need
        meta_keys = []
        for node in nodes:
            name = node.get('name')
            meta_keys.append(f"{name}.metadata:token_name")
            meta_keys.append(f"{name}.metadata:token_symbol")
            meta_keys.append(f"{name}.metadata:token_logo_url")
            meta_keys.append(f"{name}.metadata:token_website")
            meta_keys.append(f"{name}.metadata:total_supply")
            meta_keys.append(f"{name}.metadata:operator")
        
        # Second query - pull the metadata in one call
        meta_query = f"""
            query TokenMeta {{
                allStates(filter:{{ key:{{ in:[{','.join([f'"{k}"' for k in meta_keys])}] }} }}) {{
                    edges {{ node {{ key value }} }}
                }}
            }}
        """
        
        meta_resp = await execute_graphql_query(meta_query)
        meta_edges = meta_resp.get('data', {}).get('allStates', {}).get('edges', [])
        
        # Build a lookup: { con_usdc: { token_name:'USDC', ... } }
        meta_map = {}
        for edge in meta_edges:
            node = edge.get('node', {})
            key = node.get('key', '')
            value = node.get('value', '')
            
            contract_dot_meta, field = key.split(":")
            contract = contract_dot_meta.replace(".metadata", "")
            
            if contract not in meta_map:
                meta_map[contract] = {}
            
            meta_map[contract][field] = value
        
        # Final combine & format
        tokens = []
        for c in nodes:
            name = c.get('name')
            m = meta_map.get(name, {})
            
            token_name = m.get('token_name')
            token_symbol = m.get('token_symbol')
            
            display = name
            if token_name:
                display = token_name
                if token_symbol:
                    display += f" ({token_symbol})"
            
            tokens.append({
                "contractName": name,
                "token_name": token_name,
                "token_symbol": token_symbol,
                "token_logo_url": m.get('token_logo_url'),
                "token_website": m.get('token_website'),
                "total_supply": float(m.get('total_supply')) if m.get('total_supply') else None,
                "operator": m.get('operator'),
                "display": display,
                "created_at": c.get('created')
            })
        
        return json_response({
            "tokens": tokens,
            "pagination": {
                "offset": offset,
                "limit": safe_limit,
                "total": total_count,
                "next": offset + safe_limit if offset + safe_limit < total_count else None,
                "previous": max(0, offset - safe_limit) if offset > 0 else None
            }
        })
    except Exception as e:
        print(f"Error fetching tokens: {e}")
        return json_response(
            {"error": "Failed to fetch tokens", "message": str(e)},
            status_code=500
        )


async def get_token_by_name(request: Request, contract_name: str):
    """
    Get token by name
    
    Args:
        request: The incoming request
        contract_name: The contract name
        
    Returns:
        JSON response with token data
    """
    try:
        contract_names = contract_name.split(',')
        contract_names = [name.strip() for name in contract_names if name.strip()]
        
        print(f"Getting token data for: {', '.join(contract_names)}")
        
        # Generate dynamic GraphQL filters
        state_keys = []
        for name in contract_names:
            state_keys.extend([
                f"{name}.metadata:token_name",
                f"{name}.metadata:token_symbol",
                f"{name}.metadata:token_logo_url",
                f"{name}.metadata:token_website",
                f"{name}.metadata:total_supply",
                f"{name}.metadata:operator",
            ])
        
        query = """
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
        """
        
        variables = {
            "names": contract_names,
            "stateKeys": state_keys,
            "firstContracts": len(contract_names),  # enough to cover all requested names
            "firstStates": len(state_keys)          # enough to cover every metadata key
        }
        
        data = await execute_graphql_query(query, variables)
        
        contracts = data.get('data', {}).get('allContracts', {}).get('nodes', [])
        meta_edges = data.get('data', {}).get('allStates', {}).get('edges', [])
        
        results = []
        for name in contract_names:
            contract = next((c for c in contracts if c.get('name') == name), None)
            
            if not contract:
                results.append({
                    "contractName": name,
                    "error": "Token contract not found",
                    "message": "The specified contract does not exist or is not a token (XSC-0001 standard)"
                })
                continue
            
            metadata = {}
            for edge in meta_edges:
                node = edge.get('node', {})
                key = node.get('key', '')
                
                if key.startswith(f"{name}.metadata:"):
                    field = key.split(":")[1]
                    metadata[field] = node.get('value', '')
            
            token_name = metadata.get('token_name')
            token_symbol = metadata.get('token_symbol')
            
            display = contract.get('name')
            if token_name:
                display = token_name
                if token_symbol:
                    display += f" ({token_symbol})"
            
            results.append({
                "contractName": contract.get('name'),
                "token_name": token_name,
                "token_symbol": token_symbol,
                "token_logo_url": metadata.get('token_logo_url'),
                "token_website": metadata.get('token_website'),
                "total_supply": float(metadata.get('total_supply')) if metadata.get('total_supply') else None,
                "operator": metadata.get('operator'),
                "display": display,
                "created_at": contract.get('created')
            })
        
        return json_response(results[0] if len(results) == 1 else results)
    
    except Exception as e:
        print(f"Error fetching token metadata: {e}")
        return json_response(
            {
                "error": "Failed to fetch token metadata",
                "message": str(e)
            },
            status_code=500
        )