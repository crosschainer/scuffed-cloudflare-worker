"""
Handler for the /total-supply endpoint
"""
from fastapi import Request, HTTPException
from app.config.constants import CHUNK_SIZE, MAXIMUM_SUPPLY
from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response


async def total_supply_handler(request: Request):
    """
    Handler for GET /total-supply
    
    1) Run a GraphQL "count" query to find totalCount of nonzero balances.
    2) If totalCount === 0, immediately return { totalSupply: 0 }.
    3) Otherwise, loop in chunks of CHUNK_SIZE, fetching `edges { node { value } }`,
       summing parseFloat(value) each time.
    4) Return JSON { totalSupply: <number> }.
    """
    # 1a) Count all nonzero balances
    count_query = """
        query {
            allStates(
                filter: {
                    and: {
                        key: { startsWith: "currency.balances:", notLike: "%:%:%" }
                        valueNumeric: { greaterThan: "0" }
                    }
                }
            ) {
                totalCount
            }
        }
    """
    
    try:
        count_json = await execute_graphql_query(
            count_query, 
            {}, 
            "Upstream GraphQL error on count"
        )
        
        total_count_raw = count_json.get('data', {}).get('allStates', {}).get('totalCount')
        total_count = int(total_count_raw) if total_count_raw is not None else 0
        
        # 2) If zero nonzero balances:
        if total_count == 0:
            return json_response({
                "burnedSupply": MAXIMUM_SUPPLY, 
                "maximumSupply": MAXIMUM_SUPPLY, 
                "totalSupply": 0
            })
        
        # 3) Otherwise, fetch in chunks of CHUNK_SIZE
        offset = 0
        running_sum = 0
        
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
                    edges {
                        node {
                            value
                        }
                    }
                }
            }
        """
        
        while offset < total_count:
            variables = {"first": CHUNK_SIZE, "offset": offset}
            chunk_json = await execute_graphql_query(
                chunk_query, 
                variables, 
                "Upstream GraphQL error on chunk fetch"
            )
            
            edges = chunk_json.get('data', {}).get('allStates', {}).get('edges', [])
            
            for edge in edges:
                raw_val = edge.get('node', {}).get('value')
                if raw_val is not None:
                    running_sum += float(raw_val) if raw_val else 0
            
            if len(edges) < CHUNK_SIZE:
                # Fewer than CHUNK_SIZE items → we're done
                break
                
            offset += CHUNK_SIZE
        
        return json_response({
            "burnedSupply": (MAXIMUM_SUPPLY - running_sum),
            "burned_supply": (MAXIMUM_SUPPLY - running_sum),  # For backward compatibility
            "maximumSupply": MAXIMUM_SUPPLY,
            "maximum_supply": MAXIMUM_SUPPLY,  # For backward compatibility
            "totalSupply": running_sum,
            "total_supply": running_sum  # For backward compatibility
        })
    except Exception as error:
        # If error is already an HTTPException, re-raise it
        if isinstance(error, HTTPException):
            raise error
            
        # Otherwise, create a new error response
        return json_response(
            {"error": str(error) or "Internal error"},
            status_code=500
        )