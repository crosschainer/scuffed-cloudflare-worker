"""
Handler(s) for the /circulating-supply endpoint(s)

We expose two public routes:

1. ``GET /circulating-supply``      → JSON body with full stats (total, excluded, circulating).
2. ``GET /circulating-supply.txt``  → Plain-text **only** (numeric circulating supply) for crawlers/trackers.

Both routes share one calculation function so they always remain in sync.
"""

from __future__ import annotations

import json
from typing import List, Tuple

from fastapi import HTTPException, Request

from app.config.constants import EXCLUDED_KEYS, MAXIMUM_SUPPLY
from app.handlers.total_supply import total_supply_handler  # re-use existing logic
from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response, plain_text_response

__all__ = [
    "circulating_supply_handler",
    "circulating_supply_tracker_handler",
]


# ────────────────────────────────────────────────────────────────────────────
# Internal helper – compute everything once
# ────────────────────────────────────────────────────────────────────────────
async def _calculate_circulating_supply(
    request: Request,
) -> Tuple[float, float, float, List[dict]]:
    """Return (circulating, total, excluded_sum, excluded_addresses)."""

    # 1) Get total supply (we call the JSON route, not the .txt route)
    total_resp = await total_supply_handler(request)

    # Bubble up HTTPExceptions directly so FastAPI’s handler can deal with them
    if isinstance(total_resp, HTTPException):
        raise total_resp

    if not hasattr(total_resp, "status_code") or total_resp.status_code != 200:
        raise HTTPException(status_code=500, detail="total_supply_handler failed")

    # Parse JSONResponse body
    if hasattr(total_resp, "body"):
        body_bytes = total_resp.body if isinstance(total_resp.body, (bytes, bytearray)) else bytes()
        total_json = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
    else:
        total_json = {}

    total_supply = float(total_json.get("totalSupply", 0.0))

    # 2) Fetch balances that should be excluded from circulating supply
    excluded_keys_str = ", ".join(f'"{key}"' for key in EXCLUDED_KEYS)

    excluded_query = f"""
        query {{
            allStates(
                filter: {{ key: {{ in: [{excluded_keys_str}] }} }}
            ) {{
                edges {{ node {{ key value }} }}
            }}
        }}
    """

    excl_json = await execute_graphql_query(
        excluded_query,
        {},
        "Upstream GraphQL error on excluded-supply query",
    )

    edges = (
        excl_json.get("data", {})
        .get("allStates", {})
        .get("edges", [])
    )

    excluded_addresses: List[dict] = []
    excluded_sum = 0.0

    for edge in edges:
        node = edge.get("node", {})
        key: str | None = node.get("key")
        raw_val = node.get("value")
        numeric_val = float(raw_val) if raw_val is not None else 0.0

        if key is not None:
            excluded_addresses.append({"key": key, "value": numeric_val})
            excluded_sum += numeric_val

    circulating_supply = total_supply - excluded_sum
    return circulating_supply, total_supply, excluded_sum, excluded_addresses


# ────────────────────────────────────────────────────────────────────────────
# Public route handlers
# ────────────────────────────────────────────────────────────────────────────
async def circulating_supply_handler(request: Request):
    """GET /circulating-supply → JSON payload with all supply metrics."""
    try:
        (
            circulating_supply,
            total_supply,
            excluded_sum,
            excluded_addresses,
        ) = await _calculate_circulating_supply(request)

        burned_supply = MAXIMUM_SUPPLY - total_supply

        return json_response(
            {
                "maximumSupply": MAXIMUM_SUPPLY,
                "maximum_supply": MAXIMUM_SUPPLY,  # legacy keys
                "max_supply": MAXIMUM_SUPPLY,
                "burnedSupply": burned_supply,
                "burned_supply": burned_supply,  # legacy keys
                "totalSupply": total_supply,
                "total_supply": total_supply,  # legacy keys
                "circulatingSupply": circulating_supply,
                "circulating_supply": circulating_supply,  # legacy keys
                "excludedSupply": excluded_sum,
                "excludedAddresses": excluded_addresses,
            }
        )
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # noqa: BLE001
        return json_response({"error": str(exc) or "Internal error"}, 500)


async def circulating_supply_tracker_handler(request: Request):
    """GET /circulating-supply.txt → raw numeric circulating supply."""
    try:
        circulating_supply, *_ = await _calculate_circulating_supply(request)
        # Return *just* the number expected by external trackers / bots.
        return plain_text_response(f"{circulating_supply}")
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # noqa: BLE001
        # Trackers rarely care about JSON errors; a plain string is fine.
        return plain_text_response(str(exc) or "Internal error", status_code=500)
