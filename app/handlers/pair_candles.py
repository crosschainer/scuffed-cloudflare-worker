"""
Handler for pair candles endpoint
"""
import logging
import re
import math
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List, Tuple, Union
from fastapi import Request
from decimal import Decimal, getcontext
from decimal import InvalidOperation

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)
getcontext().prec = 28          # enough for 18-decimals math
# Constants
CHUNK = 1000  # GraphQL page size
MAX_CANDLES = 5000  # hard ceiling per response
TOLERANCE = 1e-12  # price continuity tolerance

def price_from_sync(d: Dict[str, Any]) -> Optional[float]:
    """Mid-price of token0 in token1 units (single definition)."""
    try:
        r0 = Decimal(d["reserve0"])
        r1 = Decimal(d["reserve1"])
        return float(r1 / r0) if r0 != 0 else None
    except (KeyError, InvalidOperation):
        return None

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
        
        now = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        
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
        # ────────────────────────────────────────────────────────────
        # 1) ─ Fetch **Sync** events first  → populate price fields
        # ────────────────────────────────────────────────────────────
        gql_sync = """
        query Syncs($pair: String!, $since: Datetime!, $until: Datetime!,
                    $first: Int!, $after: Cursor) {
            allEvents(
            condition: {contract: "con_pairs", event: "Sync"},
            filter: {
                dataIndexed: {contains: {pair: $pair}},
                created: {greaterThanOrEqualTo: $since, lessThan: $until}
            },
            orderBy: CREATED_DESC, first: $first, after: $after
            ) {
            edges { node { created data } cursor }
            pageInfo { hasNextPage endCursor }
            }
        }
        """

        raw: dict[int, dict[str, Any]] = {}
        after_sync: str | None = None

        while True:
            res = await execute_graphql_query(
                gql_sync,
                {
                    "pair": pair_id,
                    "since": since_iso,
                    "until": until_iso,
                    "first": CHUNK,
                    "after": after_sync,
                },
            )
            edges = (
                res.get("data", {})
                .get("allEvents", {})
                .get("edges", [])
            )
            if not edges:
                break

            for edge in edges:
                node   = edge.get("node", {})
                ts     = int(datetime.fromisoformat(
                                node["created"].replace("Z", "+00:00")
                            ).timestamp() * 1000)
                bucket = math.floor(ts / iv_ms) * iv_ms
                p0     = price_from_sync(node["data"])
                if p0 is None:
                    continue

                rec = raw.setdefault(bucket, {
                    "t":      datetime.fromtimestamp(bucket / 1000, tz=timezone.utc)
                                    .isoformat().replace("+00:00", "Z"),
                    "open":   p0, "high": p0, "low": p0, "close": p0,
                    "v0": 0.0, "v1": 0.0,
                    "openT": ts, "closeT": ts,
                })

                rec["high"]   = max(rec["high"], p0)
                rec["low"]    = min(rec["low"],  p0)
                if ts < rec["openT"]:
                    rec["openT"], rec["open"] = ts, p0
                if ts > rec["closeT"]:
                    rec["closeT"], rec["close"] = ts, p0

            pg = res["data"]["allEvents"]["pageInfo"]
            if not pg["hasNextPage"]:
                break
            after_sync = pg["endCursor"]
        
        # GraphQL query
        gql_swap  = """
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
        
        after_swap: str | None = None
        while True:
            res = await execute_graphql_query(
                gql_swap,
                {
                    "pair": pair_id,
                    "since": since_iso,
                    "until": until_iso,
                    "first": CHUNK,
                    "after": after_swap,
                },
            )
            edges = (
                res.get("data", {})
                .get("allEvents", {})
                .get("edges", [])
            )
            if not edges:
                break

            for edge in edges:
                node   = edge["node"]
                ts     = int(datetime.fromisoformat(
                                node["created"].replace("Z", "+00:00")
                            ).timestamp() * 1000)
                bucket = math.floor(ts / iv_ms) * iv_ms
                d      = node["data"]

                rec = raw.get(bucket)
                if rec is None:
                    continue  # we have volume but no Sync price yet

                rec["v0"] += float(d.get("amount0In",  0) or 0) \
                        + float(d.get("amount0Out", 0) or 0)
                rec["v1"] += float(d.get("amount1In",  0) or 0) \
                        + float(d.get("amount1Out", 0) or 0)

            pg = res["data"]["allEvents"]["pageInfo"]
            if not pg["hasNextPage"]:
                break
            after_swap = pg["endCursor"]

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
                rec_open  = 1/rec['open'] if token == "0" else rec['open']
                open_price  = last_close if last_close is not None else rec_open
                close_price = 1/rec['close'] if token == "0" else rec['close']

                high = 1/rec['high'] if token == "0" else  rec['low']
                low  = 1/rec['low']  if token == "0" else  rec['high']
                
                candles.append({
                    't': rec['t'],
                    'open': open_price,
                    'high': high,
                    'low': low,
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