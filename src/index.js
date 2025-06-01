/**
 * Main entry point for the Cloudflare Worker
 * 
 * This file is intentionally minimal, delegating all functionality to the
 * appropriate modules. This makes the codebase more maintainable and scalable.
 */

import { handleRequest } from './routes/router.js';
import "./utils/retry.js"; // Patch axios for retry logic

// Register the fetch event listener
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});