"""
Handler for transactions endpoints
"""
import logging
from typing import Dict, Any, Optional, List
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

def map_tx(node: Dict[str, Any]) -> Dict[str, Any]:
    """
    Map transaction node to a standardized format
    """
    return {
        "block_time": node.get("blockTime"),
        "block_height": node.get("blockHeight"),
        "hash": node.get("hash"),
        "contract": node.get("contract"),
        "function": node.get("function"),
        "stamps": node.get("stamps"),
        "result": node.get("result"),
        "success": node.get("success"),
        "sender": node.get("sender"),
        "created": node.get("created"),
        "nonce": node.get("nonce"),
        "jsonContent": node.get("jsonContent"),
    }

def paginated(tx_list: List[Dict[str, Any]], offset: int, limit: int, total: int) -> Dict[str, Any]:
    """
    Create a paginated response
    """
    next_offset = offset + limit if offset + limit < total else None
    previous = max(0, offset - limit) if offset > 0 else None
    
    return {
        "transactions": tx_list,
        "pagination": {
            "offset": offset,
            "limit": limit,
            "total": total,
            "next": next_offset,
            "previous": previous
        }
    }

async def transactions_handler(request: Request):
    """
    Handler for GET /transactions
    
    Returns a paginated list of all transactions.
    """
    try:
        # Get query parameters
        offset = max(0, int(request.query_params.get("offset", "0")))
        limit = min(50, max(1, int(request.query_params.get("limit", "25"))))
        
        # GraphQL query
        query = """
            query AllTxs($offset:Int!, $limit:Int!) {
                allTransactions(first:$limit, offset:$offset, orderBy:BLOCK_HEIGHT_DESC) {
                    edges { 
                        node { 
                            blockTime blockHeight hash contract function stamps
                            result success sender created nonce jsonContent 
                        } 
                    }
                    totalCount
                }
            }
        """
        
        # Execute query
        result = await execute_graphql_query(
            query, 
            {"offset": offset, "limit": limit},
            "Upstream GraphQL error on transactions query"
        )
        
        # Extract data
        edges = result.get('data', {}).get('allTransactions', {}).get('edges', [])
        total_count = result.get('data', {}).get('allTransactions', {}).get('totalCount', 0)
        
        # Map transactions
        transactions = [map_tx(edge.get('node', {})) for edge in edges]
        
        # Return paginated response
        return json_response(paginated(transactions, offset, limit, total_count))
    
    except Exception as err:
        logger.error(f"Error in transactions_handler: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )

async def get_transactions_by_sender(request: Request, sender: str = None):
    """
    Handler for GET /transactions/sender/:sender
    
    Returns a paginated list of transactions from a specific sender.
    """
    try:
        # Extract sender from path if not provided
        if not sender:
            url_path = request.url.path
            match = url_path.match(r'^/transactions/sender/(.+)$')
            if match:
                sender = match.group(1)
            else:
                return json_response({"error": "Missing sender"}, status_code=400)
        
        # Get query parameters
        offset = max(0, int(request.query_params.get("offset", "0")))
        limit = min(50, max(1, int(request.query_params.get("limit", "25"))))
        
        # GraphQL query
        query = """
            query TxsBySender($sender:String!, $offset:Int!, $limit:Int!) {
                allTransactions(
                    filter: { sender: { equalTo: $sender } }
                    first: $limit
                    offset: $offset
                    orderBy: BLOCK_HEIGHT_DESC
                ) {
                    edges { 
                        node { 
                            blockTime blockHeight hash contract function stamps
                            result success sender created nonce jsonContent 
                        } 
                    }
                    totalCount
                }
            }
        """
        
        # Execute query
        result = await execute_graphql_query(
            query, 
            {"sender": sender, "offset": offset, "limit": limit},
            "Upstream GraphQL error on tx-by-sender query"
        )
        
        # Extract data
        edges = result.get('data', {}).get('allTransactions', {}).get('edges', [])
        total_count = result.get('data', {}).get('allTransactions', {}).get('totalCount', 0)
        
        # Map transactions
        transactions = [map_tx(edge.get('node', {})) for edge in edges]
        
        # Return paginated response
        return json_response(paginated(transactions, offset, limit, total_count))
    
    except Exception as err:
        logger.error(f"Error in get_transactions_by_sender: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )

async def get_transaction_by_hash(request: Request, hash: str = None):
    """
    Handler for GET /transactions/:hash
    
    Returns a single transaction by its hash.
    """
    try:
        # Extract hash from path if not provided
        if not hash:
            url_path = request.url.path
            match = url_path.match(r'^/transactions/([^/]+)$')
            if match:
                hash = match.group(1)
            else:
                return json_response(
                    {"error": "Bad request", "message": "Missing hash."},
                    status_code=400
                )
        
        # GraphQL query
        query = """
            query TxByHash($hash:String!) {
                transactionByHash(hash:$hash) {
                    blockTime blockHeight hash contract function stamps
                    result success sender created nonce jsonContent
                }
            }
        """
        
        # Execute query
        result = await execute_graphql_query(
            query, 
            {"hash": hash},
            "Upstream GraphQL error on tx-by-hash query"
        )
        
        # Extract transaction
        tx = result.get('data', {}).get('transactionByHash')
        if not tx:
            return json_response({"error": "Transaction not found"}, status_code=404)
        
        # Return transaction
        return json_response(map_tx(tx))
    
    except Exception as err:
        logger.error(f"Error in get_transaction_by_hash: {err}", exc_info=True)
        return json_response(
            {"error": str(err) or "Internal error"},
            status_code=500
        )