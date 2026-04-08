/**
 * Shared response helpers for snap endpoints.
 *
 * Snaps are fetched cross-origin by Farcaster clients and (especially) by
 * browser-based snap renderers / testers. Two things matter on every snap
 * response:
 *
 *   1. Content-Type must be `application/vnd.farcaster.snap+json` so the
 *      client recognizes the response as a snap (not a generic JSON file).
 *      See https://docs.farcaster.xyz/snap/spec-overview
 *
 *   2. CORS must be permissive — `*` for the origin, and OPTIONS preflights
 *      need to succeed for POST endpoints (snap action submissions).
 */

const SNAP_MEDIA_TYPE = 'application/vnd.farcaster.snap+json';

/**
 * Apply the standard CORS + cache headers to any snap response.
 */
function applySnapHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * Send a snap JSON tree with the correct media type + CORS headers.
 */
function sendSnap(res, snap, status = 200) {
  applySnapHeaders(res);
  res.setHeader('Content-Type', SNAP_MEDIA_TYPE);
  res.status(status).send(JSON.stringify(snap));
}

/**
 * Send an error in snap format (or plain JSON if you prefer — clients vary).
 * For now we use a tiny snap with a single text element so the client at least
 * shows something instead of a broken card.
 */
function sendSnapError(res, status, message) {
  const snap = {
    version: '1.0',
    ui: {
      root: 'root',
      elements: {
        root: {
          type: 'stack',
          props: { direction: 'vertical', gap: 'md' },
          children: ['err']
        },
        err: { type: 'text', props: { content: message, weight: 'bold' } }
      }
    }
  };
  sendSnap(res, snap, status);
}

/**
 * Handle CORS preflight (OPTIONS). Returns true if the request was a
 * preflight and the handler should stop processing.
 */
function handlePreflight(req, res) {
  if (req.method === 'OPTIONS') {
    applySnapHeaders(res);
    res.status(204).end();
    return true;
  }
  return false;
}

module.exports = { sendSnap, sendSnapError, handlePreflight, SNAP_MEDIA_TYPE };
