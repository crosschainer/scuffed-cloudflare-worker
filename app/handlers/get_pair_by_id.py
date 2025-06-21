"""
Handler for getting pair by ID
"""
import logging
from typing import Dict, Any, Optional
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_pair_by_id(request: Request, pair_id: str = None):
    """
    Handler for GET /pairs/<id>
    
    Returns metadata for a specific pair.
    """
    try:
        # Extract pair_id from path if not provided
        if not pair_id:
            url_path = request.url.path
            match = url_path.match(r'^/pairs/([^/]+)$')
            if match:
                pair_id = match.group(1)
            else:
                return json_response({"error": "Missing pair ID"}, status_code=400)
        
        # GraphQL query to get pair metadata
        query = """
            query PairById($pair: String!) {
                allEvents(
                    condition: {contract: "con_pairs", event: "PairCreated"}
                    filter: {dataIndexed: {contains: {pair: $pair}}}
                    first: 1
                ) {
                    edges {
                        node {
                            created
                            data
                            dataIndexed
                        }
                    }
                }
            }
        """
        
        # Execute query
        result = await execute_graphql_query(
            query,
            {"pair": pair_id}
        )
        
        # Extract pair data
        edges = result.get('data', {}).get('allEvents', {}).get('edges', [])
        if not edges:
            return json_response({"error": "Pair not found"}, status_code=404)
        
        node = edges[0].get('node', {})
        data_indexed = node.get('dataIndexed', {})
        
        # Format response
        pair_data = {
            "pair": data_indexed.get('pair'),
            "token0": data_indexed.get('token0'),
            "token1": data_indexed.get('token1'),
            "created": node.get('created')
        }
        
        return json_response(pair_data)
    
    except Exception as err:
        logger.error(f"Error in get_pair_by_id: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )