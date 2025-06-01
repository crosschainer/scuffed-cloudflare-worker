/* utils/graphqlRetry.js  ─────────────────────────────────────────── */
/*  Monkey-patch axios.post so that any request to GRAPHQL_ENDPOINT   */
/*  automatically retries on network errors, 5xx or 429 responses.   */

import axios from "axios";
import { GRAPHQL_ENDPOINT } from "../config/constants.js";

const originalPost = axios.post.bind(axios);

axios.post = async function patchedPost(url, body, config = {}, tries = 3) {
  // Only wrap requests that go to the GraphQL endpoint
  if (url !== GRAPHQL_ENDPOINT) {
    return originalPost(url, body, config);
  }

  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await originalPost(url, body, config);
    } catch (err) {
      const code = err.response?.status;
      const retryable =
        !err.response || code === 429 || code >= 500; // network / 429 / 5xx

      if (attempt === tries - 1 || !retryable) throw err;

      // simple exponential back-off: 200 ms, 400 ms, 800 ms …
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
    }
  }
};