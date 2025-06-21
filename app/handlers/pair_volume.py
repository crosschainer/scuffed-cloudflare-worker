"""
Handler for pair volume endpoint
"""
import logging
from datetime import datetime, timedelta
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_pair_volume(request: Request, pair_id: str = None):
    """
    Handler for GET /pairs/<pairId>/volume24h
    
    1) Pull last-24-h swaps for the pair (max 1000 rows).
    2) Sum the selected token-side (0 or 1) in the worker.
    3) Return JSON { pairId, token, volume24h }.
    """
    try:
        # Extract pair_id from path if not provided
        if not pair_id:
            pair_id = request.query_params.get("pair")
            if not pair_id:
                return json_response(
                    {"error": 'Missing "pair" query parameter'},
                    status_code=400
                )
        
        # Get token parameter (default: 0)
        token = request.query_params.get("token", "0")
        if token not in ["0", "1"]:
            return json_response(
                {"error": 'Invalid "token" param – must be "0" or "1"'},
                status_code=400
            )
        
        # Calculate timestamp for 24 hours ago
        since = (datetime.now() - timedelta(days=1)).isoformat().replace("Z", "")
        
        # GraphQL query
        volume_query = """
            query VolumeLast24h($pair: String!, $since: Datetime!) {
                allEvents(
                    condition: { contract: "con_pairs", event: "Swap" }
                    filter: {
                        dataIndexed: { contains: { pair: $pair } }
                        created:     { greaterThan: $since }
                    }
                    first: 1000
                ) {
                    edges { node { data } }
                }
            }
        """
        
        data = await execute_graphql_query(
            volume_query,
            {"pair": pair_id, "since": since}
        )
        
        # Worker-side aggregation
        events = data.get('data', {}).get('allEvents', {}).get('edges', [])
        if not isinstance(events, list):
            return json_response(
                {
                    "error": "Malformed or missing data from upstream",
                    "pairId": pair_id,
                    "token": token,
                    "volume24h": None
                },
                status_code=502
            )
        
        if len(events) == 0:
            return json_response({"pairId": pair_id, "token": token, "volume24h": 0})
        
        volume24h = 0
        
        for event in events:
            node_data = event.get('node', {}).get('data', {})
            if token == "0":
                volume24h += float(node_data.get('amount0In', 0) or 0)
                volume24h += float(node_data.get('amount0Out', 0) or 0)
            else:
                volume24h += float(node_data.get('amount1In', 0) or 0)
                volume24h += float(node_data.get('amount1Out', 0) or 0)
        
        # Response
        return json_response({"pairId": pair_id, "token": token, "volume24h": volume24h})
    
    except Exception as err:
        logger.error(f"Error in get_pair_volume: {err}")
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )