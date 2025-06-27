"""
Handler for pair trades endpoint
"""
import logging
import re
from typing import Dict, Any, Optional
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

# Constants
LIMIT_HARD = 100  # never more than this per call

def price0(d: Dict[str, Any]) -> Optional[float]:
    """Calculate price in token0 units"""
    amount0_in = float(d.get('amount0In', 0) or 0)
    amount0_out = float(d.get('amount0Out', 0) or 0)
    amount1_in = float(d.get('amount1In', 0) or 0)
    amount1_out = float(d.get('amount1Out', 0) or 0)
    
    if amount0_in > 0 and amount1_out > 0:
        return amount0_in / amount1_out
    elif amount1_in > 0 and amount0_out > 0:
        return amount0_out / amount1_in
    else:
        return None

async def get_pair_trades(request: Request, pair_id: str = None):
    """
    Handler: GET /pairs/<pairId>/trades
    
    Query-string parameters:
      • offset (default 0)   – row offset (newest = 0)
      • limit  (default 50)  – rows to return (max 100)
      • token  (default 0)   – 0 = price/amount in token0, 1 = token1
    
    Returns newest-first trades plus pagination info.
    """
    try:
        # Extract pair_id from path if not provided
        if not pair_id:
            path = request.url.path
            match = re.match(r'^/pairs/([^/]+)/trades$', path)
            if match:
                pair_id = match.group(1)
            else:
                return json_response({"error": "Missing pairId"}, status_code=400)
        
        # Get query parameters
        token = request.query_params.get("token", "0")
        if token not in ["0", "1"]:
            return json_response({"error": 'token must be "0" or "1"'}, status_code=400)
        
        try:
            offset = max(0, int(request.query_params.get("offset", "0")))
            limit = min(
                LIMIT_HARD,
                max(1, int(request.query_params.get("limit", "50")))
            )
        except ValueError:
            return json_response({"error": "Invalid offset or limit"}, status_code=400)
        
        # GraphQL query
        query = """
            query Trades($pair:String!,$first:Int!,$offset:Int!) {
                allEvents(
                    condition:{ contract:"con_pairs", event:"Swap" }
                    filter:{ dataIndexed:{ contains:{ pair:$pair } } }
                    orderBy: CREATED_DESC
                    first:   $first
                    offset:  $offset
                ){
                    totalCount
                    edges{
                        node{
                            created
                            data
                            txHash
                        }
                    }
                }
            }
        """
        
        res = await execute_graphql_query(
            query,
            {"pair": pair_id, "first": limit, "offset": offset}
        )
        
        total = res.get('data', {}).get('allEvents', {}).get('totalCount', 0)
        rows = res.get('data', {}).get('allEvents', {}).get('edges', [])
        
        # Transform rows
        trades = []
        for row in rows:
            node = row.get('node', {})
            d = node.get('data', {})
            ts = node.get('created')
            hash = node.get('txHash')
            
            a0in = float(d.get('amount0In', 0) or 0)
            a0out = float(d.get('amount0Out', 0) or 0)
            a1in = float(d.get('amount1In', 0) or 0)
            a1out = float(d.get('amount1Out', 0) or 0)
            
            # Direction & price from token0 perspective
            side0 = "buy" if a0in > 0 else "sell"  # buy token0 with token1
            p0 = price0(d)
            if p0 is None:
                continue  # malformed row -> skip
            
            # Apply denomination
            side = side0 if token == "0" else ("sell" if side0 == "buy" else "buy")
            price = p0 if token == "0" else 1 / p0
            amount = (a0in or a0out) if token == "0" else (a1in or a1out)
            amount1 = (a1in or a1out) if token == "0" else (a0in or a0out)
            
            trades.append({
                "created": ts,
                "side": side,
                "amount": amount,
                "amount1": amount1,
                "price": price,
                "token": token,
                "txHash": hash
            })
        
        has_more = offset + limit < total
        
        return json_response({
            "pairId": pair_id,
            "token": token,
            "trades": trades,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": total,
                "next": offset + limit if has_more else None,
                "previous": max(0, offset - limit) if offset > 0 else None
            }
        })
    
    except Exception as err:
        logger.error(f"Error in get_pair_trades: {err}")
        return json_response(
            {"error": "Internal error", "message": str(err)},
            status_code=500
        )