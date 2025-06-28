"""
GraphQL utility for executing queries with caching, deduplication, and throttling
"""
import json
import time
import asyncio
from typing import Any, Dict, Optional
import httpx
from fastapi import HTTPException

from app.config.constants import GRAPHQL_ENDPOINT
from app.utils.response import json_response

# Maximum concurrent GraphQL requests
MAX_CONCURRENCY = 10
inflight_count = 0
inflight_queue = []

# In-flight dedupe: key -> Future
dedupe_cache = {}
# Short-term response cache: key -> {ts, data}
short_term_cache = {}
CACHE_TTL = 2_000  # 2 seconds
REQUEST_TIMEOUT_MS = 5_000  # 5 seconds

# Semaphore for controlling concurrency
semaphore = asyncio.Semaphore(MAX_CONCURRENCY)


def canonical_key(query: str, variables: Dict[str, Any]) -> str:
    """Build a stable key from query+vars for dedupe/cache"""
    return json.dumps({"query": query, "variables": variables}, sort_keys=True)


async def execute_with_retry(fn, retries=1, initial_delay=100):
    """Execute a function with retries and exponential backoff"""
    last_error = None
    delay = initial_delay

    for i in range(retries + 1):
        try:
            return await fn()
        except Exception as err:
            last_error = err
            print(f"GraphQL attempt {i + 1} failed: {err}")

            # Don't retry on 4xx errors
            if hasattr(err, 'status_code') and err.status_code < 500:
                break

            # Wait before retrying
            if i < retries:
                await asyncio.sleep(delay / 1000)  # Convert to seconds
            delay *= 2  # exponential backoff

    raise last_error


async def execute_graphql_query(
    query: str,
    variables: Dict[str, Any] = None,
    error_message: str = "GraphQL query failed"
) -> Dict[str, Any]:
    """
    Execute a GraphQL query with:
    - short-term in-memory caching (2s TTL)
    - in-flight deduplication
    - max concurrency throttling
    - global timeout (fetch+parse) of 5s
    """
    if variables is None:
        variables = {}
        
    key = canonical_key(query, variables)
    now = time.time() * 1000  # Convert to ms

    # 0) Short-term cache hit?
    if key in short_term_cache:
        cached = short_term_cache[key]
        if (now - cached["ts"]) < CACHE_TTL:
            return cached["data"]

    # 1) Deduplicate identical in-flight requests
    if key in dedupe_cache:
        return await dedupe_cache[key]

    # 2) Throttle concurrency using semaphore
    async def raw_work():
        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(
                    GRAPHQL_ENDPOINT,
                    json={"query": query, "variables": variables},
                    headers={"Content-Type": "application/json"},
                    timeout=REQUEST_TIMEOUT_MS / 1000  # Convert to seconds
                )
                
                if not response.is_success:
                    text = response.text
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "error": error_message,
                            "status": response.status_code,
                            "details": text
                        }
                    )

                data = response.json()

                if "errors" in data:
                    raise HTTPException(
                        status_code=502,
                        detail={
                            "error": error_message,
                            "status": 502,
                            "details": data["errors"]
                        }
                    )

                short_term_cache[key] = {"ts": time.time() * 1000, "data": data}
                return data
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail={
                        "error": f"{error_message}: timed out after {REQUEST_TIMEOUT_MS}ms"
                    }
                )

    # 3) Execute with retry and timeout
    async with semaphore:
        try:
            # Create a task for the work
            task = asyncio.create_task(execute_with_retry(raw_work, 1))
            dedupe_cache[key] = task
            
            # Wait for the task to complete
            result = await task
            return result
        finally:
            # Clean up
            if key in dedupe_cache:
                del dedupe_cache[key]


async def sweep_graphql_cache(interval=30):
    while True:
        now = time.time() * 1000
        for k in [k for k,v in short_term_cache.items() if now - v["ts"] >= CACHE_TTL]:
            short_term_cache.pop(k, None)
        await asyncio.sleep(interval)