"""
Handler for batch requests
"""
import json
import httpx
from typing import Dict, List, Any
from fastapi import Request, HTTPException
from urllib.parse import urlparse, parse_qs

from app.utils.response import json_response


async def batch_handler(request: Request):
    """
    Handle batch requests
    
    Args:
        request: The incoming request
        
    Returns:
        JSON response with batch results
    """
    try:
        # Parse the request body
        body = await request.json()
        
        if not isinstance(body, list):
            return json_response(
                {"error": "Batch request must be an array"},
                status_code=400
            )
        
        # Process each request in the batch
        results = []
        base_url = str(request.base_url)
        
        async with httpx.AsyncClient() as client:
            for i, req_info in enumerate(body):
                # Validate request format
                if not isinstance(req_info, dict) or "path" not in req_info:
                    results.append({
                        "error": "Invalid request format",
                        "index": i
                    })
                    continue
                
                # Extract path and query parameters
                path = req_info.get("path", "")
                query_params = req_info.get("params", {})
                
                # Build the URL
                url = f"{base_url.rstrip('/')}{path}"
                
                try:
                    # Make the request
                    response = await client.get(url, params=query_params)
                    
                    # Parse the response
                    try:
                        response_data = response.json()
                    except json.JSONDecodeError:
                        response_data = response.text
                    
                    results.append({
                        "success": True,
                        "data": response_data
                    })
                except Exception as e:
                    results.append({
                        "success": False,
                        "error": str(e),
                        "path": path
                    })
        
        return json_response(results)
    
    except Exception as e:
        return json_response(
            {"error": "Failed to process batch request", "message": str(e)},
            status_code=500
        )