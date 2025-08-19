"""
Handler for pair price-change endpoint
"""
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, getcontext, InvalidOperation
from typing import Dict, Any, Optional
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)
getcontext().prec = 28                     # 18-dec math

# ─────────────────────────── helpers ───────────────────────────
def price_from_sync(d: Dict[str, Any]) -> Optional[float]:
    """Mid-price of token0 in token1 units (reserve1 / reserve0)."""
    try:
        r0 = Decimal(d["reserve0"])
        r1 = Decimal(d["reserve1"])
        return float(r1 / r0) if r0 != 0 else None
    except (KeyError, InvalidOperation):
        return None
# ───────────────────────────────────────────────────────────────

async def get_pair_price_change(request: Request, pair_id: str | None = None):
    """
    GET /pairs/<pairId>/pricechange24h
    Returns the % change of mid-price over the last 24 h.
    """
    try:
        # ── pair id
        if pair_id is None:
            pair_id = request.query_params.get("pair")
        if not pair_id:
            return json_response({"error": 'Missing "pair" query parameter'},
                                 status_code=400)

        # ── token param
        token = request.query_params.get("token", "0")
        if token not in ("0", "1"):
            return json_response({"error": 'token must be "0" or "1"'}, status_code=400)

        # ── timestamp 24 h ago (UTC)
        since_iso = (datetime.now(tz=timezone.utc) - timedelta(days=1)).isoformat()

        # ── GraphQL query (Sync-based)
        gql = """
          query ($pair:String!,$since:Datetime!){
            latest: allEvents(
              first:1 orderBy:CREATED_DESC
              condition:{contract:"con_pairs",event:"Sync"}
              filter:{dataIndexed:{contains:{pair:$pair}}}
            ){ edges{node{data}} }

            baseline: allEvents(
              first:1 orderBy:CREATED_DESC
              condition:{contract:"con_pairs",event:"Sync"}
              filter:{
                dataIndexed:{contains:{pair:$pair}},
                created:{lessThanOrEqualTo:$since}
              }
            ){ edges{node{data}} }
          }"""

        resp = await execute_graphql_query(gql, {"pair": pair_id, "since": since_iso})

        def extract(which: str) -> Optional[float]:
            edges = resp.get("data", {}).get(which, {}).get("edges", [])
            if edges:
                return price_from_sync(edges[0]["node"]["data"])
            return None

        price_now      = extract("latest")
        price_24h_ago  = extract("baseline")

        if price_now is None or price_24h_ago is None:
            return json_response({
                "pairId": pair_id,
                "token": token,
                "priceNow": price_now,
                "price24hAgo": price_24h_ago,
                "changePct": None,
                "error": "Not enough data"
            })

        # ── apply caller’s perspective
        if token == "0":
            price_now, price_24h_ago = 1 / price_now, 1 / price_24h_ago

        change_pct = ((price_now - price_24h_ago) / price_24h_ago) * 100 if price_24h_ago else None

        return json_response({
            "pairId": pair_id,
            "token": token,
            "priceNow": price_now,
            "price24hAgo": price_24h_ago,
            "changePct": change_pct
        })

    except Exception as exc:
        logger.error("Error in get_pair_price_change: %s", exc, exc_info=True)
        return json_response({"error": str(exc) or "Internal error"}, status_code=500)
