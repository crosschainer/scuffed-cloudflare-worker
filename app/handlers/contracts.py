"""
Handler for contracts endpoints
"""
import logging
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

async def get_all_contracts(request: Request):
    """
    Handler for GET /contracts?offset=…&limit=…
    
    Returns a paginated list of all contracts.
    """
    try:
        # Pagination params (limit hard-capped at 20)
        offset = max(0, int(request.query_params.get("offset", "0")))
        limit = min(
            20,
            max(1, int(request.query_params.get("limit", "10")))
        )
        
        # GraphQL query
        query = """
            query GetContracts($offset:Int!, $first:Int!) {
                allContracts(offset: $offset, first: $first, orderBy: CREATED_DESC) {
                    nodes      { name created }
                    totalCount
                }
            }
        """
        
        # Call the API
        result = await execute_graphql_query(query, {"offset": offset, "first": limit})
        
        # Check for errors
        errors = result.get('errors', [])
        if errors:
            raise ValueError(errors[0].get('message', 'Unknown GraphQL error'))
        
        # Extract data
        all_contracts = result.get('data', {}).get('allContracts', {})
        nodes = all_contracts.get('nodes', [])
        total_count = all_contracts.get('totalCount', 0)
        
        # Normalize + paginate
        contracts = [
            {
                "name": node.get('name'),
                "created_at": node.get('created')
            }
            for node in nodes
        ]
        
        next_offset = offset + limit if offset + limit < total_count else None
        previous = max(0, offset - limit) if offset > 0 else None
        
        return json_response(
            {
                "contracts": contracts,
                "pagination": {
                    "offset": offset,
                    "limit": limit,
                    "total": total_count,
                    "next": next_offset,
                    "previous": previous
                }
            },
            headers={"Cache-Control": "max-age=120"}
        )
    
    except Exception as err:
        logger.error(f"Error in get_all_contracts: {err}")
        return json_response(
            {"error": "Failed to fetch contracts", "message": str(err)},
            status_code=500
        )

async def get_contract_code(request: Request, contract_name: str = None):
    """
    Handler for GET /contracts/:contractName
    
    Returns the code for a specific contract.
    """
    try:
        # Basic validation
        if not contract_name or ":" in contract_name:
            return json_response(
                {"error": "Bad request", "message": "Invalid or missing contractName."},
                status_code=400
            )
        
        # GraphQL query (using a variable to stay injection-safe)
        query = """
            query GetContractCode($name:String!) {
                contractByName(name: $name) {
                    name code created
                }
            }
        """
        
        result = await execute_graphql_query(query, {"name": contract_name})
        
        # Check for errors
        errors = result.get('errors', [])
        if errors:
            raise ValueError(errors[0].get('message', 'Unknown GraphQL error'))
        
        # Extract contract data
        contract = result.get('data', {}).get('contractByName')
        if not contract:
            return json_response({"error": "Contract not found"}, status_code=404)
        
        # Success
        return json_response(
            {
                "name": contract.get('name'),
                "code": contract.get('code'),
                "created_at": contract.get('created')
            },
            headers={"Cache-Control": "max-age=120"}
        )
    
    except Exception as err:
        logger.error(f"Error in get_contract_code: {err}")
        return json_response(
            {"error": "Failed to fetch contract code", "message": str(err)},
            status_code=500
        )