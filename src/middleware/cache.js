/**
 * Caching middleware for Cloudflare Workers
 */

import { CACHE_TTL_SECONDS } from '../config/constants.js';
import { json } from '../utils/response.js';

/**
 * A helper that wraps any handler in a cache.
 *
 * Steps:
 *   1) Look in caches.default for an entry under the cacheKey (the full request URL).
 *   2) If found, immediately return that cached Response.
 *   3) If not found, call computeResponse() to get a fresh Response.
 *   4) Attach `Cache-Control: public, max-age=<CACHE_TTL_SECONDS>` to its headers.
 *   5) Put it into caches.default (edge) asynchronously.
 *   6) Return the new Response (with Cache-Control).
 *
 * @param {string} pathname - The request pathname
 * @param {Request} request - The original request
 * @param {FetchEvent} event - The fetch event
 * @param {Function} computeResponse - Function that returns a Promise<Response>
 * @returns {Promise<Response>} The cached or fresh response
 */
export async function withCache(pathname, request, event, computeResponse) {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  // 1) Attempt to match in edge cache
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // 2) Cache miss → compute fresh
  let freshResponse;
  try {
    freshResponse = await computeResponse();
  } catch (err) {
    return json({ error: err.message || "Internal error" }, { status: 500 });
  }

  // 3) Clone & attach Cache-Control
  const headers = new Headers(freshResponse.headers);
  headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);

  const responseToCache = new Response(freshResponse.body, {
    status: freshResponse.status,
    headers: headers,
  });

  // 4) Put into edge cache (don't await—run in background)
  event.waitUntil(cache.put(cacheKey, responseToCache.clone()));

  // 5) Return the new response (with Cache-Control)
  return responseToCache;
}