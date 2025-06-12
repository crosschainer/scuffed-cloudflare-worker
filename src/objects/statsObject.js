/* ------------------------------------------------------------------
   Durable Object : StatsObject (optimised, ≤10‑second freshness)
   ------------------------------------------------------------------ */

/**  📌  Key changes (v2 – hot‑fix)   --------------------------------
 *  • Default‑safe snapshot loading – guarantees this.orderings is
 *    always an object even when loading an old-format snapshot.
 *  • Defensive access in fetch(): `this.orderings?.[order]`.
 *  • Slightly safer fall‑back when no orderings exist yet.
 */

// ──────────────────────────────────────────────────────────────────
// Tunables
// ──────────────────────────────────────────────────────────────────
const ALARM_INTERVAL_MS     = 10_000;       // 10‑second heartbeat
const PAIR_SCAN_INTERVAL_MS = 60_000;       // rescan creation events once / min
const HOT_WINDOW_MS         = 5 * 60_000;   // ‘active’ if swapped in 5 min
const CHUNK_SIZE            = 50;           // #pairs per GraphQL batch
const POOL_LIMIT            = 20;           // intra‑chunk parallelism
const DAY_MS                = 24 * 60 * 60 * 1_000;

// ──────────────────────────────────────────────────────────────────
// Lightweight promise pool helper
// ──────────────────────────────────────────────────────────────────
async function pool(list, fn, max = POOL_LIMIT) {
  const it = list[Symbol.iterator]();
  const running = new Set();
  const out = [];
  const step = () => {
    const { value, done } = it.next();
    if (done) return;
    const p = Promise.resolve(fn(value))
      .then(r => { running.delete(p); out.push(r); step(); })
      .catch(e => { running.delete(p); out.push(e); step(); });
    running.add(p);
  };
  Array.from({ length: max }).forEach(step);
  await Promise.all(running);
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Factory for an empty orderings object – keeps code DRY
// ──────────────────────────────────────────────────────────────────
const emptyOrderings = () => ({
  tokenPerXianAsc : [],
  tokenPerXianDesc: [],
  liquidity       : [],
  volumeDesc      : []
});

export class StatsObject {
  constructor(state, env) {
    this.state = state;
    this.env   = env;

    // ────────── caches ──────────
    this.recMap      = new Map();   // pairId → { …stats }
    this.orderings   = emptyOrderings();
    this.lastPairScan = 0;
    this.roundRobin   = 0;         // cursor for fallback refresh

    // hydrate from KV / DO storage
    this.ready = this._loadSnapshot().catch(() => {});

    // first alarm ASAP
    this.state.storage.setAlarm(Date.now());
  }

  /*──────────────── snapshot helpers ────────────────*/
  async _loadSnapshot() {
    const snap = await this.state.storage.get("snapshot");
    if (!snap) return;
    const { recs, orderings: ord = {}, lastPairScan, roundRobin } = JSON.parse(snap);
    this.recMap       = new Map(recs);
    // merge with empty template so missing keys don’t break fetch()
    this.orderings    = { ...emptyOrderings(), ...ord };
    this.lastPairScan = lastPairScan || 0;
    this.roundRobin   = roundRobin   || 0;
  }

  async _saveSnapshot() {
    const payload = JSON.stringify({
      when        : Date.now(),
      recs        : [...this.recMap.entries()],
      orderings   : this.orderings,
      lastPairScan: this.lastPairScan,
      roundRobin  : this.roundRobin
    });
    await this.state.storage.put("snapshot", payload);
    if (this.env.PAIRS_STATS_KV) {
      await this.env.PAIRS_STATS_KV.put("snapshot", payload, { expirationTtl: 3_600 });
    }
  }

  /*──────────────── GraphQL wrapper with basic retry ─────────────*/
  async _gql(query, variables = {}, tries = 3) {
    try {
      const r = await fetch(this.env.GRAPHQL_URL, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({ query, variables })
      });
      return await r.json();
    } catch (err) {
      if (tries > 1) return this._gql(query, variables, tries - 1);
      throw err;
    }
  }

  /*────────────────────────── ALARM ──────────────────────────────*/
  async alarm() {
    if (this.busy) return;          // skip if a long job is in progress
    this.busy = true;
    try {
      await this.ready;
      if (Date.now() - this.lastPairScan > PAIR_SCAN_INTERVAL_MS) {
        await this.scanPairs();
      }
      await this.refreshHot();
      await this._saveSnapshot();
    } finally {
      this.busy = false;
      this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
    }
  }

  /*──────────────────────── fetch() API ─────────────────────────*/
  async fetch(req) {
    await this.ready;

    const { searchParams } = new URL(req.url);
    const order   = searchParams.get("order") || "volumeDesc";
    const limit   = Math.min(Math.max(+searchParams.get("limit")  || 50, 1), 100);
    const offset  = Math.max(+searchParams.get("offset") || 0, 0);

    const ordered = this.orderings?.[order] || [];
    const slice   = ordered.slice(offset, offset + limit);

    return new Response(JSON.stringify({
      stats: slice,
      pagination: {
        offset, limit, total: ordered.length,
        next     : offset + limit < ordered.length ? offset + limit : null,
        previous : offset > 0 ? Math.max(0, offset - limit) : null,
        order
      }
    }), { headers: { "Content-Type": "application/json" } });
  }

  /*──────────────────────── phase 1 — pair discovery ───────────*/
  async scanPairs() {
    const listQL = `
      query { allEvents(
        condition:{ contract:\"con_pairs\", event:\"PairCreated\" }
        orderBy:CREATED_ASC
        first:9999
      ){ edges{ node{ data dataIndexed } } } }`;

    const j = await this._gql(listQL);
    const pairs = j?.data?.allEvents?.edges?.flatMap(e => {
      const d  = e.node.data        || {};
      const ix = e.node.dataIndexed || {};
      return (d.pair && ix.token0 && ix.token1)
        ? [{ pair:d.pair, token0:ix.token0, token1:ix.token1 }]
        : [];
    }) || [];

    if (!pairs.length) return;

    // add any new pairs to recMap skeleton
    for (const p of pairs) {
      if (!this.recMap.has(p.pair)) {
        this.recMap.set(p.pair, {
          pairId       : p.pair,
          token0       : p.token0,
          token1       : p.token1,
          token0Pertoken1 : 0,
          priceUsd     : 0,
          volume24h    : 0,
          volume24hUsd : 0,
          reserve0     : 0,
          reserve1     : 0,
          liquidityUsd : 0,
          lastSwapTs   : 0       // ↲ used to select “hot” pairs
        });
      }
    }
    this.lastPairScan = Date.now();
  }

  /*────────────────── phase 2 — refresh ‘hot’ pairs ────────────*/
  async refreshHot() {
    const now = Date.now();

    // 2-A  identify the working set
    const hot = [];
    for (const rec of this.recMap.values()) {
      if (now - rec.lastSwapTs < HOT_WINDOW_MS) hot.push(rec);
    }

    // guarantee coverage: if not enough hot pairs, continue round-robin
    if (hot.length < CHUNK_SIZE) {
      const all = [...this.recMap.values()];
      for (let i = 0; hot.length < CHUNK_SIZE && i < all.length; i++) {
        const idx = (this.roundRobin + i) % all.length;
        const rec = all[idx];
        if (!hot.includes(rec)) hot.push(rec);
      }
      this.roundRobin = (this.roundRobin + CHUNK_SIZE) % Math.max(all.length, 1);
    }

    if (!hot.length) return;

    // 2-B  refresh reserves in one batched GraphQL query
    await this._refreshReserves(hot);

    // 2-C  refresh per-pair stats (last swap + 24h volume)
    await this._refreshStats(hot);

    // 2-D  re-compute derived fields & orderings once per tick
    this._reindex();
  }

  /*────────────────── reserves batch helper ────────────────────*/
  async _refreshReserves(list) {
    const keyOf = (p, i) => `con_pairs.pairs:${p.pairId}:balance${i}`;
    const parseId = k => k.split(":" )[1];

    for (let i = 0; i < list.length; i += CHUNK_SIZE) {
      const chunk = list.slice(i, i + CHUNK_SIZE);
      const ks0   = chunk.map(r => keyOf(r, 0));
      const ks1   = chunk.map(r => keyOf(r, 1));

      const resQL = `
        query Res($ks0:[String!]!,$ks1:[String!]!){
          b0: allStates(filter:{key:{in:$ks0}}){edges{node{key valueNumeric}}}
          b1: allStates(filter:{key:{in:$ks1}}){edges{node{key valueNumeric}}}
        }`;
      const r = await this._gql(resQL, { ks0, ks1 });

      for (const { node } of r?.data?.b0?.edges ?? []) {
        const rec = this.recMap.get(parseId(node.key));
        if (rec) rec.reserve0 = +node.valueNumeric || 0;
      }
      for (const { node } of r?.data?.b1?.edges ?? []) {
        const rec = this.recMap.get(parseId(node.key));
        if (rec) rec.reserve1 = +node.valueNumeric || 0;
      }
    }
  }

  /*────────────────── per-pair stats helper ────────────────────*/
  async _refreshStats(list) {
    const sinceIso = new Date(Date.now() - DAY_MS).toISOString().replace("Z", "");

    // mini helper to extract tokenPerXian from swap event
    const tpxOf = d => {
      const { amount0In:a0i=0, amount0Out:a0o=0, amount1In:a1i=0, amount1Out:a1o=0 } = d;
      return a0i>0 && a1o>0 ? a0i/a1o
           : a1i>0 && a0o>0 ? a0o/a1i
           : null;
    };

    // find XIAN→USD reference price (pairId = 1)
    const xianUsd = (() => {
      const p1 = this.recMap.get("1");
      return p1 && p1.reserve1 > 0 ? p1.reserve0 / p1.reserve1 : 0;
    })() || 0;

    // fetch in parallel but bounded by pool()
    await pool(list, async rec => {
      const statsQL = `
        query Pair($pair:String!,$since:Datetime!){
          last: allEvents(first:1, orderBy:CREATED_DESC,
            condition:{contract:"con_pairs",event:"Swap"},
            filter:{dataIndexed:{contains:{pair:$pair}}})
          { edges{ node{ data created } } }
          vol: allEvents(first:1000,
            condition:{contract:"con_pairs",event:"Swap"},
            filter:{dataIndexed:{contains:{pair:$pair}}, created:{greaterThan:$since}})
          { edges{ node{ data } } }
        }`;

      const g = await this._gql(statsQL, { pair: rec.pairId, since: sinceIso });

      // last swap → token0Pertoken1
      const lastEdge = g?.data?.last?.edges?.[0];
      if (lastEdge) {
        rec.lastSwapTs = +new Date(lastEdge.node.created);
        const tpx = tpxOf(lastEdge.node.data);
        if (tpx != null) rec.token0Pertoken1 = tpx;
      }

      // 24h volume (token0) → USD
      rec.volume24h = (g?.data?.vol?.edges ?? []).reduce(
        (s, { node:{ data } }) => s + (+data.amount0In || 0) + (+data.amount0Out || 0),
        0);

      // derive USD conversions & liquidity
      if (xianUsd > 0 && rec.token0Pertoken1 > 0) {
        rec.priceUsd      = xianUsd / rec.token0Pertoken1;
        rec.volume24hUsd  = rec.volume24h * rec.priceUsd;
        if (rec.token0 == "con_usdc"){
          rec.liquidityUsd = rec.reserve0 * rec.priceUsd * 2;
        }
        else{
          rec.liquidityUsd  = rec.reserve0 * rec.priceUsd + rec.reserve1 * xianUsd;
          }
      } else {
        rec.priceUsd = rec.volume24hUsd = rec.liquidityUsd = 0;
      }
    });
  }

  /*──────────────────── index arrays for fast fetch() ───────────*/
  _reindex() {
    const list = [...this.recMap.values()];
    this.orderings.token0Pertoken1Asc  = [...list].sort((a,b) => a.token0Pertoken1 - b.token0Pertoken1);
    this.orderings.token0Pertoken1Desc = [...list].sort((a,b) => b.token0Pertoken1 - a.token0Pertoken1);
    this.orderings.liquidity        = [...list].sort((a,b) => b.liquidityUsd - a.liquidityUsd);
    this.orderings.volumeDesc       = [...list].sort((a,b) => b.volume24hUsd - a.volume24hUsd);
  }
}
