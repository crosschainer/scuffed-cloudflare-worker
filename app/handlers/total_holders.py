"""
Handler for total holders endpoint
"""
import logging
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def total_holders_handler(request: Request):
    """
    Handler for GET /total-holders
    
    Returns the total number of holders across all tokens.
    """
    try:
        # GraphQL query to count all holders
        holders_query = """
            query {
                allStates(
                    filter: {
                        key: { startsWith: "currency.balances:", notLike: "%:%:%" }
                    }
                ) {
                    totalCount
                }
            }
        """
        
        # Execute query
        data = await execute_graphql_query(
            holders_query,
            {},
            "Upstream GraphQL error on total-holders query"
        )
        
        # Extract and parse total count
        total_count_raw = data.get('data', {}).get('allStates', {}).get('totalCount')
        total_holders = int(total_count_raw) if total_count_raw is not None else 0
        
        # Return response
        return json_response({"totalHolders": total_holders})
    
    except Exception as err:
        logger.error(f"Error in total_holders_handler: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )