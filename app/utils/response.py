"""
Response utilities for formatting and returning API responses
"""
from fastapi.responses import JSONResponse
from typing import Any, Dict, Optional


def json_response(
    obj: Any, 
    status_code: int = 200, 
    headers: Optional[Dict[str, str]] = None
) -> JSONResponse:
    """
    Wraps a Python value (object/dict/list) into a JSONResponse.
    Automatically sets Content-Type: application/json and CORS headers.

    Args:
        obj: The object to convert to JSON
        status_code: HTTP status code (default: 200)
        headers: Additional headers to include

    Returns:
        A JSONResponse object with JSON content
    """
    base_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
    
    if headers:
        base_headers.update(headers)
    
    return JSONResponse(
        content=obj,
        status_code=status_code,
        headers=base_headers
    )