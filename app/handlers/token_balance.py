"""
Handler for token balance endpoint
"""
import json
import base64
import logging
from fastapi import Request, HTTPException
import httpx

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

# RPC node that understands the simulate-tx endpoint
RPC = "https://node.xian.org"

logger = logging.getLogger(__name__)

# Helper functions
def to_hex(bytes_data):
    """Convert bytes to hex string"""
    return ''.join([f"{b:02x}" for b in bytes_data])

def b64_decode(s):
    """Decode base64 string to bytes"""
    return base64.b64decode(s).decode('utf-8', errors='ignore')

async def get_token_balance(request: Request, contract_name: str, address: str):
    """
    GET /token/:contractName/balance/:address
    
    Args:
        request: The incoming request
        contract_name: The token contract name
        address: The wallet address
        
    Returns:
        JSON response with balance data
    """
    try:
        # 1 — basic validation
        if not contract_name or not address:
            return json_response(
                {"error": "contractName and address required"},
                status_code=400
            )
        
        if ":" in contract_name or ":" in address:
            return json_response(
                {"error": "Illegal ':' in parameters"},
                status_code=400
            )
        
        # 2 — try balance_of via simulate_tx
        balance = await try_balance_of(contract_name, address)
        
        # 3 — fallback to state key if simulate failed
        if balance is None:
            balance = await fallback_state_key(contract_name, address)
        
        # 4 — normalize & return
        return json_response({
            "contractName": contract_name,
            "address": address,
            "balance": balance if balance is not None else 0
        })
    except Exception as error:
        logger.error(f"get_token_balance error: {error}")
        return json_response(
            {"error": "Failed to fetch balance", "message": str(error)},
            status_code=500
        )

async def try_balance_of(contract, addr):
    """
    Call contract.balance_of(address) through /simulate_tx.
    Returns a float number, or None if the call is unsupported / empty.
    """
    try:
        payload = {
            "sender": addr,            # any valid sender works for simulate
            "contract": contract,
            "function": "balance_of",
            "kwargs": {"address": addr}
        }
        
        payload_bytes = json.dumps(payload).encode('utf-8')
        hex_payload = to_hex(payload_bytes)
        url = f"{RPC}/abci_query?path=\"/simulate_tx/{hex_payload}\""
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            result = response.json().get('result', {})
            
        raw = result.get('response', {}).get('value')
        if not raw:
            return None  # nothing returned
        
        decoded = b64_decode(raw)
        if not decoded or decoded == "\x9Eée" or decoded == "AA==":
            return None
        
        # simulate_tx wraps result inside {"result": "..."}
        parsed_json = json.loads(decoded)
        parsed = parsed_json.get('result')
        
        return float(parsed) if parsed is not None else None
    except Exception as e:
        logger.error(f"try_balance_of error: {e}")
        return None  # network / parse error

async def fallback_state_key(contract, addr):
    """
    Legacy path: read <contract>.balances:<address> from state table
    """
    state_key = f"{contract}.balances:{addr}"
    
    query = f"""
        query Balance {{
            allStates(filter:{{ key:{{ equalTo:"{state_key}" }} }} first:1){{
                edges{{ node{{ value }} }}
            }}
        }}
    """
    
    try:
        gql = await execute_graphql_query(query)
        edges = gql.get('data', {}).get('allStates', {}).get('edges', [])
        edge = edges[0] if edges else None
        value = edge.get('node', {}).get('value') if edge else None
        
        return float(value) if value is not None else 0
    except Exception as e:
        logger.error(f"fallback_state_key error: {e}")
        return 0