"""
Handler for the /circulating-supply endpoint
"""
from fastapi import Request, HTTPException
from app.config.constants import EXCLUDED_KEYS
from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response
from app.handlers.total_supply import total_supply_handler


async def circulating_supply_handler(request: Request):
    """
    Handler for GET /circulating-supply
    
    1) Call total_supply_handler() to get { totalSupply }.
    2) Run a single GraphQL query to fetch all "excluded" keys & values.
    3) Sum parseFloat(value) of each returned node → excludedSum.
    4) circulatingSupply = totalSupply − excludedSum.
    5) Return JSON { totalSupply, excludedSupply: excludedSum, circulatingSupply, excludedAddresses }.
    """
    try:
        # 1) Get totalSupply
        total_resp = await total_supply_handler(request)
        if isinstance(total_resp, HTTPException) or (hasattr(total_resp, 'status_code') and total_resp.status_code != 200):
            # If total_supply_handler returned an error, forward it
            return total_resp
            
        # Parse the response body
        import json
        if hasattr(total_resp, 'body'):
            if isinstance(total_resp.body, bytes):
                total_json = json.loads(total_resp.body.decode('utf-8'))
            else:
                total_json = total_resp.body
        else:
            total_json = {}
            
        total_supply = float(total_json.get('totalSupply', 0)) if total_json else 0
        
        # 2) Fetch key & value for each excluded address
        excluded_keys_str = ", ".join([f'"{k}"' for k in EXCLUDED_KEYS])
        excluded_query = f"""
            query {{
                allStates(
                    filter: {{
                        key: {{ in: [{excluded_keys_str}] }}
                    }}
                ) {{
                    edges {{
                        node {{
                            key
                            value
                        }}
                    }}
                }}
            }}
        """
        
        excl_json = await execute_graphql_query(
            excluded_query, 
            {}, 
            "Upstream GraphQL error on excluded-supply query"
        )
        
        edges = excl_json.get('data', {}).get('allStates', {}).get('edges', [])
        
        # 3) Build an array of { key, value } and sum numeric values
        excluded_addresses = []
        excluded_sum = 0
        for edge in edges:
            node = edge.get('node', {})
            key = node.get('key')
            raw_val = node.get('value')
            numeric_val = float(raw_val) if raw_val is not None else 0
            
            if key is not None:
                excluded_addresses.append({"key": key, "value": numeric_val})
                excluded_sum += numeric_val
        
        circulating_supply = total_supply - excluded_sum
        maximum_supply = 111111111  # Assuming 111111111 is the total supply of the token
        burned_supply = maximum_supply - total_supply
        
        return json_response({
            "maximumSupply": maximum_supply,
            "maximum_supply": maximum_supply,  # For backward compatibility
            "max_supply": maximum_supply,  # For backward compatibility
            "burnedSupply": burned_supply,
            "burned_supply": burned_supply,  # For backward compatibility
            "totalSupply": total_supply,
            "total_supply": total_supply,  # For backward compatibility
            "circulatingSupply": circulating_supply,
            "circulating_supply": circulating_supply,  # For backward compatibility
            "excludedSupply": excluded_sum,
            "excludedAddresses": excluded_addresses,
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