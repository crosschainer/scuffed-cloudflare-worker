"""
Handler for pair reserves endpoint
"""
import logging
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_pair_reserves(request: Request, pair_id: str = None):
    """
    Get reserves for a specific pair
    
    Args:
        request: The incoming request
        pair_id: The pair ID
        
    Returns:
        JSON response with pair reserves
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
        key0 = f"con_pairs.pairs:{pair_id}:balance0"
        key1 = f"con_pairs.pairs:{pair_id}:balance1"
        
        gql = """
            query Reserves($key0: String!, $key1: String!) {
                token0: allStates(filter: { key: { equalTo: $key0 } }) {
                    edges { node { valueNumeric } }
                }
                token1: allStates(filter: { key: { equalTo: $key1 } }) {
                    edges { node { valueNumeric } }
                }
            }
        """
        
        data = await execute_graphql_query(
            gql,
            {"key0": key0, "key1": key1}
        )
        
        reserve0 = 0
        reserve1 = 0
        
        try:
            token0_edges = data.get('data', {}).get('token0', {}).get('edges', [])
            if token0_edges:
                reserve0 = float(token0_edges[0].get('node', {}).get('valueNumeric', 0) or 0)
                
            token1_edges = data.get('data', {}).get('token1', {}).get('edges', [])
            if token1_edges:
                reserve1 = float(token1_edges[0].get('node', {}).get('valueNumeric', 0) or 0)
        except (TypeError, ValueError) as e:
            logger.error(f"Error parsing reserves: {e}")
        
        return json_response({
            "pairId": pair_id,
            "reserve0": reserve0,
            "reserve1": reserve1
        })
    
    except Exception as err:
        logger.error(f"Error in get_pair_reserves: {err}")
        return json_response(
            {"error": "Failed to fetch reserves", "message": str(err)},
            status_code=500
        )