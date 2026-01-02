import { Router, Request, Response } from 'express';
import { authenticateToken, checkRole, AuthRequest } from '../middleware/auth';
import { query } from '../db';

const router = Router();

// Middleware: Authenticate and check for 'admin' role
router.use(authenticateToken, checkRole('admin'));

// GET /api/admin/users - List LIVE users
router.get('/users', async (req: AuthRequest, res: Response) => {
    try {
        const socketIo = req.app.get('io');
        // Fetch sockets from 'global:users' across all nodes
        const sockets = await socketIo.in('global:users').fetchSockets();

        const liveUsers = sockets.map((s: any) => ({
            socketId: s.id,
            id: s.data.user.id,
            username: s.data.user.username,
            role: s.data.user.role,
            joinedAt: s.handshake.time
        }));

        // Remove duplicates if same user connected multiple times? 
        // Or show all sessions? Showing all sessions is useful for admin.

        res.json(liveUsers);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/admin/users/:id/ban - Ban a user
router.post('/users/:id/ban', async (req: AuthRequest, res: Response) => {
    const userId = req.params.id;
    try {
        await query('DELETE FROM users WHERE id = $1', [userId]);

        const socketIo = req.app.get('io');
        if (socketIo) {
            // Emit 'banned' event to the specific user room
            socketIo.to(`user:${userId}`).emit('banned', { message: 'You have been banned by the administrator.' });

            // Force disconnect their sockets with a slight delay to ensure event delivery
            setTimeout(() => {
                socketIo.in(`user:${userId}`).disconnectSockets(true);
            }, 500);
        }

        res.json({ message: 'User banned and disconnected' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

import { redis } from '../redis';

// POST /api/admin/canvas/clear - Clear the canvas
router.post('/canvas/clear', async (req: AuthRequest, res: Response) => {
    try {
        // 1. Clear Permanent Storage
        await query('TRUNCATE TABLE strokes');

        // 2. Clear Redis Cache (Critical for real-time sync on reload)
        // Using flockdb/flushall might be too aggressive if sharing redis, but for this app it's fine.
        // Safer: Delete keys matching pattern if possible, or just flush for this MVP.
        await redis.flushdb();

        // 3. Broadcast clear event
        const socketIo = req.app.get('io');
        if (socketIo) {
            // FIX: Match the event name frontend listens to ('clear_canvas')
            socketIo.emit('clear_canvas');
        }

        res.json({ message: 'Canvas cleared' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/admin/monitor - Get K8s Pod Stats
// We will implement the actual K8s logic in a separate service, but route is here.
import { getPodStats } from '../k8s/monitor';

router.get('/monitor', async (req: AuthRequest, res: Response) => {
    try {
        const stats = await getPodStats();
        res.json(stats);
    } catch (err: any) {
        console.error("Monitor Error", err);
        res.status(500).json({ error: 'Failed to fetch pod stats' });
    }
});

router.get('/monitor/db', async (req: AuthRequest, res: Response) => {
    try {
        const stats = await getPodStats('app=postgres');
        res.json(stats);
    } catch (err: any) {
        console.error("DB Monitor Error", err);
        res.status(500).json({ error: 'Failed to fetch DB pod stats' });
    }
});

export default router;
