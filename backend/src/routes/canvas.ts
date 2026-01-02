import { Router } from 'express';
import { query } from '../db';

const router = Router();

// GET /api/canvas/:id/stats
router.get('/:id/stats', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await query('SELECT COUNT(*) FROM strokes WHERE canvas_id = $1', [id]);
        const count = parseInt(result.rows[0].count, 10);
        res.json({ canvasId: id, strokeCount: count });
    } catch (err) {
        console.error('Stats Error:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

export default router;
