"""
Run script for the FastAPI application
"""
import uvicorn
import os

if __name__ == "__main__":
    # Use port 12000 by default, but allow override from environment
    port = int(os.environ.get("PORT", 12000))
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )