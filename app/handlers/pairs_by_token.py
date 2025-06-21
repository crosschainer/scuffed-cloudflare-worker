"""
Handler for pairs by token endpoint
"""
import logging
from typing import Dict, Any, Optional, List
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

MAX_LIMIT = 50

async def get_pairs_by_token(request: Request, token_contract: str = None):
    """
    Handler for GET /pairs/with/<tokenContract>
    
    Returns pairs that include the specified token contract.
    """
    try:
        # Extract token from path if not provided
        if not token_contract:
            url_path = request.url.path
            match = url_path.match(r'^/pairs/with/([^/]+)$')
            if match:
                token_contract = match.group(1)
            else:
                return json_response({"error": "Missing token contract"}, status_code=400)
        
        # Get query parameters
        limit = min(
            MAX_LIMIT,
            max(1, int(request.query_params.get("limit", "10")))
        )
        offset = max(0, int(request.query_params.get("offset", "0")))
        order = request.query_params.get("order", "desc").lower()
        
        # Validate order parameter
        if order not in ["asc", "desc"]:
            return json_response({"error": 'order must be "asc" or "desc"'}, status_code=400)
        
        # GraphQL query
        gql = f"""
            query Pairs($tok:String!,$first:Int!,$offset:Int!) {{
                allEvents(
                    condition:{{ contract:"con_pairs", event:"PairCreated" }}
                    filter:{{
                        or:[
                            {{ dataIndexed:{{ contains:{{ token0:$tok }} }} }}
                            {{ dataIndexed:{{ contains:{{ token1:$tok }} }} }}
                        ]
                    }}
                    orderBy: CREATED_{order.upper()}
                    first:   $first
                    offset:  $offset
                ){{
                    totalCount
                    edges{{
                        node{{
                            created
                            dataIndexed
                        }}
                    }}
                }}
            }}
        """
        
        # Execute query
        res = await execute_graphql_query(
            gql,
            {"tok": token_contract, "first": limit, "offset": offset}
        )
        
        # Extract data
        total = res.get('data', {}).get('allEvents', {}).get('totalCount', 0)
        edges = res.get('data', {}).get('allEvents', {}).get('edges', [])
        
        # Transform results
        pairs = []
        for edge in edges:
            node = edge.get('node', {})
            data_indexed = node.get('dataIndexed', {})
            
            pairs.append({
                "pair": data_indexed.get('pair'),
                "token0": data_indexed.get('token0'),
                "token1": data_indexed.get('token1'),
                "created": node.get('created')
            })
        
        # Calculate pagination
        has_more = offset + limit < total
        
        return json_response({
            "token": token_contract,
            "pairs": pairs,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": total,
                "next": offset + limit if has_more else None,
                "previous": max(0, offset - limit) if offset > 0 else None,
                "order": order
            }
        })
    
    except Exception as err:
        logger.error(f"Error in get_pairs_by_token: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )