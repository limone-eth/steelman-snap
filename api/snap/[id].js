require('dotenv').config();

const { loadSteelman, getRatingStats } = require('../../lib/storage');
const { buildSnap } = require('../../lib/snap-builder');
const { sendSnap, sendSnapError, handlePreflight } = require('../../lib/snap-response');

/**
 * GET /api/snap/:id — initial render of a steelman snap.
 *
 * Special id: `demo` — returns a hardcoded sample without touching Upstash,
 * useful for testing the snap rendering pipeline before any real steelman
 * has been generated.
 */
module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendSnapError(res, 405, 'Method not allowed');
  }

  try {
    const id = req.query?.id || req.url?.split('/').pop()?.split('?')[0];
    if (!id) return sendSnapError(res, 400, 'missing id');

    if (id === 'demo') {
      return sendSnap(res, buildDemoSnap());
    }

    const steelman = await loadSteelman(id);
    if (!steelman) return sendSnapError(res, 404, 'steelman not found');

    const stats = await getRatingStats(id);
    const snap = buildSnap(steelman, 'strong', stats);
    return sendSnap(res, snap);
  } catch (err) {
    console.error('snap GET error:', err);
    return sendSnapError(res, 500, err.message);
  }
};

/**
 * Hardcoded demo steelman so the rendering pipeline can be tested without
 * needing a real id in storage.
 */
function buildDemoSnap() {
  const fakeSteelman = {
    id: 'demo',
    parentAuthor: 'demo',
    parentText: 'AI safety is just regulatory capture in disguise.',
    strong:
      'Concentrated AI capabilities create asymmetric risks (autonomy failures, dual-use, deceptive alignment) that no individual user can mitigate. Deliberate, conservative deployment is the only path that lets the field learn from small failures rather than catastrophic ones.',
    weak:
      'Big labs use vague gestures at "safety" to lobby for licensing regimes that just happen to match their compliance budget, freezing out smaller competitors and open-source models. The actual safety arguments are post-hoc.',
    agree:
      'Both sides agree that some AI systems can cause real harm, and that the question of who decides what gets deployed is high stakes. The disagreement is about *who* should decide, not whether decisions matter.'
  };
  return buildSnap(fakeSteelman, 'strong', { count: 0, avg: 0 });
}
