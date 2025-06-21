"""
Handler for pairs endpoints
"""
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)

# Constants
CHUNK = 1000  # swaps page size
WINDOW_MS = 86400000  # 24 h (in milliseconds)

# Helper functions
def now() -> int:
    """Get current timestamp in milliseconds"""
    return int(time.time() * 1000)

def price0(data: Dict[str, Any]) -> Optional[float]:
    """Calculate price of token0 in token1 units"""
    amount0_in = float(data.get('amount0In', 0) or 0)
    amount0_out = float(data.get('amount0Out', 0) or 0)
    amount1_in = float(data.get('amount1In', 0) or 0)
    amount1_out = float(data.get('amount1Out', 0) or 0)
    
    if amount0_in > 0 and amount1_out > 0:
        return amount0_in / amount1_out
    elif amount1_in > 0 and amount0_out > 0:
        return amount0_out / amount1_in
    else:
        return None

def chunk_list(arr: List[Any], n: int) -> List[List[Any]]:
    """Split array into chunks of size n"""
    return [arr[i:i + n] for i in range(0, len(arr), n)]

async def get_pairs(request: Request):
    """
    GET /pairs?offset=X&limit=Y – ordered by 24h volume (DESC)
    """
    try:
        # 0. Parse pagination parameters
        offset = request.query_params.get('offset', '0')
        limit = request.query_params.get('limit', '25')
        
        try:
            offset = max(0, int(offset))
            limit = min(max(1, int(limit)), 100)
        except ValueError:
            return json_response(
                {"error": "Invalid offset or limit parameter"},
                status_code=400
            )
        
        # 1-a. Get swaps inside the last 24h
        since_iso = (datetime.now() - timedelta(milliseconds=WINDOW_MS)).isoformat() + 'Z'
        
        swaps_24h_gql = """
            query Swaps24h($since:Datetime!,$first:Int!,$offset:Int!){
                allEvents(
                    condition:{contract:"con_pairs",event:"Swap"}
                    filter:{created:{greaterThan:$since}}
                    orderBy:CREATED_DESC
                    first:$first
                    offset:$offset
                ){ edges{ node{ data dataIndexed created }} }
            }
        """
        
        stats = {}  # pair → {v0,v1,close,open,baseline}
        page_off = 0
        done = False
        
        while not done:
            res = await execute_graphql_query(
                swaps_24h_gql,
                {"since": since_iso, "first": CHUNK, "offset": page_off}
            )
            
            edges = res.get('data', {}).get('allEvents', {}).get('edges', [])
            if not edges:
                break
            
            for edge in edges:
                node = edge.get('node', {})
                data = node.get('data', {})
                data_indexed = node.get('dataIndexed', {})
                pair = data_indexed.get('pair')
                
                if not pair:
                    continue
                
                if pair not in stats:
                    stats[pair] = {"v0": 0, "v1": 0, "open": None, "close": None}
                
                rec = stats[pair]
                
                # Calculate volumes
                rec["v0"] += float(data.get('amount0In', 0) or 0) + float(data.get('amount0Out', 0) or 0)
                rec["v1"] += float(data.get('amount1In', 0) or 0) + float(data.get('amount1Out', 0) or 0)
                
                # Calculate open/close for price change
                p0 = price0(data)
                if p0 is not None:
                    if rec["close"] is None:
                        rec["close"] = p0  # newest => close
                    rec["open"] = p0  # will end with oldest
            
            done = len(edges) < CHUNK
            page_off += CHUNK
        
        # 1-b. Get one baseline swap (≤ since) per pair
        need_baseline = [
            pair_id for pair_id in stats 
            if stats[pair_id].get("close") is not None and stats[pair_id].get("baseline") is None
        ]
        
        if need_baseline:
            baseline_gql = """
                query Baseline($pair:String!,$since:Datetime!){
                    allEvents(
                        first:1 orderBy:CREATED_DESC
                        condition:{contract:"con_pairs",event:"Swap"}
                        filter:{
                            dataIndexed:{contains:{pair:$pair}}
                            created:{lessThanOrEqualTo:$since}
                        }
                    ){ edges{ node{ data }} }
                }
            """
            
            # Fetch baselines in groups of 25 (polite concurrency)
            GROUP = 25
            for group in chunk_list(need_baseline, GROUP):
                tasks = []
                for pair_id in group:
                    # Execute query for each pair
                    res = await execute_graphql_query(
                        baseline_gql,
                        {"pair": pair_id, "since": since_iso}
                    )
                    
                    edges = res.get('data', {}).get('allEvents', {}).get('edges', [])
                    if edges:
                        node = edges[0].get('node', {})
                        data = node.get('data', {})
                        p0 = price0(data)
                        if p0 is not None:
                            if pair_id in stats:
                                stats[pair_id]["baseline"] = p0
        
        # 2. Get static pair metadata
        meta_gql = """
            query PairsMeta {
                allEvents(condition:{contract:"con_pairs",event:"PairCreated"}) {
                    edges { node { dataIndexed data } }
                }
            }
        """
        
        meta_res = await execute_graphql_query(meta_gql)
        pairs_meta = []
        
        for edge in meta_res.get('data', {}).get('allEvents', {}).get('edges', []):
            node = edge.get('node', {})
            data = node.get('data', {})
            data_indexed = node.get('dataIndexed', {})
            
            pairs_meta.append({
                "pair": data.get('pair'),
                "token0": data_indexed.get('token0'),
                "token1": data_indexed.get('token1')
            })
        
        # 3. Enrich with volume + Δ%
        enriched = []
        
        for meta in pairs_meta:
            pair_id = meta.get('pair')
            s = stats.get(pair_id, {})
            
            # Special-case the "currency / con_usdc" pool (#1 on chain)
            is_currency_usdc = (
                meta.get('token0') == "con_usdc" and 
                meta.get('token1') == "currency"
            )
            
            # 24h Volume
            volume_24h = float(s.get('v1', 0) or 0)  # default token-1
            
            # 24h Price %
            change_pct = None
            p_now0 = s.get('close')
            p_old0 = s.get('baseline') or s.get('open')
            
            if p_now0 and p_old0:
                if is_currency_usdc:
                    # Same orientation as /pricechange24h?token=0
                    change_pct = ((p_now0 - p_old0) / p_old0) * 100
                else:
                    # Default orientation → invert like token=1
                    p_now_inv = 1 / p_now0
                    p_old_inv = 1 / p_old0
                    change_pct = ((p_now_inv - p_old_inv) / p_old_inv) * 100
            
            enriched.append({
                "pair": pair_id,
                "token0": meta.get('token0'),
                "token1": meta.get('token1'),
                "volume24h": volume_24h,
                "pricePct24h": change_pct
            })
        
        # 4. Rank by volume24h DESC & paginate
        enriched.sort(key=lambda x: x.get('volume24h', 0), reverse=True)
        
        page = enriched[offset:offset + limit]
        has_next = offset + limit < len(enriched)
        has_prev = offset > 0
        
        # 5. Response
        return json_response({
            "pairs": page,
            "pagination": {
                "offset": offset,
                "limit": limit,
                "total": len(enriched),
                "next": offset + limit if has_next else None,
                "previous": max(0, offset - limit) if has_prev else None
            }
        })
    
    except Exception as err:
        logger.error(f"Error in get_pairs: {err}")
        return json_response(
            {"error": "Internal error", "message": str(err)},
            status_code=500
        )