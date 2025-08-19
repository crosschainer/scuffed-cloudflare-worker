"""
Handler(s) for the total-supply endpoints
"""
from fastapi import Request, HTTPException
from app.config.constants import CHUNK_SIZE, MAXIMUM_SUPPLY
from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response, plain_text_response


# ────────────────────────────────────────────────────────────────────────────
# Internal helper ─ calculate total supply once and reuse it in both routes
# ────────────────────────────────────────────────────────────────────────────
async def _calculate_total_supply() -> float:
    """
    Hit the GraphQL API, page through balances, and return the live totalSupply
    as a float.

    Raises:
        HTTPException – if an upstream GraphQL call fails.
    """
    # 1) Count all non-zero balances first
    count_query = """
        query {
            allStates(
                filter: {
                    and: {
                        key: { startsWith: "currency.balances:", notLike: "%:%:%" }
                        valueNumeric: { greaterThan: "0" }
                    }
                }
            ) { totalCount }
        }
    """

    count_json = await execute_graphql_query(
        count_query,
        {},
        "Upstream GraphQL error on count",
    )
    total_count_raw = (
        count_json.get("data", {}).get("allStates", {}).get("totalCount")
    )
    total_count = int(total_count_raw or 0)

    # 2) If there are no non-zero balances, supply is 0
    if total_count == 0:
        return 0.0

    # 3) Page through the balances in CHUNK_SIZE slices
    chunk_query = """
        query FetchChunk($first: Int!, $offset: Int!) {
            allStates(
                filter: {
                    and: {
                        key: { startsWith: "currency.balances:", notLike: "%:%:%" }
                        valueNumeric: { greaterThan: "0" }
                    }
                }
                orderBy: VALUE_DESC
                first: $first
                offset: $offset
            ) {
                edges { node { value } }
            }
        }
    """

    offset = 0
    running_sum = 0.0

    while offset < total_count:
        variables = {"first": CHUNK_SIZE, "offset": offset}
        chunk_json = await execute_graphql_query(
            chunk_query,
            variables,
            "Upstream GraphQL error on chunk fetch",
        )

        edges = (
            chunk_json.get("data", {})
            .get("allStates", {})
            .get("edges", [])
        )

        for edge in edges:
            raw_val = edge.get("node", {}).get("value")
            running_sum += float(raw_val or 0)

        if len(edges) < CHUNK_SIZE:  # reached the last page
            break

        offset += CHUNK_SIZE

    return running_sum


# ────────────────────────────────────────────────────────────────────────────
# Public route handlers
# ────────────────────────────────────────────────────────────────────────────
async def total_supply_handler(request: Request):
    """
    GET /total-supply  →  JSON body with burnedSupply, maximumSupply, totalSupply
    """
    try:
        total_supply = await _calculate_total_supply()

        return json_response(
            {
                "burnedSupply": MAXIMUM_SUPPLY - total_supply,
                "burned_supply": MAXIMUM_SUPPLY - total_supply,  # legacy key
                "maximumSupply": MAXIMUM_SUPPLY,
                "maximum_supply": MAXIMUM_SUPPLY,  # legacy key
                "totalSupply": total_supply,
                "total_supply": total_supply,  # legacy key
            }
        )
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # noqa: BLE001
        return json_response({"error": str(exc) or "Internal error"}, 500)


async def total_supply_tracker_handler(request: Request):
    """
    GET /total-supply.txt  →  plain text containing **only** the numeric supply

    Many listing bots and portfolio trackers (e.g., LiveCoinWatch, CoinMarketCap
    Lighthouse, CG “Simple Price”) prefer a raw number with no JSON envelope.
    """
    try:
        total_supply = await _calculate_total_supply()
        # Coingecko et al. generally expect a newline at the end, but it's safe
        # either way. Feel free to add `\\n` if a given service requires it.
        return plain_text_response(f"{total_supply}")
    except HTTPException as exc:
        raise exc
    except Exception as exc:  # noqa: BLE001
        return plain_text_response(str(exc) or "Internal error", status_code=500)
