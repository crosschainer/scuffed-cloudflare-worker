import { GRAPHQL_ENDPOINT } from '../config/constants.js';
import { json } from './response.js';

// Maximum concurrent GraphQL requests
const MAX_CONCURRENCY = 10;
let inflightCount = 0;
const inflightQueue = [];

// In-flight dedupe: Map<key, Promise>
const dedupeCache = new Map();
// Short-term response cache: Map<key, { ts, data }>
const shortTermCache = new Map();
const CACHE_TTL = 2_000;            // 2 seconds
const REQUEST_TIMEOUT_MS = 5_000;   // 5 seconds

/**
 * Race a promise against a timeout.
 */
async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, rej) =>
    timer = setTimeout(() => rej(new Error('Request timed out')), ms)
  );
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Wait until inflightCount < MAX_CONCURRENCY */
function waitForSlot() {
  if (inflightCount < MAX_CONCURRENCY) return Promise.resolve();
  return new Promise(resolve => inflightQueue.push(resolve));
}

/** Free up one slot and wake the next waiter */
function releaseSlot() {
  inflightCount--;
  if (inflightQueue.length) {
    const next = inflightQueue.shift();
    inflightCount++;
    next();
  }
}

/** Build a stable key from query+vars for dedupe/cache */
function canonicalKey(query, variables) {
  return JSON.stringify({ query, variables });
}

async function executeWithRetry(fn, retries = 1) {
  let lastError;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`GraphQL attempt ${i + 1} failed:`, err);
      // Optionally: only retry on specific errors
      if (err.status && err.status < 500) break; // don't retry 4xx
    }
  }
  throw lastError;
}

/**
 * Execute a GraphQL query with:
 * - short-term in-memory caching (2s TTL)
 * - in-flight deduplication
 * - max concurrency throttling
 * - global timeout (fetch+parse) of 5s
 */
export async function executeGraphQLQuery(
  query,
  variables = {},
  errorMessage = "GraphQL query failed"
) {
  const key = canonicalKey(query, variables);
  const now = Date.now();

  // 0) Short-term cache hit?
  const cached = shortTermCache.get(key);
  if (cached && (now - cached.ts) < CACHE_TTL) {
    return cached.data;
  }

  // 1) Deduplicate identical in-flight requests
  if (dedupeCache.has(key)) {
    return dedupeCache.get(key);
  }

  // 2) Throttle concurrency
  await waitForSlot();
  inflightCount++;

  // 3) Build the raw work (fetch + JSON parse)
  const rawPromise = (async () => {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw json(
        { error: errorMessage, status: response.status, details: text },
        { status: 502 }
      );
    }

    const data = await response.json();
    // cache success
    shortTermCache.set(key, { ts: Date.now(), data });
    return data;
  })();

  // 4) Enforce global timeout across fetch+parse
  const timedPromise = withTimeout(
    executeWithRetry(rawPromise, 1), // retry once
    REQUEST_TIMEOUT_MS
  );

  // 5) On completion or error, release slot & clear dedupe
  const finalPromise = timedPromise
    .catch(err => {
      if (err.message === 'Request timed out') {
        throw json(
          { error: `${errorMessage}: timed out after ${REQUEST_TIMEOUT_MS}ms` },
          { status: 504 }
        );
      }
      throw err;
    })
    .finally(() => {
      releaseSlot();
      dedupeCache.delete(key);
    });

  // 6) Remember in-flight
  dedupeCache.set(key, finalPromise);
  return finalPromise;
}
