"""
Handler for latest candle endpoint
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal, getcontext, InvalidOperation
from typing import Dict, Any, Optional
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)
getcontext().prec = 28            # 18-decimals math

# ────────────────────────────────────────────────────────────────
def price_from_sync(d: Dict[str, Any]) -> Optional[float]:
    """Mid-price of token0 in token1 units."""
    try:
        r0 = Decimal(d["reserve0"])
        r1 = Decimal(d["reserve1"])
        return float(r1 / r0) if r0 != 0 else None
    except (KeyError, InvalidOperation):
        return None
# ────────────────────────────────────────────────────────────────

IV_LOOKUP_MS = {"5m": 5 * 60_000, "1h": 3_600_000}

async def get_latest_candle(request: Request, pair_id: str | None = None):
    """
    GET /stream/pairs/<pairId>/candles
    Returns the latest candle for the current interval.
    """
    try:
        # ── path & query params
        if pair_id is None:
            m = request.url.path.split("/")
            pair_id = m[m.index("pairs") + 1] if "pairs" in m else None
        if not pair_id:
            return json_response({"error": "Missing pairId"}, status_code=400)

        token   = request.query_params.get("token", "0")
        iv_str  = request.query_params.get("interval", "1h")
        iv_ms   = IV_LOOKUP_MS.get(iv_str, 3_600_000)  # default 1h

        if token not in ("0", "1"):
            return json_response({"error": 'token must be "0" or "1"'}, status_code=400)

        # ── current bucket window
        now_ms       = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
        bucket_start = (now_ms // iv_ms) * iv_ms
        since_iso    = datetime.utcfromtimestamp(bucket_start / 1000).isoformat() + "Z"
        until_iso    = datetime.utcfromtimestamp((bucket_start + iv_ms) / 1000).isoformat() + "Z"

        # ─────────────────────────────────────────────────────────
        # 1️⃣  Last Sync BEFORE bucket → seed open/flat candle
        # ─────────────────────────────────────────────────────────
        prev_sync_q = """
          query ($pair:String!,$before:Datetime!){
            allEvents(
              condition:{contract:"con_pairs",event:"Sync"},
              filter:{dataIndexed:{contains:{pair:$pair}},
                      created:{lessThan:$before}},
              orderBy:CREATED_DESC, first:1){
              edges{node{data}}
            }
          }"""
        prev_res  = await execute_graphql_query(prev_sync_q, {"pair": pair_id, "before": since_iso})
        prev_edges= prev_res.get("data",{}).get("allEvents",{}).get("edges",[])
        prev_close= price_from_sync(prev_edges[0]["node"]["data"]) if prev_edges else None

        # ─────────────────────────────────────────────────────────
        # 2️⃣  Sync events INSIDE bucket → price series
        # ─────────────────────────────────────────────────────────
        sync_q = """
          query ($pair:String!,$since:Datetime!,$until:Datetime!){
            allEvents(
              condition:{contract:"con_pairs",event:"Sync"},
              filter:{dataIndexed:{contains:{pair:$pair}},
                      created:{greaterThanOrEqualTo:$since,lessThan:$until}},
              orderBy:CREATED_ASC, first:1000){
              edges{node{created data}}
            }
          }"""
        sync_res = await execute_graphql_query(sync_q, {"pair": pair_id,
                                                        "since": since_iso,
                                                        "until": until_iso})
        sync_edges = sync_res.get("data",{}).get("allEvents",{}).get("edges",[])

        prices: list[float] = []
        if prev_close is not None:
            prices.append(prev_close)
        for e in sync_edges:
            p = price_from_sync(e["node"]["data"])
            if p is not None:
                prices.append(p)

        # ─────────────────────────────────────────────────────────
        # 3️⃣  Swap events INSIDE bucket → volume
        # ─────────────────────────────────────────────────────────
        swap_q = """
          query ($pair:String!,$since:Datetime!,$until:Datetime!){
            allEvents(
              condition:{contract:"con_pairs",event:"Swap"},
              filter:{dataIndexed:{contains:{pair:$pair}},
                      created:{greaterThanOrEqualTo:$since,lessThan:$until}},
              orderBy:CREATED_ASC, first:1000){
              edges{node{data}}
            }
          }"""
        swap_res = await execute_graphql_query(swap_q, {"pair":pair_id,
                                                        "since":since_iso,
                                                        "until":until_iso})
        swap_edges = swap_res.get("data",{}).get("allEvents",{}).get("edges",[])
        v0 = v1 = 0.0
        for e in swap_edges:
            d = e["node"]["data"]
            v0 += float(d.get("amount0In",0) or 0) + float(d.get("amount0Out",0) or 0)
            v1 += float(d.get("amount1In",0) or 0) + float(d.get("amount1Out",0) or 0)

        # ─────────────────────────────────────────────────────────
        # 4️⃣  Build candle
        # ─────────────────────────────────────────────────────────
        t_iso = datetime.utcfromtimestamp(bucket_start / 1000).isoformat() + "Z"
        if not prices:
            return json_response({"t": t_iso, "open": None, "high": None,
                                  "low": None, "close": None, "volume": 0})

        open_p  = prices[0]
        close_p = prices[-1]
        high_p  = max(prices)
        low_p   = min(prices)

        if token == "0":         # reciprocal view
            candle = {
                "t": t_iso,
                "open": 1 / open_p,
                "high": 1 / low_p,
                "low":  1 / high_p,
                "close":1 / close_p,
                "volume": v0,
            }
        else:                    # native view
            candle = {
                "t": t_iso,
                "open": open_p,
                "high": high_p,
                "low":  low_p,
                "close":close_p,
                "volume": v1,
            }

        return json_response(candle)

    except Exception as exc:
        logger.error("Error in get_latest_candle: %s", exc, exc_info=True)
        return json_response({"error": str(exc) or "Internal error"}, status_code=500)
