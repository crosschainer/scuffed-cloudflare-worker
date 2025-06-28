"""
Cache middleware for FastAPI
"""
import time
import json
import hashlib
from typing import Any, Callable, Dict, Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from starlette.responses import StreamingResponse
import asyncio
# Simple in-memory cache
cache_store = {}
inflight = {}  # URL → Future

# Default TTL
DEFAULT_TTL = 5  # seconds

# CORS headers
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
}

async def cache_sweeper(interval: int = 60):
    """
    Every <interval> seconds remove all entries whose TTL has expired.
    """
    while True:
        now = time.time()
        # Avoid RuntimeError: dict changed size during iteration
        for key in [k for k, v in cache_store.items() if v["expires"] <= now]:
            cache_store.pop(key, None)
        await asyncio.sleep(interval)
        
def canonical(url: str) -> str:
    """
    Create a canonical URL by sorting query parameters
    """
    from urllib.parse import urlparse, parse_qsl, urlencode
    
    parsed = urlparse(url)
    query_params = parse_qsl(parsed.query)
    sorted_query = urlencode(sorted(query_params))
    
    # Rebuild the URL with sorted query parameters
    parts = list(parsed)
    parts[4] = sorted_query
    return urlparse("").geturl().join(parts)


def generate_cache_key(request: Request) -> str:
    """
    Generate a cache key from a request
    """
    return canonical(str(request.url))


async def read_edge_cache(request: Request) -> Optional[Dict[str, Any]]:
    """
    Read from cache manually (used by SSE)
    """
    cache_key = generate_cache_key(request)
    if cache_key in cache_store:
        entry = cache_store[cache_key]
        if entry["expires"] > time.time():
            return entry["data"]
    return None


async def write_edge_cache(request: Request, data: Any, ttl: int = DEFAULT_TTL) -> None:
    """
    Write to cache manually (used by SSE)
    """
    cache_key = generate_cache_key(request)
    cache_store[cache_key] = {
        "data": data,
        "expires": time.time() + ttl,
    }


class EdgeCacheMiddleware(BaseHTTPMiddleware):
    """
    Middleware for edge caching responses
    """
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 0) If this is a WS handshake, let it through:
        if request.scope["type"] == "websocket":
            return await call_next(request)

        # 1) CORS preflight
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=CORS_HEADERS)

        # 2) Only cache GET
        if request.method != "GET":
            return await call_next(request)
            
        # Handle CORS preflight
        if request.method == "OPTIONS":
            return Response(
                content=None,
                status_code=204,
                headers=CORS_HEADERS
            )
            
        # For GET requests, check cache
        cache_key = generate_cache_key(request)
        
        # 1) Check cache
        if cache_key in cache_store:
            entry = cache_store[cache_key]
            if entry["expires"] > time.time():
                # Cache hit
                response_data = entry["data"]
                return Response(
                    content=json.dumps(response_data),
                    media_type="application/json",
                    headers=CORS_HEADERS
                )
                
        # 2) Check if request is already in flight
        if cache_key in inflight:
            # Wait for the in-flight request to complete
            response = await inflight[cache_key]
            return response
            
        # 3) Execute the request
        try:
            # Mark request as in-flight
            inflight[cache_key] = call_next(request)
            response = await inflight[cache_key]
            
            # Skip caching for streaming responses
            if isinstance(response, StreamingResponse):
                # Just add CORS headers
                for header, value in CORS_HEADERS.items():
                    response.headers[header] = value
                return response
            
            # Cache successful responses
            if response.status_code == 200:
                # Try to parse the response body
                try:
                    body = await response.body()
                    data = json.loads(body)
                    
                    # Store in cache
                    ttl = getattr(request.state, "cache_ttl", DEFAULT_TTL)
                    cache_store[cache_key] = {
                        "data": data,
                        "expires": time.time() + ttl,
                    }
                    
                    # Add cache headers
                    headers = dict(response.headers)
                    headers.update(CORS_HEADERS)
                    headers["Cache-Control"] = f"public, max-age={ttl}, stale-while-revalidate={ttl}, stale-if-error={ttl}"
                    
                    # Return a new response with the headers
                    return Response(
                        content=body,
                        status_code=response.status_code,
                        headers=headers,
                        media_type=response.media_type
                    )
                except (json.JSONDecodeError, AttributeError):
                    # Not JSON or not a regular response, just return as is with CORS headers
                    for header, value in CORS_HEADERS.items():
                        response.headers[header] = value
                    return response
                    
            # Add CORS headers to non-200 responses
            for header, value in CORS_HEADERS.items():
                response.headers[header] = value
            response.headers["Cache-Control"] = "no-store"
            
            return response
        finally:
            # Remove from in-flight
            if cache_key in inflight:
                del inflight[cache_key]


# Decorator for route handlers to set cache TTL
def with_edge_cache(ttl: int = DEFAULT_TTL):
    """
    Decorator to set cache TTL for a route handler
    """
    def decorator(func):
        # Preserve the original function's signature
        from functools import wraps
        
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Find the request object
            request = None
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            
            if request is None and 'request' in kwargs:
                request = kwargs['request']
                
            if request is not None:
                # Set TTL in request state
                request.state.cache_ttl = ttl
                
            # Call the original function
            return await func(*args, **kwargs)
            
        return wrapper
    return decorator