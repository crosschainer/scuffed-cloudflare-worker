/**
 * Response utilities for formatting and returning API responses
 */

/**
 * Wraps a JavaScript value (object/array) into a JSON Response.
 * Automatically sets Content-Type: application/json.
 *
 * @param {Object} obj - The object to convert to JSON
 * @param {Object} options - Response options
 * @param {number} options.status - HTTP status code (default: 200)
 * @param {Object} options.headers - Additional headers to include
 * @returns {Response} A Response object with JSON content
 */
export function json(obj, options = {}) {
  const { status = 200, headers = {} } = options;
  const baseHeaders = { "Content-Type": "application/json", ...headers };
  // If cors headers are missing, add them
  if (!baseHeaders["Access-Control-Allow-Origin"]) {
    baseHeaders["Access-Control-Allow-Origin"] = "*";
  }
  if (!baseHeaders["Access-Control-Allow-Methods"]) {
    baseHeaders["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS";
  }
  if (!baseHeaders["Access-Control-Allow-Headers"]) {
    baseHeaders["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  }
  return new Response(JSON.stringify(obj), {
    status,
    headers: baseHeaders,
  });
}