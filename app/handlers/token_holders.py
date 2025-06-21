"""
Handler for token holders endpoint
"""
import logging
from fastapi import Request, HTTPException
from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_token_holders(request: Request, contract_name: str):
    """
    Get holders of a specific token with pagination
    
    Args:
        request: The incoming request
        contract_name: The token contract name
        
    Returns:
        JSON response with token holders
    """
    try:
        logger.info(f"Getting token holders for: {contract_name}")
        
        # Parse query parameters
        offset = request.query_params.get('offset', '0')
        limit = request.query_params.get('limit', '10')
        
        # Convert to integers with validation
        try:
            offset = int(offset)
            limit = int(limit)
        except ValueError:
            return json_response(
                {"error": "Invalid offset or limit parameter"},
                status_code=400
            )
        
        # Validate and sanitize parameters
        safe_offset = max(0, offset)
        safe_limit = min(max(1, limit), 20)  # Max 20 holders per page
        
        logger.info(f"Offset: {safe_offset}, Limit: {safe_limit}")
        
        # Fetch one extra to determine if there's a next page
        fetch_limit = safe_limit + 1
        
        # Query for token holders
        query = f"""
            query TokenHolders {{
                allStates(
                    filter: {{
                        and: {{
                            key: {{ startsWith: "{contract_name}.balances:", notLike: "%:%:%" }}
                            valueNumeric: {{ greaterThan: "0" }}
                        }}
                    }}
                    orderBy: VALUE_NUMERIC_DESC
                    first: {fetch_limit}
                    offset: {safe_offset}
                ) {{
                    totalCount
                    edges {{ 
                        node {{ 
                            key 
                            value 
                        }} 
                    }}
                }}
            }}
        """
        
        logger.info(f"Executing query: {query}")
        data = await execute_graphql_query(query)
        
        # Check if we got results
        edges = data.get('data', {}).get('allStates', {}).get('edges', [])
        total_count = data.get('data', {}).get('allStates', {}).get('totalCount', 0)
        
        logger.info(f"Got {len(edges)} holders, total count: {total_count}")
        
        if not edges:
            # If we're on page 1 with no results, return empty array
            # If we're beyond page 1 with no results but there are holders, we're out of range
            if safe_offset > 0 and total_count > 0 and safe_offset >= total_count:
                return json_response({
                    "error": "Offset out of range",
                    "message": f"The requested offset {safe_offset} exceeds the available data. Total holders: {total_count}"
                }, status_code=400)
            
            return json_response({
                "contractName": contract_name,
                "holders": [],
                "pagination": {
                    "offset": safe_offset,
                    "limit": safe_limit,
                    "total": total_count,
                    "next": None,
                    "previous": None
                }
            })
        
        # Determine if there's a next page
        has_more = len(edges) > safe_limit
        # Slice to the requested limit
        holder_edges = edges[:safe_limit]
        
        # Process holder data
        holders = []
        for edge in holder_edges:
            node = edge.get('node', {})
            key = node.get('key', '')
            value = node.get('value')
            
            if ':' in key:
                address = key.split(':')[1]
                holders.append({
                    "address": address,
                    "balance": float(value) if value else 0
                })
        
        # Build the response
        response = {
            "contractName": contract_name,
            "holders": holders,
            "pagination": {
                "offset": safe_offset,
                "limit": safe_limit,
                "total": total_count,
                "next": safe_offset + safe_limit if has_more else None,
                "previous": max(0, safe_offset - safe_limit) if safe_offset > 0 else None
            }
        }
        
        logger.info(f"Sending response with {len(holders)} holders")
        
        return json_response(response)
    except Exception as error:
        logger.error(f"Error getting token holders: {error}")
        return json_response({
            "error": "Failed to fetch token holders",
            "message": str(error)
        }, status_code=500)