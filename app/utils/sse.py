"""
Server-Sent Events (SSE) utility with shared cache refresh
"""
import json
import asyncio
import time
from typing import Any, Callable, Dict, Optional
from fastapi import Request
from starlette.responses import StreamingResponse

from app.middleware.cache import generate_cache_key, read_edge_cache, write_edge_cache

# Map of refresh locks: key.url → Task
refresh_locks = {}


def sse_with_shared_cache_refresh(
    cache_key_fn: Callable[[Request], str],
    handler_fn: Callable[[Request], Any],
    ttl: int = 5,
    interval: int = 5000
):
    """
    Create an SSE endpoint with shared cache refresh
    
    Args:
        cache_key_fn: Function to generate cache key from request
        handler_fn: Function to handle the request and return data
        ttl: Cache TTL in seconds
        interval: Refresh interval in milliseconds
    """
    async def sse_endpoint(request: Request):
        headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*"
        }
        
        async def event_generator():
            cache_key = cache_key_fn(request)
            last_sent = None  # store last payload sent
            
            def send_if_changed(data):
                nonlocal last_sent
                next_data = json.dumps(data)
                if next_data != last_sent:
                    last_sent = next_data
                    return f"data: {next_data}\n\n"
                return None
            
            async def fetch_and_push():
                # 1) Try the edge cache
                try:
                    cached_data = await read_edge_cache(request)
                    if cached_data:
                        event = send_if_changed(cached_data)
                        if event:
                            yield event
                except Exception as e:
                    print(f"Error reading cache: {e}")
                
                # 2) Kick off a single "in-flight" refresh per key
                if cache_key not in refresh_locks:
                    async def refresh_task():
                        try:
                            # Run handler and extract JSON data
                            fresh_resp = await handler_fn(request)
                            if hasattr(fresh_resp, 'body'):
                                fresh_data = json.loads(await fresh_resp.body())
                            else:
                                fresh_data = fresh_resp
                            
                            # Write to cache
                            await write_edge_cache(request, fresh_data, ttl)
                            
                            return fresh_data
                        except Exception as e:
                            print(f"Error in refresh task: {e}")
                            raise
                    
                    task = asyncio.create_task(refresh_task())
                    refresh_locks[cache_key] = task
                    task.add_done_callback(lambda _: refresh_locks.pop(cache_key, None))
                
                # 3) When it's done, we get back plain JSON
                try:
                    if cache_key in refresh_locks:
                        fresh_data = await refresh_locks[cache_key]
                        event = send_if_changed(fresh_data)
                        if event:
                            yield event
                except Exception as e:
                    print(f"SSE refresh failed: {e}")
                    yield f"event: error\ndata: \"Refresh failed\"\n\n"
            
            # Initial send
            async for event in fetch_and_push():
                yield event
            
            # Continue sending updates
            while True:
                # Check if client disconnected
                if await request.is_disconnected():
                    break
                
                # Send ping every 15 seconds
                for _ in range(interval // 1000):
                    if _ > 0 and _ % 15 == 0:
                        yield "event: ping\ndata: {}\n\n"
                    await asyncio.sleep(1)
                
                # Fetch and push updates
                async for event in fetch_and_push():
                    yield event
        
        return StreamingResponse(event_generator(), headers=headers)
    
    return sse_endpoint