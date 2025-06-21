"""
Main FastAPI application
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.routes.router import router
from app.middleware.cache import EdgeCacheMiddleware

# Create FastAPI app
app = FastAPI(
    title="Scuffed API",
    description="A FastAPI replica of the Cloudflare worker API",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add edge cache middleware
app.add_middleware(EdgeCacheMiddleware)

# Include router
app.include_router(router)

# Add exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": str(exc)
        }
    )

# Add OPTIONS handler for CORS preflight
@app.options("/{path:path}")
async def options_handler(request: Request, path: str):
    return JSONResponse(
        content=None,
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    )