/* handlers/pairVolumeStream.js ----------------------------------- */
import { buildPairVolumeSnapshot } from "../utils/pairVolumeSnapshot.js";
import { CORS_HEADERS } from "../middleware/cache.js";

const PUSH_INTERVAL_MS = 5_000;          // tweak as needed
const CACHE_TTL_SEC    = PUSH_INTERVAL_MS / 1000; // 5 seconds

export async function pairVolumeStreamHandler(req, env, ctx) {
  const url    = new URL(req.url);
  const pairId = url.searchParams.get("pair");
  const token  = Number(url.searchParams.get("token") ?? 0);

  if (!pairId || (token !== 0 && token !== 1)) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid query parameters" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // build a cache key unique to this exact SSE URL (pair+token)
  const cacheKey = new Request(req.url);

  const cache = caches.default;

  const stream = new ReadableStream({
    async start(controller) {
      const push = async () => {
        let snap;

        // try SSE‐cache first
        const hit = await cache.match(cacheKey);
        if (hit) {
          snap = await hit.json();
        } else {
          // compute and prime the cache
          snap = await buildPairVolumeSnapshot({ pairId, token });
          ctx.waitUntil(
            cache.put(
              cacheKey,
              new Response(JSON.stringify(snap), {
                headers: {
                  "Content-Type":  "application/json",
                  "Cache-Control": `public, max-age=${CACHE_TTL_SEC}`
                }
              })
            )
          );
        }

        controller.enqueue(`data: ${JSON.stringify(snap)}\n\n`);
      };

      // initial send + interval
      await push();
      const timer = setInterval(push, PUSH_INTERVAL_MS);

      // clean up on client disconnect
      controller.oncancel = () => clearInterval(timer);
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
