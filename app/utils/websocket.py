import json
import asyncio
from typing import Any, Callable
from fastapi import WebSocket, WebSocketDisconnect

from app.middleware.cache import generate_cache_key, read_edge_cache, write_edge_cache

# reuse the same refresh_locks map
refresh_locks: dict[str, asyncio.Task] = {}

def websocket_with_shared_cache_refresh(
    cache_key_fn: Callable[[WebSocket], str],
    handler_fn: Callable[[WebSocket], Any],
    ttl: int = 5,
    interval: int = 5000,
):
    """
    Create a WebSocket endpoint with shared cache refresh.

    Args:
        cache_key_fn: Function to generate cache key from websocket
        handler_fn: Coroutine that returns a Response-like object with .body / .body() 
        ttl:           seconds to live in cache
        interval:      milliseconds between refresh attempts
    """
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        cache_key = cache_key_fn(ws)
        last_sent: str | None = None

        def should_send(data: Any) -> str | None:
            nonlocal last_sent
            text = json.dumps(data)
            if text != last_sent:
                last_sent = text
                # just push the bare JSON; client can parse
                return text
            return None

        async def do_fetch() -> Any:
            # 1) stale‐read from cache
            try:
                cached = await read_edge_cache(ws)
                if cached is not None:
                    return cached
            except Exception:
                pass

            # 2) trigger a single shared refresh
            if cache_key not in refresh_locks:
                async def _refresh():
                    resp = await handler_fn(ws)
                    # grab body bytes/text
                    body = await resp.body() if callable(resp.body) else resp.body
                    text = body.decode() if isinstance(body, (bytes, bytearray)) else body
                    payload = json.loads(text)
                    await write_edge_cache(ws, payload, ttl)
                    return payload

                task = asyncio.create_task(_refresh())
                refresh_locks[cache_key] = task
                task.add_done_callback(lambda _: refresh_locks.pop(cache_key, None))

            # 3) await the in‐flight task if present
            try:
                return await refresh_locks[cache_key]
            except Exception:
                # you could send an error event here
                return {"error": "refresh failed"}

        try:
            # initial push
            data = await do_fetch()
            if (msg := should_send(data)) is not None:
                await ws.send_text(msg)

            # loop forever
            while True:
                # ping every 15 seconds
                for _ in range(interval // 1000):
                    await asyncio.sleep(1)
                    if _ > 0 and _ % 15 == 0:
                        await ws.send_text(json.dumps({"type": "ping"}))

                # then fetch & push if changed
                data = await do_fetch()
                if (msg := should_send(data)) is not None:
                    await ws.send_text(msg)

        except WebSocketDisconnect:
            # client went away
            return

    return ws_endpoint
