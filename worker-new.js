/**
 * worker.js
 *
 * A modular Cloudflare Worker (ES Module) that exposes:
 *   • GET  /total-supply
 *   • GET  /circulating-supply
 *   • GET  /total-holders
 *   • GET  / (Swagger UI)
 *   • GET  /openapi.json (OpenAPI spec)
 *
 * This file is a compatibility layer that imports from the modular structure.
 * For new development, please use the src/ directory structure.
 */

// Import the main handler from the modular structure
import { handleRequest } from './src/routes/router.js';

// Register the fetch event listener
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event));
});