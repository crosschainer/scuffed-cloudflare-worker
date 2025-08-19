"""
Handler for pair liquidity endpoint
"""
import logging
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_pair_liquidity(request: Request, pair_id: str = None, address: str = None):
    """
    Get reserves for a specific pair
    
    Args:
        request: The incoming request
        pair_id: The pair ID
        address: The user address for LP token reserves
        
    Returns:
        JSON response with pair total lp tokens and user lp tokens
    """
    try:
        if not pair_id:
            # Check if pair_id is in query parameters
            pair_id = request.query_params.get("pair")
            if not pair_id:
                return json_response(
                    {"error": 'Missing "pair" query parameter'},
                    status_code=400
                )
        
        # Build the two exact keys on the Python side
        key0 = f"con_pairs.pairs:{pair_id}:balances:{address}" # LP tokens of user address
        key1 = f"con_pairs.pairs:{pair_id}:totalSupply" # Total LP tokens
        
        gql = """
            query LP($key0: String!, $key1: String!) {
                userLP: allStates(filter: { key: { equalTo: $key0 } }) {
                    edges { node { valueNumeric } }
                }
                totalLP: allStates(filter: { key: { equalTo: $key1 } }) {
                    edges { node { valueNumeric } }
                }
            }
        """
        
        data = await execute_graphql_query(
            gql,
            {"key0": key0, "key1": key1}
        )
        
        userLP = 0
        totalLP = 0
        
        try:
            userLP_edges = data.get('data', {}).get('userLP', {}).get('edges', [])
            if userLP_edges:
                userLP = float(userLP_edges[0].get('node', {}).get('valueNumeric', 0) or 0)
                
            totalLP_edges = data.get('data', {}).get('totalLP', {}).get('edges', [])
            if totalLP_edges:
                totalLP = float(totalLP_edges[0].get('node', {}).get('valueNumeric', 0) or 0)
        except (TypeError, ValueError) as e:
            logger.error(f"Error parsing reserves: {e}")
        
        return json_response({
            "pairId": pair_id,
            "userLP": userLP,
            "totalLP": totalLP
        })
    
    except Exception as err:
        logger.error(f"Error in get_pair_liquidity: {err}")
        return json_response(
            {"error": "Failed to fetch liquidity", "message": str(err)},
            status_code=500
        )