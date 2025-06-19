import { readEdgeCache, writeEdgeCache } from "../middleware/cache.js";

const refreshLocks = new Map(); // key.url → Promise

export function sseWithSharedCacheRefresh({ cacheKeyFn, handlerFn, ttl = 5, interval = 5000 }) {
    return async function (req, ctx) {
        const headers = {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*"
        };

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                const cacheKey = await cacheKeyFn(req); // Request object used as key
                let lastSent = null; // store last payload sent

                const sendIfChanged = (json) => {
                    const next = JSON.stringify(json);
                    if (next !== lastSent && controller.desiredSize > 0) {
                        lastSent = next;
                        controller.enqueue(encoder.encode(`data: ${next}\n\n`));
                    }
                };

                async function fetchAndPush() {
                    // 1) Try the edge cache
                    try {
                        const cached = await readEdgeCache(cacheKey);
                        if (cached) {
                            const data = await cached.json();
                            sendIfChanged(data);
                        }
                    } catch { }

                    // 2) Kick off a single “in-flight” refresh per key
                    if (!refreshLocks.has(cacheKey.url)) {
                        const lock = (async () => {
                            // run your handler and immediately extract its JSON…
                            const freshResp = await handlerFn(req, ctx);
                            const freshData = await freshResp.json();

                            // then write *a new* Response wrapping that JSON into cache
                            const toCache = new Response(JSON.stringify(freshData), {
                                headers: { "Content-Type": "application/json" },
                            });
                            await writeEdgeCache(cacheKey, toCache, ttl);

                            return freshData;   // share *data*, not a Response
                        })();
                        refreshLocks.set(cacheKey.url, lock);
                        lock.finally(() => refreshLocks.delete(cacheKey.url));
                    }

                    // 3) When it’s done, we get back plain JSON
                    try {
                        const freshData = await refreshLocks.get(cacheKey.url);
                        sendIfChanged(freshData);
                    } catch (err) {
                        console.error("❌ SSE refresh failed:", err);
                        controller.enqueue(encoder.encode(`event: error\ndata: "Refresh failed"\n\n`));
                    }
                }

                // Initial send
                await fetchAndPush();

                const timer = setInterval(fetchAndPush, interval);
                const pingTimer = setInterval(() => {
                    if (controller.desiredSize > 0) {
                        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
                    }
                }, 15000);


                req.signal?.addEventListener("abort", () => {
                    clearInterval(timer);
                    clearInterval(pingTimer);
                    controller.close();
                });
            }
        });

        return new Response(stream, { headers });
    };
}
