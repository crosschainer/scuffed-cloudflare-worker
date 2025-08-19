"""
Handler for pairs endpoints
───────────────────────────
GET /pairs?offset=X&limit=Y – ranked by 24 h volume (DESC)
"""
import logging
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal, getcontext, InvalidOperation
from typing import Dict, List, Any
from fastapi import Request

from app.utils.graphql import execute_graphql_query
from app.utils.response import json_response

logger = logging.getLogger(__name__)
getcontext().prec = 28                    # 18-dec math

CHUNK      = 1000          # GraphQL page size
WINDOW_MS  = 86_400_000    # 24 h in ms

# ───────── helpers ─────────
def price_from_sync(d: Dict[str, Any]) -> float | None:
    """mid-price: token-1 / token-0"""
    try:
        r0 = Decimal(d["reserve0"]); r1 = Decimal(d["reserve1"])
        return float(r1 / r0) if r0 != 0 else None
    except (KeyError, InvalidOperation):
        return None

def chunk_list(a: List[Any], n: int) -> List[List[Any]]:
    return [a[i:i+n] for i in range(0, len(a), n)]

# ───────── main ───────────
async def get_pairs(request: Request):
    try:
        # pagination --------------------------------------------------------
        offset = max(0, int(request.query_params.get("offset", "0")))
        limit  = min(max(1, int(request.query_params.get("limit", "50"))), 100)

        # swaps in last 24 h (volume only) ----------------------------------
        since_iso = (datetime.now(tz=timezone.utc)
                     - timedelta(milliseconds=WINDOW_MS)).isoformat()

        swap_q = """
          query ($since:Datetime!,$first:Int!,$offset:Int!){
            allEvents(
              condition:{contract:"con_pairs",event:"Swap"},
              filter:{created:{greaterThan:$since}},
              orderBy:CREATED_DESC,
              first:$first, offset:$offset
            ){edges{node{data dataIndexed}}}
          }"""
        stats: dict[str, Dict[str, Any]] = {}
        off = 0
        while True:
            res = await execute_graphql_query(swap_q, {"since":since_iso,
                                                       "first":CHUNK,
                                                       "offset":off})
            edges = res["data"]["allEvents"]["edges"]
            if not edges: break
            for e in edges:
                node = e["node"]; pair = node["dataIndexed"]["pair"]
                s = stats.setdefault(pair, {"v0":0.,"v1":0.,
                                            "open":None,"close":None,
                                            "baseline":None})
                d = node["data"]
                s["v0"] += float(d.get("amount0In",0) or 0)+float(d.get("amount0Out",0) or 0)
                s["v1"] += float(d.get("amount1In",0) or 0)+float(d.get("amount1Out",0) or 0)
            if len(edges)<CHUNK: break
            off += CHUNK

        # Sync prices -------------------------------------------------------
        if stats:
            sync_q = """
              query ($pair:String!,$since:Datetime!){
                latest:   allEvents(first:1 orderBy:CREATED_DESC
                  condition:{contract:"con_pairs",event:"Sync"}
                  filter:{dataIndexed:{contains:{pair:$pair}}}
                ){edges{node{data}}}

                open:     allEvents(first:1 orderBy:CREATED_ASC
                  condition:{contract:"con_pairs",event:"Sync"}
                  filter:{dataIndexed:{contains:{pair:$pair}},
                         created:{greaterThanOrEqualTo:$since}}
                ){edges{node{data}}}

                baseline: allEvents(first:1 orderBy:CREATED_DESC
                  condition:{contract:"con_pairs",event:"Sync"}
                  filter:{dataIndexed:{contains:{pair:$pair}},
                         created:{lessThanOrEqualTo:$since}}
                ){edges{node{data}}}
              }"""
            for pid in stats:
                r = await execute_graphql_query(sync_q, {"pair":pid,"since":since_iso})
                p = lambda k: price_from_sync(r["data"][k]["edges"][0]["node"]["data"]) \
                              if r["data"][k]["edges"] else None
                s = stats[pid]; s["close"]=p("latest"); s["open"]=p("open"); s["baseline"]=p("baseline")

        # metadata ----------------------------------------------------------
        meta_q = """
          query { allEvents(condition:{contract:"con_pairs",event:"PairCreated"}){
            edges{node{data dataIndexed}} } }"""
        meta_res = await execute_graphql_query(meta_q)
        metas = [ {"pair":n["data"]["pair"],
                   "token0":n["dataIndexed"]["token0"],
                   "token1":n["dataIndexed"]["token1"]}
                  for n in (e["node"] for e in meta_res["data"]["allEvents"]["edges"])]

        # enrich ------------------------------------------------------------
        rows=[]
        for m in metas:
            pid=m["pair"]; s=stats.get(pid,{})
            v24=float(s.get("v1",0) or 0)
            p_now=s.get("close"); p_old=s.get("baseline") or s.get("open")
            dp=None
            if p_now and p_old:
                if m["token0"]=="con_usdc" and m["token1"]=="currency":
                    # special pool → use reciprocal
                    dp=((1/p_now - 1/p_old)/(1/p_old))*100
                else:
                    dp=((p_now - p_old)/p_old)*100
            rows.append({"pair":pid,"token0":m["token0"],"token1":m["token1"],
                         "volume24h":v24,"pricePct24h":dp})

        rows.sort(key=lambda x:x["volume24h"],reverse=True)
        page=rows[offset:offset+limit]
        return json_response({
            "pairs":page,
            "pagination":{
                "offset":offset,"limit":limit,"total":len(rows),
                "next":offset+limit if offset+limit<len(rows) else None,
                "previous":max(0,offset-limit) if offset else None}})
    except Exception as e:
        logger.error("get_pairs error: %s",e,exc_info=True)
        return json_response({"error":"Internal error","message":str(e)},status_code=500)
