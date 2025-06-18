/* handlers/pairsStream.js ------------------------------------------ */
import { buildPairsSnapshot }   from "../utils/pairsSnapshot.js";
import { CORS_HEADERS }         from "../middleware/cache.js";

const PUSH_MS       = 5_000;    // interval between pushes (ms)
const CACHE_TTL_SEC = PUSH_MS / 1000;  // match your push interval

export async function pairsStreamHandler(req, env, ctx) {
  // parse pagination params once
  const url    = new URL(req.url);
  const offset = Math.max(0,  parseInt(url.searchParams.get("offset") || "0", 10));
  const limit  = Math.min(Math.max(1, parseInt(url.searchParams.get("limit")  || "25", 10)), 100);

  // build a cache key unique to this stream URL (so it's separate from /pairs)
  const cacheKey = new Request(url.toString());

  const cache = caches.default;

  const stream = new ReadableStream({
    async start(ctrl) {
      const push = async () => {
        let snap;

        // 1) try the cached snapshot
        const hit = await cache.match(cacheKey);
        if (hit) {
          snap = await hit.json();
        } else {
          // 2) compute and prime the cache
          snap = await buildPairsSnapshot({ offset, limit });
          ctx.waitUntil(
            cache.put(
              cacheKey,
              new Response(JSON.stringify(snap), {
                headers: {
                  "Content-Type":  "application/json",
                  // keep this entry fresh for CACHE_TTL_SEC seconds
                  "Cache-Control": `public, max-age=${CACHE_TTL_SEC}`
                }
              })
            )
          );
        }

        ctrl.enqueue(`data: ${JSON.stringify(snap)}\n\n`);
      };

      await push();
      const id = setInterval(push, PUSH_MS);
      ctrl.oncancel = () => clearInterval(id);
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
      ...CORS_HEADERS
    }
  });
}
