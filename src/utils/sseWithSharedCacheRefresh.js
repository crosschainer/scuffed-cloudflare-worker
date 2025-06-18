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
                    if (next !== lastSent) {
                        lastSent = next;
                        controller.enqueue(encoder.encode(`data: ${next}\n\n`));
                    }
                };

                async function fetchAndPush() {
                    try {
                        const cached = await readEdgeCache(cacheKey);
                        if (cached) {
                            const json = await cached.clone().json();
                            sendIfChanged(json);
                        }
                    } catch { }

                    if (!refreshLocks.has(cacheKey.url)) {
                        const lock = (async () => {
                            try {
                                const fresh = await handlerFn(req, ctx);
                                await writeEdgeCache(cacheKey, fresh, ttl);
                                return fresh;
                            } catch (err) {
                                console.error("❌ Error inside handlerFn():", err);
                                throw err;
                            }
                        })();
                        refreshLocks.set(cacheKey.url, lock);
                        lock.finally(() => refreshLocks.delete(cacheKey.url));
                    }

                    try {
                        const freshResp = await refreshLocks.get(cacheKey.url);
                        const json = await freshResp.clone().json();
                        sendIfChanged(json);
                    } catch (err) {
                        console.error("❌ SSE refresh failed:", err);
                        controller.enqueue(encoder.encode(`event: error\ndata: "Refresh failed"\n\n`));
                    }
                }

                // Initial send
                await fetchAndPush();

                const timer = setInterval(fetchAndPush, interval);
                const pingTimer = setInterval(() => {
                    controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
                }, 15000); // every 15s to keep alive
                
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
