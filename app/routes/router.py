"""
FastAPI router for all endpoints
"""
import re
from typing import Dict, Any, Callable, Optional
from fastapi import APIRouter, Request, Depends, HTTPException, Path
from fastapi.responses import JSONResponse

from app.config.constants import TTL_5S, TTL_10M, TTL_1H, TTL_30_D
from app.middleware.cache import with_edge_cache
from app.utils.response import json_response
from app.utils.websocket import websocket_with_shared_cache_refresh
from app.middleware.cache import generate_cache_key
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.handlers.latest_candle import get_latest_candle
from app.handlers.pair_volume import get_pair_volume
from app.handlers.pair_price_change import get_pair_price_change
from app.handlers.pair_trades import get_pair_trades
from app.handlers.pair_reserves import get_pair_reserves
from app.handlers.pairs import get_pairs

# Import handlers
from app.handlers.tokens import get_all_tokens, get_token_by_name
from app.handlers.batch import batch_handler

# Create router
router = APIRouter()

# Define individual route handlers explicitly

@router.get("/", summary="API Root", description="Returns API information and links to documentation")
@with_edge_cache(TTL_1H)
async def root(request: Request):
    return json_response({
        "message": "Scuffed API - FastAPI Replica of Cloudflare Worker",
        "documentation": {
            "swagger": f"{request.url.scheme}://{request.url.netloc}/docs",
            "redoc": f"{request.url.scheme}://{request.url.netloc}/redoc"
        },
        "version": "1.0.0"
    })

@router.get("/total-supply", summary="Total Supply", description="Returns the total supply of the token")
@with_edge_cache(TTL_5S)
async def total_supply(request: Request):
    from app.handlers.total_supply import total_supply_handler
    return await total_supply_handler(request)

@router.get("/circulating-supply", summary="Circulating Supply", description="Returns the circulating supply of the token")
@with_edge_cache(TTL_5S)
async def circulating_supply(request: Request):
    from app.handlers.circulating_supply import circulating_supply_handler
    return await circulating_supply_handler(request)

@router.get("/total-holders")
@with_edge_cache(TTL_1H)
async def total_holders(request: Request):
    from app.handlers.total_holders import total_holders_handler
    return await total_holders_handler(request)

@router.get("/pairs")
@with_edge_cache(TTL_5S)
async def pairs(request: Request):
    from app.handlers.pairs import get_pairs
    return await get_pairs(request)

@router.get("/tokens")
@with_edge_cache(TTL_10M)
async def tokens(request: Request):
    return await get_all_tokens(request)

@router.get("/contracts")
@with_edge_cache(TTL_10M)
async def contracts(request: Request):
    from app.handlers.contracts import get_all_contracts
    return await get_all_contracts(request)

@router.get("/transactions")
@with_edge_cache(TTL_5S)
async def transactions(request: Request):
    from app.handlers.transactions import transactions_handler
    return await transactions_handler(request)

# Register dynamic routes

# /batch (POST)
@router.post("/batch", summary="Batch Processing", description="Process multiple API requests in a single call")
@with_edge_cache(TTL_5S)
async def batch_route(request: Request):
    return await batch_handler(request)

# /token/<contract>/balance/<address>
@router.get("/token/{contract_name}/balance/{address}", 
           summary="Token Balance", 
           description="Get token balance for a specific address",
           response_description="Returns the token balance for the specified address")
@with_edge_cache(0)  # no cache for balances
async def token_balance(
    request: Request,
    contract_name: str = Path(..., description="Contract name of the token"),
    address: str = Path(..., description="Address to check balance for")
):
    from app.handlers.token_balance import get_token_balance
    return await get_token_balance(request, contract_name, address)

# /tokens/<contract>/holders
@router.get("/tokens/{contract_name}/holders")
@with_edge_cache(TTL_5S)
async def token_holders(request: Request, contract_name: str = Path(...)):
    from app.handlers.token_holders import get_token_holders
    return await get_token_holders(request, contract_name)

# /tokens/<contract>
@router.get("/tokens/{contract_name}")
@with_edge_cache(TTL_1H)
async def token_by_name(request: Request, contract_name: str = Path(...)):
    return await get_token_by_name(request, contract_name)

# /contracts/<contract>
@router.get("/contracts/{contract_name}")
@with_edge_cache(TTL_30_D)
async def contract_code(request: Request, contract_name: str = Path(...)):
    from app.handlers.contracts import get_contract_code
    return await get_contract_code(request, contract_name)

# /transactions/sender/<sender>
@router.get("/transactions/sender/{sender}")
@with_edge_cache(TTL_5S)
async def transactions_by_sender(request: Request, sender: str = Path(...)):
    from app.handlers.transactions import get_transactions_by_sender
    return await get_transactions_by_sender(request, sender)

# /transactions/<hash>
@router.get("/transactions/{tx_hash}")
@with_edge_cache(TTL_30_D)
async def transaction_by_hash(request: Request, tx_hash: str = Path(...)):
    from app.handlers.transactions import get_transaction_by_hash
    return await get_transaction_by_hash(request, tx_hash)

# /pairs/<id>/volume24h
@router.get("/pairs/{pair_id}/volume24h")
@with_edge_cache(TTL_5S)
async def pair_volume(request: Request, pair_id: str = Path(...)):
    from app.handlers.pair_volume import get_pair_volume
    return await get_pair_volume(request, pair_id)

# /pairs/<id>/pricechange24h
@router.get("/pairs/{pair_id}/pricechange24h")
@with_edge_cache(TTL_5S)
async def pair_price_change(request: Request, pair_id: str = Path(...)):
    from app.handlers.pair_price_change import get_pair_price_change
    return await get_pair_price_change(request, pair_id)

# /pairs/<id>/reserves
@router.get("/pairs/{pair_id}/reserves")
@with_edge_cache(TTL_5S)
async def pair_reserves(request: Request, pair_id: str = Path(...)):
    from app.handlers.pair_reserves import get_pair_reserves
    return await get_pair_reserves(request, pair_id)

# /pairs/<id>/trades
@router.get("/pairs/{pair_id}/trades")
@with_edge_cache(TTL_5S)
async def pair_trades(request: Request, pair_id: str = Path(...)):
    from app.handlers.pair_trades import get_pair_trades
    return await get_pair_trades(request, pair_id)

# /pairs/<id>
@router.get("/pairs/{pair_id}")
@with_edge_cache(TTL_30_D)
async def pair_by_id(request: Request, pair_id: str = Path(...)):
    from app.handlers.get_pair_by_id import get_pair_by_id
    return await get_pair_by_id(request, pair_id)

# /tokens/<contract>/distribution
@router.get("/tokens/{contract_name}/distribution")
@with_edge_cache(30)
async def token_distribution(request: Request, contract_name: str = Path(...)):
    from app.handlers.token_distribution import get_token_distribution
    return await get_token_distribution(request, contract_name)

# /pairs/<id>/candles
@router.get("/pairs/{pair_id}/candles")
@with_edge_cache(TTL_5S)
async def pair_candles(request: Request, pair_id: str = Path(...)):
    from app.handlers.pair_candles import get_pair_candles
    return await get_pair_candles(request, pair_id)

# /pairs/with/<tokenContract>
@router.get("/pairs/with/{token_contract}")
@with_edge_cache(TTL_10M)
async def pairs_by_token(request: Request, token_contract: str = Path(...)):
    from app.handlers.pairs_by_token import get_pairs_by_token
    return await get_pairs_by_token(request, token_contract)

# /ws/pairs/{pair_id}/candles
@router.websocket("/ws/pairs/{pair_id}/candles")
async def ws_candles(ws: WebSocket, pair_id: str):
    token = ws.query_params.get("token", default="1")
    interval = ws.query_params.get("interval", default="5h")
    await websocket_with_shared_cache_refresh(
        cache_key_fn=lambda w: generate_cache_key(w),
        handler_fn=lambda w: get_latest_candle(w, pair_id),
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)

# /ws/pairs/{pair_id}/volume24h
@router.websocket("/ws/pairs/{pair_id}/volume24h")
async def ws_volume(ws: WebSocket, pair_id: str):
    token = ws.query_params.get("token", default="1")
    await websocket_with_shared_cache_refresh(
        cache_key_fn=lambda w: generate_cache_key(w),
        handler_fn=lambda w: get_pair_volume(w, pair_id),  # pass it through
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)

# /ws/pairs/{pair_id}/pricechange24h
@router.websocket("/ws/pairs/{pair_id}/pricechange24h")
async def ws_price_change(ws: WebSocket, pair_id: str):
    await websocket_with_shared_cache_refresh(
        cache_key_fn=lambda w: generate_cache_key(w),
        handler_fn=lambda w: get_pair_price_change(w, pair_id),  # pass it through
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)

# /ws/pairs/{pair_id}/trades
@router.websocket("/ws/pairs/{pair_id}/trades")
async def ws_trades(ws: WebSocket, pair_id: str):
    await websocket_with_shared_cache_refresh(
      cache_key_fn=lambda w: generate_cache_key(w),
      handler_fn=lambda w: get_pair_trades(w, pair_id),  # pass it through
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)

# /ws/pairs/{pair_id}/reserves
@router.websocket("/ws/pairs/{pair_id}/reserves")
async def ws_reserves(ws: WebSocket, pair_id: str):
    await websocket_with_shared_cache_refresh(
        cache_key_fn=lambda w: generate_cache_key(w),
        handler_fn=lambda w: get_pair_reserves(w, pair_id),
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)

# /ws/pairs (all pairs stream)
@router.websocket("/ws/pairs")
async def ws_pairs(ws: WebSocket):
    await websocket_with_shared_cache_refresh(
        cache_key_fn=lambda w: generate_cache_key(w),
        handler_fn=lambda w: get_pairs(w),
        ttl=TTL_5S,
        interval=TTL_5S * 1000,
    )(ws)


# Method to handle path requests for batch processing
async def handle_path_request(request: Request, path: str):
    """
    Handle a request for a specific path
    Used by the batch handler
    """
    # Check static routes
    if path in STATIC_ROUTES:
        handler = STATIC_ROUTES[path]["handler"]
        return await handler(request)
    
    # Check dynamic routes
    # This is a simplified version - in a real implementation,
    # you would need to match the path against all registered routes
    
    # Example: /tokens/{contract_name}
    token_match = re.match(r"^/tokens/([^/]+)$", path)
    if token_match:
        contract_name = token_match.group(1)
        return await get_token_by_name(request, contract_name)
    
    # Add more route matching as needed
    
    # If no route matches, return 404
    return json_response({"error": "Route not found"}, status_code=404)