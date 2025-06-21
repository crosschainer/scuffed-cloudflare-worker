"""
Handler for pair price change endpoint
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

def calc_price0(d: Dict[str, Any]) -> float:
    """Calculate price in token0 units"""
    amount0_in = float(d.get('amount0In', 0) or 0)
    amount0_out = float(d.get('amount0Out', 0) or 0)
    amount1_in = float(d.get('amount1In', 0) or 0)
    amount1_out = float(d.get('amount1Out', 0) or 0)
    
    if amount0_in > 0 and amount1_out > 0:
        return amount0_in / amount1_out
    elif amount1_in > 0 and amount0_out > 0:
        return amount0_out / amount1_in
    return 0

async def get_pair_price_change(request: Request, pair_id: str = None):
    """
    Handler for GET /pairs/<pairId>/pricechange24h
    
    Returns price change percentage over the last 24 hours
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
        since = (datetime.now() - timedelta(days=1)).isoformat()  # keep "Z"
        
        # GraphQL query
        price_query = """
            query PriceChangeLast24h($pair:String!,$since:Datetime!){
                latest: allEvents(
                    first:1 orderBy:CREATED_DESC
                    condition:{contract:"con_pairs",event:"Swap"}
                    filter:{dataIndexed:{contains:{pair:$pair}}}
                ){ edges{node{data created}} }

                baseline: allEvents(
                    first:1 orderBy:CREATED_DESC
                    condition:{contract:"con_pairs",event:"Swap"}
                    filter:{
                        dataIndexed:{contains:{pair:$pair}}
                        created:{lessThanOrEqualTo:$since}
                    }
                ){ edges{node{data created}} }
            }
        """
        
        gql = await execute_graphql_query(
            price_query,
            {"pair": pair_id, "since": since}
        )
        
        # Extract data
        latest_data = None
        baseline_data = None
        
        try:
            latest_data = gql.get('data', {}).get('latest', {}).get('edges', [])[0].get('node', {}).get('data', {})
            baseline_data = gql.get('data', {}).get('baseline', {}).get('edges', [])[0].get('node', {}).get('data', {})
        except (IndexError, AttributeError):
            pass
        
        if not latest_data or not baseline_data:
            return json_response({
                "pairId": pair_id,
                "token": token,
                "priceNow": None,
                "price24hAgo": None,
                "changePct": None,
                "error": "Not enough data"
            }, status_code=200)
        
        # Calculate prices
        price_now = calc_price0(latest_data)
        price_24h_ago = calc_price0(baseline_data)
        
        if token == "1":
            price_now = 1 / price_now if price_now else 0
            price_24h_ago = 1 / price_24h_ago if price_24h_ago else 0
        
        # Calculate change percentage
        change_pct = None
        if price_24h_ago > 0:
            change_pct = ((price_now - price_24h_ago) / price_24h_ago) * 100
        
        # Response
        return json_response({
            "pairId": pair_id,
            "token": token,
            "priceNow": price_now,
            "price24hAgo": price_24h_ago,
            "changePct": change_pct
        })
    
    except Exception as err:
        logger.error(f"Error in get_pair_price_change: {err}")
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )