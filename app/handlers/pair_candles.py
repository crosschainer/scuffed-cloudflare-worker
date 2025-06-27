"""
Handler for pair candles endpoint
"""
import logging
import re
import math
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple, Union
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

# Constants
CHUNK = 1000  # GraphQL page size
MAX_CANDLES = 5000  # hard ceiling per response
TOLERANCE = 1e-12  # price continuity tolerance

def interval_ms(interval_str: str = "1h") -> int:
    """Convert interval string to milliseconds"""
    match = re.match(r'^(\d+)([mhd])$', interval_str, re.I)
    if not match:
        raise ValueError("Bad interval")
    
    n = int(match.group(1))
    unit = match.group(2).lower()
    
    if unit == 'm':
        return n * 60 * 1000
    elif unit == 'h':
        return n * 3600 * 1000
    else:  # 'd'
        return n * 86400 * 1000

def price0(d: Dict[str, Any]) -> Optional[float]:
    """Calculate price of token0 in token1 units"""
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

async def get_pair_candles(request: Request, pair_id: str = None):
    """
    Handler for GET /pairs/<pairId>/candles
    
    Query parameters:
    - token: "0" or "1" (default: "0")
    - interval: time interval for candles (e.g., "5m", "1h", "1d") (default: "1h")
    - range: time range to fetch (e.g., "1d", "7d") (default: "1d")
    - before: ISO timestamp or ms timestamp to fetch candles before
    - after: ISO timestamp or ms timestamp to fetch candles after
    
    Returns candles for the specified pair and parameters.
    """
    try:
        logger.info(f"Processing candles request: {request.url}")
        
        # Extract pair_id from path if not provided
        if not pair_id:
            path = request.url.path
            match = re.match(r'^/pairs/([^/]+)/candles$', path)
            if match:
                pair_id = match.group(1)
            else:
                return json_response({"error": "Missing pairId"}, status_code=400)
        
        # Get query parameters
        token = request.query_params.get("token", "0")
        iv_str = request.query_params.get("interval", "1h")
        range_str = request.query_params.get("range", "1d")
        before_q = request.query_params.get("before")
        after_q = request.query_params.get("after")
        
        # Validate parameters
        if token not in ["0", "1"]:
            return json_response({"error": 'token must be "0" or "1"'}, status_code=400)
        
        if before_q and after_q:
            return json_response({"error": "Use only one of before or after"}, status_code=400)
        
        # Time window calculation
        try:
            iv_ms = interval_ms(iv_str)
            range_ms = interval_ms(range_str)
        except ValueError as e:
            return json_response({"error": str(e)}, status_code=400)
        
        # Cursor-mode widens window
        if before_q or after_q:
            range_ms = MAX_CANDLES * iv_ms
        
        now = int(datetime.now().timestamp() * 1000)
        
        # Parse before/after timestamps
        before_ms = None
        after_ms = None
        
        if before_q:
            try:
                before_ms = int(datetime.fromisoformat(before_q.replace('Z', '+00:00')).timestamp() * 1000)
            except ValueError:
                try:
                    before_ms = int(before_q)
                except ValueError:
                    return json_response({"error": "Invalid before parameter"}, status_code=400)
        
        if after_q:
            try:
                after_ms = int(datetime.fromisoformat(after_q.replace('Z', '+00:00')).timestamp() * 1000)
            except ValueError:
                try:
                    after_ms = int(after_q)
                except ValueError:
                    return json_response({"error": "Invalid after parameter"}, status_code=400)
        
        # Calculate time window
        since_ms = before_ms - range_ms if before_ms is not None else after_ms if after_ms is not None else now - range_ms
        
        # Always set an explicit until
        until_ms = before_ms if before_ms is not None else min(after_ms + range_ms, now) if after_ms is not None else now
        
        # Sanity check on pure-range
        if before_ms is None and after_ms is None:
            buckets = math.ceil(range_ms / iv_ms)
            if buckets > MAX_CANDLES:
                need = range_ms / MAX_CANDLES
                m, h, d = 60e3, 3600e3, 86400e3
                
                if need <= m:
                    sug = f"{math.ceil(need / m)}m"
                elif need <= h:
                    sug = f"{math.ceil(need / h)}h"
                else:
                    sug = f"{math.ceil(need / d)}d"
                
                return json_response({
                    "error": f"Too many candles ({buckets}>{MAX_CANDLES})",
                    "suggestion": f"Use interval ≥ {sug}"
                }, status_code=400)
        
        # Convert timestamps to ISO format
        since_iso = datetime.fromtimestamp(since_ms / 1000).isoformat() + 'Z'
        until_iso = datetime.fromtimestamp(until_ms / 1000).isoformat() + 'Z'
        
        logger.info(f"Fetching candles from {since_iso} to {until_iso}")
        
        # GraphQL query
        gql = """
            query Swaps($pair: String!, $since: Datetime!, $until: Datetime!, $first: Int!, $after: Cursor) {
                allEvents(
                    condition: {contract: "con_pairs", event: "Swap"},
                    filter: {
                        dataIndexed: {contains: {pair: $pair}},
                        created: {greaterThanOrEqualTo: $since, lessThan: $until}
                    },
                    orderBy: CREATED_DESC,
                    first: $first,
                    after: $after
                ) {
                    edges {
                        node {
                            created
                            data
                        }
                        cursor
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        """
        
        # Fetch and process data
        after = None  # cursor-based pagination
        raw = {}  # Using dict instead of Map
        
        while True:
            logger.info(f"Fetching candles page {after or 'start'}")
            res = await execute_graphql_query(
                gql,
                {
                    "pair": pair_id,
                    "since": since_iso,
                    "until": until_iso,
                    "first": CHUNK,
                    "after": after,
                }
            )
            
            edges = res.get('data', {}).get('allEvents', {}).get('edges', [])
            page_info = res.get('data', {}).get('allEvents', {}).get('pageInfo', {})
            
            if not edges:
                break
            
            logger.info(f"Processing {len(edges)} events")
            
            for edge in edges:
                node = edge.get('node', {})
                created = node.get('created')
                data = node.get('data', {})
                
                ts = int(datetime.fromisoformat(created.replace('Z', '+00:00')).timestamp() * 1000)
                bucket = math.floor(ts / iv_ms) * iv_ms
                p0 = price0(data)
                
                if p0 is None:
                    continue
                
                if bucket not in raw:
                    raw[bucket] = {
                        't': datetime.fromtimestamp(bucket / 1000).isoformat() + 'Z',
                        'open': p0,
                        'high': p0,
                        'low': p0,
                        'close': p0,
                        'v0': 0,
                        'v1': 0,
                        'openT': ts,
                        'closeT': ts,
                    }
                
                c = raw[bucket]
                c['high'] = max(c['high'], p0)
                c['low'] = min(c['low'], p0)
                
                if ts < c['openT']:
                    c['openT'] = ts
                    c['open'] = p0
                
                if ts > c['closeT']:
                    c['closeT'] = ts
                    c['close'] = p0
                
                c['v0'] += float(data.get('amount0In', 0) or 0) + float(data.get('amount0Out', 0) or 0)
                c['v1'] += float(data.get('amount1In', 0) or 0) + float(data.get('amount1Out', 0) or 0)
                
                raw[bucket] = c
            
            if not page_info.get('hasNextPage'):
                break
            
            after = page_info.get('endCursor')  # move to next page
        
        logger.info(f"Got {len(raw)} buckets")
        
        # Fill every bucket & serialize
        candles = []
        last_close = None
        
        # Start at the first full bucket ≥ sinceMs
        start = math.ceil(since_ms / iv_ms) * iv_ms
        end = math.floor((until_ms - 1) / iv_ms) * iv_ms
        
        logger.info(f"Filling buckets from {datetime.fromtimestamp(start / 1000).isoformat()} "
                   f"to {datetime.fromtimestamp(end / 1000).isoformat()}, "
                   f"total {(end - start) / iv_ms + 1} buckets")
        
        for b in range(start, end + 1, iv_ms):
            rec = raw.get(b)
            
            if rec:
                # Price in current bucket, adjusted for token perspective
                rec_open = rec['open'] if token == "0" else 1 / rec['open']
                # Determine open price based solely on last_close (no fake candles)
                open_price = last_close if last_close is not None else rec_open
                close_price = rec['close'] if token == "0" else 1 / rec['close']
                
                candles.append({
                    't': rec['t'],
                    'open': open_price,
                    'high': rec['high'] if token == "0" else 1 / rec['low'],
                    'low': rec['low'] if token == "0" else 1 / rec['high'],
                    'close': close_price,
                    'volume': rec['v0'] if token == "0" else rec['v1']
                })
                
                last_close = close_price
                
            elif last_close is not None:
                # Bucket with no trades – flat candle to keep the chart continuous
                candles.append({
                    't': datetime.fromtimestamp(b / 1000).isoformat() + 'Z',
                    'open': last_close,
                    'high': last_close,
                    'low': last_close,
                    'close': last_close,
                    'volume': 0
                })
                # last_close remains unchanged
        
        # Pagination info
        first_ts = None
        if candles:
            try:
                first_ts = int(datetime.fromisoformat(candles[0]['t'].replace('Z', '+00:00')).timestamp() * 1000)
            except (ValueError, IndexError):
                pass
        
        last_t = candles[-1]['t'] if candles else None
        
        page = {
            'after': last_t,
            'before': datetime.fromtimestamp((first_ts + iv_ms) / 1000).isoformat() + 'Z' if first_ts is not None else None,
            'hasNext': bool(before_q) or (not before_q and since_ms > 0 and until_ms < now),
            'hasPrev': bool(after_q) or (until_ms < now)
        }
        
        return json_response({
            'pairId': pair_id,
            'token': token,
            'interval': iv_str,
            'candles': candles,
            'page': page
        })
    
    except Exception as err:
        logger.error(f"Error in get_pair_candles: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )