"""
Main FastAPI application
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from starlette.responses import JSONResponse, HTMLResponse
import logging
logger = logging.getLogger(__name__)
import asyncio
from app.routes.router import router
from app.middleware.cache import EdgeCacheMiddleware
from app.middleware.cache import cache_sweeper
from app.utils.graphql import sweep_graphql_cache
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ────────────────────────────────────────────────
    tasks: list[asyncio.Task] = [
        asyncio.create_task(cache_sweeper(interval=60)),
        asyncio.create_task(sweep_graphql_cache(interval=30)),
    ]
    try:
        yield                                            # ← app runs
    finally:
        # ── shutdown ───────────────────────────────────────────
        for t in tasks:
            t.cancel()
        # Await all, but swallow CancelledError so shutdown is clean
        await asyncio.gather(*tasks, return_exceptions=True)

# Create FastAPI app
app = FastAPI(
    title="Scuffed API",
    description="A FastAPI replica of the Cloudflare worker API",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add edge cache middleware
app.add_middleware(EdgeCacheMiddleware)

# Include router - mount it at the root but with a prefix to ensure proper route order
app.include_router(router, prefix="")

# Custom OpenAPI schema
def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    
    openapi_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
    )
    
    # Add custom schema modifications here if needed
    
    app.openapi_schema = openapi_schema
    return app.openapi_schema

@app.on_event("startup")
async def dump_routes():
    for r in app.routes:
        # WebSockets live as starlette.routing.WebSocketRoute
        from starlette.routing import WebSocketRoute
        if isinstance(r, WebSocketRoute):
            logger.error(f"🔸 WS route: {r.path}")
        else:
            logger.error(f"• HTTP route ({','.join(r.methods or [])}): {r.path}")

app.openapi = custom_openapi

# Custom documentation endpoints
@app.get("/docs", include_in_schema=False, response_class=HTMLResponse)
async def custom_swagger_ui_html():
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{app.title} - Swagger UI",
        oauth2_redirect_url="/docs/oauth2-redirect",
        swagger_js_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js",
        swagger_css_url="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css",
    )

@app.get("/docs/oauth2-redirect", include_in_schema=False, response_class=HTMLResponse)
async def oauth2_redirect():
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head>
    <title>OAuth2 Redirect</title>
    </head>
    <body>
    <script>
        window.onload = function() {
            window.opener.swaggerUIRedirectOauth2(window.location.href.split('#')[0]);
            window.close();
        }
    </script>
    </body>
    </html>
    """)

@app.get("/redoc", include_in_schema=False, response_class=HTMLResponse)
async def redoc_html():
    return get_redoc_html(
        openapi_url="/openapi.json",
        title=f"{app.title} - ReDoc",
        redoc_js_url="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js",
    )

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
