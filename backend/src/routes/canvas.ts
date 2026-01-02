import { Router } from 'express';
import { getCanvasTotalStrokes } from '../db';

const router = Router();

// GET /api/canvas/:id/stats
router.get('/:id/stats', async (req, res) => {
    const { id } = req.params;
    try {
        const count = await getCanvasTotalStrokes(id);
        res.json({ canvasId: id, strokeCount: count });
    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

export default router;
