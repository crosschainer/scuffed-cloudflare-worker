/* handlers/pairsStream.js ------------------------------------------ */
import { buildPairsSnapshot } from "../utils/pairsSnapshot.js";
import { CORS_HEADERS }       from "../middleware/cache.js";

const PUSH_INTERVAL_MS = 5_000;        // how “live” you need it

export async function pairsStreamHandler(req, env, ctx) {
  // parse the same pagination query string so the stream can be
  // scoped (handy if you show only the first 10 pairs on screen)
  const { searchParams } = new URL(req.url);
  const offset = Math.max(0,  parseInt(searchParams.get("offset") || "0", 10));
  const limit  = Math.min(100,parseInt(searchParams.get("limit")  || "25",10));

  // A ReadableStream pushes "data: …\n\n" chunks as they’re ready
  const stream = new ReadableStream({
    async start(controller) {
      // helper to push one event
      const push = async () => {
        const snap = await buildPairsSnapshot({ offset, limit }, env);
        controller.enqueue(
          `data: ${JSON.stringify(snap)}\n\n`
        );
      };

      // first payload immediately
      await push();

      // then every N seconds
      const timer = setInterval(push, PUSH_INTERVAL_MS);

      // clean-up if client disconnects
      controller.oncancel = () => clearInterval(timer);
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",          // IMPORTANT: never cache SSE
      "Connection":    "keep-alive",
      ...CORS_HEADERS
    }
  });
}
