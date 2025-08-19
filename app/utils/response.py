"""
Response utilities for formatting and returning API responses
"""

from fastapi.responses import JSONResponse, PlainTextResponse
from typing import Any, Dict, Optional


def _merge_headers(headers: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Merge default CORS headers with any additional headers provided."""
    base_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    if headers:
        base_headers.update(headers)
    return base_headers


def json_response(
    obj: Any,
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> JSONResponse:
    """Wrap a Python value (object/dict/list) into a JSONResponse.

    Automatically sets *Content-Type: application/json* and CORS headers.

    Args:
        obj: The object to convert to JSON.
        status_code: HTTP status code (default: 200).
        headers: Additional headers to include.

    Returns:
        A ``fastapi.responses.JSONResponse`` instance.
    """
    return JSONResponse(
        content=obj,
        status_code=status_code,
        headers=_merge_headers(headers),
    )


def plain_text_response(
    text: str,
    status_code: int = 200,
    headers: Optional[Dict[str, str]] = None,
) -> PlainTextResponse:
    """Wrap a plain‐text string into a PlainTextResponse.

    Automatically sets *Content-Type: text/plain; charset=utf-8* and CORS headers.

    Args:
        text: The plain‐text content to send in the body.
        status_code: HTTP status code (default: 200).
        headers: Additional headers to include.

    Returns:
        A ``fastapi.responses.PlainTextResponse`` instance.
    """
    return PlainTextResponse(
        content=text,
        status_code=status_code,
        headers=_merge_headers(headers),
    )


__all__ = [
    "json_response",
    "plain_text_response",
]
