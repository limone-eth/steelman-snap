require('dotenv').config();

const { loadSteelman, addRating, getRatingStats } = require('../../lib/storage');
const { buildSnap } = require('../../lib/snap-builder');

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = req.query?.id;
    let view = req.query?.view || 'strong';
    if (!id) return res.status(400).json({ error: 'missing id' });

    const steelman = await loadSteelman(id);
    if (!steelman) return res.status(404).json({ error: 'steelman not found' });

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
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snap);
  } catch (err) {
    console.error('snap feedback error:', err);
    return res.status(500).json({ error: err.message });
  }
};
