require('dotenv').config();

const { loadSteelman, getRatingStats } = require('../../lib/storage');
const { buildSnap } = require('../../lib/snap-builder');

/**
 * GET /api/snap/:id — initial render of a steelman snap.
 * Default view is 'strong'.
 */
module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = req.query?.id || req.url?.split('/').pop()?.split('?')[0];
    if (!id) return res.status(400).json({ error: 'missing id' });

    const steelman = await loadSteelman(id);
    if (!steelman) return res.status(404).json({ error: 'steelman not found' });

    const stats = await getRatingStats(id);
    const snap = buildSnap(steelman, 'strong', stats);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(snap);
  } catch (err) {
    console.error('snap GET error:', err);
    return res.status(500).json({ error: err.message });
  }
};
