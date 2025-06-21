# FastAPI Replica of Cloudflare Worker

This project is a 1:1 replica of a Cloudflare Worker implemented as a Python FastAPI application.

## Features

- Complete API compatibility with the original Cloudflare Worker
- Edge caching with in-memory cache
- Server-Sent Events (SSE) support
- GraphQL client with throttling, caching, and deduplication
- Batch request processing
- CORS support

## Project Structure

```
fastapi-replica/
├── app/
│   ├── config/
│   │   └── constants.py
│   ├── handlers/
│   │   ├── batch.py
│   │   ├── circulating_supply.py
│   │   ├── token_balance.py
│   │   ├── token_holders.py
│   │   ├── tokens.py
│   │   └── total_supply.py
│   ├── middleware/
│   │   └── cache.py
│   ├── routes/
│   │   └── router.py
│   ├── utils/
│   │   ├── graphql.py
│   │   ├── response.py
│   │   └── sse.py
│   └── main.py
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── run.py
```

## Running the Application

### Using Python

```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
python run.py
```

### Using Docker

```bash
# Build and run with Docker Compose
docker-compose up -d
```

The application will be available at http://localhost:12000.

## API Endpoints

The API provides the following endpoints:

- `/` - API documentation
- `/total-supply` - Get total token supply
- `/circulating-supply` - Get circulating token supply
- `/total-holders` - Get total token holders
- `/tokens` - Get all tokens
- `/tokens/{contract_name}` - Get token by name
- `/token/{contract_name}/balance/{address}` - Get token balance
- `/tokens/{contract_name}/holders` - Get token holders
- `/pairs` - Get all pairs
- `/pairs/{pair_id}` - Get pair by ID
- `/pairs/{pair_id}/volume24h` - Get pair volume
- `/pairs/{pair_id}/pricechange24h` - Get pair price change
- `/pairs/{pair_id}/reserves` - Get pair reserves
- `/pairs/{pair_id}/trades` - Get pair trades
- `/pairs/{pair_id}/candles` - Get pair candles
- `/pairs/with/{token_contract}` - Get pairs by token
- `/stream/...` - SSE versions of various endpoints

## Batch Requests

You can make batch requests by sending a POST request to `/batch` with a JSON array of requests:

```json
[
  {
    "path": "/tokens",
    "params": {
      "limit": 5
    }
  },
  {
    "path": "/total-supply"
  }
]
```

## Testing

```bash
# Test the API
curl http://localhost:12000/

# Test batch processing
curl -X POST -H "Content-Type: application/json" \
  -d '[{"path":"/total-supply"},{"path":"/circulating-supply"}]' \
  http://localhost:12000/batch

# Test token balance
curl http://localhost:12000/token/currency/balance/dao

# Test token holders
curl "http://localhost:12000/tokens/currency/holders?limit=3"
```

## Environment Variables

- `PORT` - Port to run the server on (default: 12000)

## Implementation Details

The application is structured to mirror the Cloudflare Worker implementation:

1. **Middleware**: Handles caching and request/response processing
2. **Handlers**: Contains business logic for each endpoint
3. **Utils**: Provides utility functions for common operations
4. **Router**: Defines API routes and connects them to handlers