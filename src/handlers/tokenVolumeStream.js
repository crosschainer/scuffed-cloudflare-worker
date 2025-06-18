/* handlers/pairVolumeStream.js ----------------------------------- */
import { buildPairVolumeSnapshot } from "../utils/pairVolumeSnapshot.js";
import { CORS_HEADERS }            from "../middleware/cache.js";

const PUSH_INTERVAL_MS = 5_000;          // tweak as needed

export async function pairVolumeStreamHandler(req /*, env, ctx */) {
  const url    = new URL(req.url);
  const pairId = url.searchParams.get("pair");
  const token  = Number(url.searchParams.get("token") ?? 0);

  if (!pairId || (token !== 0 && token !== 1)) {
    return new Response(
      JSON.stringify({ error:"Missing or invalid query parameters" }),
      { status:400, headers:{ "Content-Type":"application/json", ...CORS_HEADERS } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const push = async () => {
        const snap = await buildPairVolumeSnapshot({ pairId, token });
        controller.enqueue(`data: ${JSON.stringify(snap)}\n\n`);
      };

      await push();                               // first event now
      const timer = setInterval(push, PUSH_INTERVAL_MS);

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
