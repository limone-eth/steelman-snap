require('dotenv').config();

const { loadSteelman, addRating, getRatingStats } = require('../../lib/storage');
const { buildSnap } = require('../../lib/snap-builder');
const { sendSnap, sendSnapError, handlePreflight } = require('../../lib/snap-response');

/**
 * POST /api/snap/feedback?id=<id>&view=<view>
 *
 * Handles two cases:
 *   1. View switch (Strongest / Weakest / Common ground buttons) — body has no inputs
 *   2. Rating submission (Submit button) — body has { inputs: { rating: 1..5 } }
 *
 * Returns a fresh snap JSON tree representing the new state.
 */
module.exports = async (req, res) => {
  if (handlePreflight(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendSnapError(res, 405, 'Method not allowed');
  }

  try {
    const id = req.query?.id;
    let view = req.query?.view || 'strong';
    if (!id) return sendSnapError(res, 400, 'missing id');

    const steelman = await loadSteelman(id);
    if (!steelman) return sendSnapError(res, 404, 'steelman not found');

    const inputs = req.body?.inputs || {};
    let stats;

    if (inputs.rating != null) {
      // Rating submission — record it and force the 'rated' confirmation view.
      stats = await addRating(id, inputs.rating);
      view = 'rated';
    } else {
      stats = await getRatingStats(id);
    }

    const snap = buildSnap(steelman, view, stats);
    return sendSnap(res, snap);
  } catch (err) {
    console.error('snap feedback error:', err);
    return sendSnapError(res, 500, err.message);
  }
};
