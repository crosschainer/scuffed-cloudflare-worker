/**
 * Handler for Swagger UI and OpenAPI specification
 */

import { json } from '../utils/response.js';
import { openapiSpec } from '../config/openapi.js';

/**
 * Handler for both:
 *   GET "/"           → returns HTML page loading Swagger UI from CDN
 *   GET "/openapi.json" → returns the JSON OpenAPI spec
 * 
 * @param {Request} request - The original request
 * @param {FetchEvent} event - The fetch event
 * @returns {Promise<Response>} HTML or JSON response
 */
export async function swaggerHandler(request, event) {
  const url = new URL(request.url);
  let pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") {
    pathname = "/";
  }

  if (pathname === "/") {
    // Serve a minimal HTML page that loads Swagger UI from unpkg.com
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>General Xian API Docs</title>
  <link
    rel="stylesheet"
    href="https://unpkg.com/swagger-ui-dist/swagger-ui.css"
  />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui'
      });
    };
  </script>
</body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (pathname === "/openapi.json") {
    // Serve the OpenAPI JSON
    return json(openapiSpec);
  }

  // Any other path → 404
  return json({ error: "Not found" }, { status: 404 });
}