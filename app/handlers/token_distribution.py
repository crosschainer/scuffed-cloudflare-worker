"""
Handler for token distribution endpoint
"""
import logging
from typing import Dict, Any, Optional, List
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

# Constants
CHUNK_SIZE = 1000  # Same as in the original implementation

async def get_token_distribution(request: Request, contract_name: str = None):
    """
    Handler for GET /tokens/<contract>/distribution
    
    Returns the distribution of token holdings across different holder groups.
    """
    try:
        # Extract contract_name from path if not provided
        if not contract_name:
            url_path = request.url.path
            match = url_path.match(r'^/tokens/([^/]+)/distribution$')
            if match:
                contract_name = match.group(1)
            else:
                return json_response({"error": "Missing contract name"}, status_code=400)
        
        # 1. Count non-zero balances
        count_query = f"""
            query Count {{
                allStates(
                    filter: {{
                        and: {{
                            key: {{ startsWith: "{contract_name}.balances:", notLike: "%:%:%" }}
                            valueNumeric: {{ greaterThan: "0" }}
                        }}
                    }}
                ) {{ totalCount }}
            }}
        """
        
        count_result = await execute_graphql_query(count_query)
        total_count = int(count_result.get('data', {}).get('allStates', {}).get('totalCount', 0))
        
        if not total_count:
            return json_response({
                "contractName": contract_name,
                "distribution": None,
                "totalSupply": 0
            })
        
        # 2. Iterate through balances in chunks
        chunk_query = f"""
            query Chunk($first:Int!,$offset:Int!){{
                allStates(
                    filter:{{
                        and:{{
                            key:{{startsWith:"{contract_name}.balances:",notLike:"%:%:%"}}
                            valueNumeric:{{greaterThan:"0"}}
                        }}
                    }}
                    orderBy: VALUE_NUMERIC_DESC
                    first: $first
                    offset:$offset
                ){{
                    edges{{ node{{ key value }} }}
                }}
            }}
        """
        
        offset = 0
        idx = 0
        total = 0
        bucket = {"top1": 0, "top10": 0, "top25": 0, "top100": 0}
        
        while offset < total_count:
            variables = {"first": CHUNK_SIZE, "offset": offset}
            result = await execute_graphql_query(chunk_query, variables)
            
            edges = result.get('data', {}).get('allStates', {}).get('edges', [])
            if not edges:
                break
            
            for edge in edges:
                node = edge.get('node', {})
                amount = float(node.get('value', 0) or 0)
                
                # Add to appropriate buckets
                idx += 1
                total += amount
                
                if idx == 1:
                    bucket["top1"] += amount
                if idx <= 10:
                    bucket["top10"] += amount
                if idx <= 25:
                    bucket["top25"] += amount
                if idx <= 100:
                    bucket["top100"] += amount
            
            if len(edges) < CHUNK_SIZE:
                break
                
            offset += CHUNK_SIZE
        
        # 3. Calculate percentages
        def pct(n):
            return (n / total) * 100 if total else 0
        
        distribution = {
            "top1": {
                "balance": bucket["top1"],
                "percent": pct(bucket["top1"])
            },
            "top10": {
                "balance": bucket["top10"],
                "percent": pct(bucket["top10"])
            },
            "top25": {
                "balance": bucket["top25"],
                "percent": pct(bucket["top25"])
            },
            "top100": {
                "balance": bucket["top100"],
                "percent": pct(bucket["top100"])
            },
            "others": {
                "balance": total - bucket["top100"],
                "percent": pct(total - bucket["top100"])
            }
        }
        
        return json_response({
            "contractName": contract_name,
            "totalSupply": total,
            "distribution": distribution
        })
    
    except Exception as err:
        logger.error(f"Error in get_token_distribution: {err}", exc_info=True)
        return json_response(
            {"error": "Failed to compute distribution", "message": str(err)},
            status_code=500
        )