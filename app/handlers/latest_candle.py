"""
Handler for latest candle endpoint
"""
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response
from app.handlers.pair_candles import price0

logger = logging.getLogger(__name__)

async def get_latest_candle(request: Request, pair_id: str = None):
    """
    Handler for GET /stream/pairs/<pairId>/candles
    
    Returns the latest candle for the current time interval.
    """
    try:
        # Extract pair_id from path if not provided
        if not pair_id:
            url_path = request.url.path
            match = url_path.match(r'^/pairs/([^/]+)/candles$')
            if match:
                pair_id = match.group(1)
            else:
                return json_response({"error": "Missing pairId"}, status_code=400)
        
        # Get query parameters
        token = request.query_params.get("token", "0")
        interval = request.query_params.get("interval", "1h")
        
        # Convert interval to milliseconds
        if interval == "1h":
            iv_ms = 3600 * 1000
        elif interval == "5m":
            iv_ms = 5 * 60 * 1000
        else:
            iv_ms = 3600 * 1000  # Default to 1h
        
        # Calculate current bucket
        now = int(datetime.now().timestamp() * 1000)
        bucket_start = (now // iv_ms) * iv_ms
        since_iso = datetime.fromtimestamp(bucket_start / 1000).isoformat() + 'Z'
        until_iso = datetime.fromtimestamp((bucket_start + iv_ms) / 1000).isoformat() + 'Z'
         # ── Fetch the last trade before this bucket so we can seed the open price
        prev_query = """
            query LastSwap($pair:String!,$before:Datetime!){
             allEvents(
                condition:{contract:"con_pairs",event:"Swap"},
                filter:{
                  dataIndexed:{contains:{pair:$pair}},
                  created:{lessThan:$before}
                },
                orderBy:CREATED_DESC,
               first:1
              ) {
                edges { node { created data } }
              }
            }
        """
        prev_res = await execute_graphql_query(prev_query, {
            "pair": pair_id,
            "before": since_iso
        })
        prev_edges = prev_res.get("data", {}) \
                         .get("allEvents", {}) \
                         .get("edges", [])
        prev_close = None
        if prev_edges:
            prev_data = prev_edges[0]["node"].get("data", {})
            pc = price0(prev_data)
            prev_close = pc if pc is not None else None
        # GraphQL query
        gql = """
            query Swaps(
                $pair: String!,
                $since: Datetime!,
                $until: Datetime!
            ) {
                allEvents(
                    condition: {contract:"con_pairs",event:"Swap"}
                    filter: {
                        dataIndexed:{contains:{pair:$pair}}
                        created: {greaterThanOrEqualTo:$since, lessThan:$until}
                    }
                    orderBy: CREATED_DESC
                    first: 1000
                ) {
                    edges { node { created data } }
                }
            }
        """
        
        res = await execute_graphql_query(gql, {
            "pair": pair_id,
            "since": since_iso,
            "until": until_iso
        })
        
        edges = res.get('data', {}).get('allEvents', {}).get('edges', [])
        
        if not edges:
            # Return empty candle if no trades
            return json_response({
                "t": datetime.fromtimestamp(bucket_start / 1000).isoformat() + 'Z',
                "open": None,
                "high": None,
                "low": None,
                "close": None,
                "volume": 0
            })
        
        # Process trades
        raw = []
        for edge in edges:
            node = edge.get('node', {})
            created = node.get('created')
            data = node.get('data', {})
            
            p0_value = price0(data)
            if p0_value is not None:
                ts = int(datetime.fromisoformat(created.replace('Z', '+00:00')).timestamp() * 1000)
                raw.append({"ts": ts, "p0": p0_value, "data": data})
        
        # Sort by timestamp
         # ── Prepend synthetic tick at bucket_start so open == prior close
        if prev_close is not None:
            raw.insert(0, {"ts": bucket_start, "p0": prev_close, "data": {}})
        
        if not raw:
            return json_response({
                "t": datetime.fromtimestamp(bucket_start / 1000).isoformat() + 'Z',
                "open": None,
                "high": None,
                "low": None,
                "close": None,
                "volume": 0
            })
        
        # Calculate OHLCV
        prices = [r["p0"] for r in raw]
        open_price = prices[0]
        close_price = prices[-1]
        high_price = max(prices)
        low_price = min(prices)
        
        v0 = sum((float(r["data"].get("amount0In", 0) or 0) + float(r["data"].get("amount0Out", 0) or 0)) for r in raw)
        v1 = sum((float(r["data"].get("amount1In", 0) or 0) + float(r["data"].get("amount1Out", 0) or 0)) for r in raw)
        
        # Adjust for token perspective
        candle = {
            "t": datetime.fromtimestamp(bucket_start / 1000).isoformat() + 'Z',
            "open": open_price if token == "0" else 1 / open_price,
            "high": high_price if token == "0" else 1 / low_price,
            "low": low_price if token == "0" else 1 / high_price,
            "close": close_price if token == "0" else 1 / close_price,
            "volume": v0 if token == "0" else v1
        }
        
        return json_response(candle)
    
    except Exception as err:
        logger.error(f"Error in get_latest_candle: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )