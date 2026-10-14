/**
 * Minimal Worker for the deployed app.
 *
 * The app is a fully static bundle; there is no server-side logic to speak of
 * and no API routes (the optional `/api` search proxy is a Cloudflare Pages
 * Function and does not run here — search falls back to the bundled offline
 * index). All this does is serve the static assets, with `spa: true` in the
 * manifest handling the client-side routing fallback.
 */
export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: { fetch: (r: Request) => Promise<Response> } }} env
   * @returns {Promise<Response>}
   */
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
