import { verifyToken } from './utils/jwt';
import { saveStrokeToPostgres, getCanvasHistoryFromPostgres, query } from './db';

import { Server, Socket } from 'socket.io';
import { redis } from './redis';

// Fabric.js Object (Generic JSON)
type FabricObject = any;

const acquireLock = async (canvasId: string) => {
    // NX: Set if Not eXists, EX: Expire in 2 seconds
    const res = await redis.set(`lock:${canvasId}`, "1", "EX", 2, "NX");
    return res === "OK";
};

const releaseLock = async (canvasId: string) => {
    await redis.del(`lock:${canvasId}`);
};

// ... (existing helper functions)

export const setupSocket = (io: Server) => {
    // Track Redis State to prevent alert spam
    let isRedisDown = false;
    let recoveryTimeout: NodeJS.Timeout | null = null;

    // Global Redis Error Handling & Broadcast
    redis.on('reconnecting', () => {
        if (recoveryTimeout) {
            clearTimeout(recoveryTimeout);
            recoveryTimeout = null;
        }

        if (!isRedisDown) {
            isRedisDown = true;
            io.emit('error', {
                message: 'System Alert: Database connection lost. Writes may fail.',
                code: 'REDIS_DOWN'
            });
        }
    });

    redis.on('close', () => {
        // Connection closed implies instability
        if (recoveryTimeout) {
            clearTimeout(recoveryTimeout);
            recoveryTimeout = null;
        }
    });

    redis.on('error', (err) => {
        // Any error implies instability, so cancel the recovery timer
        if (recoveryTimeout) {
            clearTimeout(recoveryTimeout);
            recoveryTimeout = null;
        }

        if (err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET')) {
            if (!isRedisDown) {
                isRedisDown = true;
                io.emit('error', {
                    message: 'System Alert: Database connection failed.',
                    code: 'REDIS_ERROR'
                });
            }
        }
    });

    // Use 'ready' instead of 'connect' to ensure Redis is actually usable
    redis.on('ready', () => {
        if (isRedisDown) {
            // Wait for stability before announcing
            if (recoveryTimeout) clearTimeout(recoveryTimeout);
            recoveryTimeout = setTimeout(() => {
                isRedisDown = false;
                io.emit('success', { message: 'System Alert: Database connection restored.', code: 'REDIS_UP' });
                recoveryTimeout = null;
            }, 3000);
        }
    });

    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = verifyToken(token);
            if (decoded && typeof decoded !== 'string' && decoded.id) {
                // Verify user exists in DB (in case of ban/deletion)
                const userResult = await query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);

                if (userResult.rows.length === 0) {
                    console.log(`[Auth] Rejected connection for banned/deleted user: ${decoded.id}`);
                    return next(new Error('User not found or banned'));
                }

                // Attach user info to socket
                socket.data.user = userResult.rows[0];
                next();
            } else {
                next(new Error("Authentication error: Invalid token"));
            }
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        // Immediate Room Join & Admin Notification
        if (socket.data.user) {
            socket.join('global:users');
            socket.join(`user:${socket.data.user.id}`);

            // If user is Admin, join admin room for updates
            if (socket.data.user.role === 'admin') {
                console.log(`Admin connected: ${socket.data.user.username} (${socket.id})`);
                socket.join('admin');
            }

            // Notify Admins (exclude self if needed, but useful for list consistency)
            io.to('admin').emit('admin:user-joined', {
                socketId: socket.id,
                id: socket.data.user.id,
                username: socket.data.user.username,
                role: socket.data.user.role,
                joinedAt: new Date()
            });
        }

        socket.on('join_canvas', async (canvasId: string) => {
            try {
                socket.join(`canvas:${canvasId}`);

                // Load history from DynamoDB
                const parsedObjects = await getCanvasHistoryFromPostgres(canvasId);

                socket.emit('init_canvas', parsedObjects);
            } catch (err) {
                console.error('Error joining canvas:', err);
                socket.emit('error', { message: "Failed to load canvas history", code: "INIT_ERROR" });
            }
        });

        // ... draw_stroke handler ...
        socket.on('draw_stroke', async (data: { canvasId: string; stroke: FabricObject }) => {
            const { canvasId, stroke } = data;

            try {
                const locked = await acquireLock(canvasId);
                if (!locked) {
                    return;
                }

                try {
                    const seq = await redis.incr(`canvas:${canvasId}:sequence`);
                    const orderedStroke = { ...stroke, seq, ts: Date.now() };

                    await saveStrokeToPostgres(canvasId, orderedStroke);

                    socket.to(`canvas:${canvasId}`).emit('stroke', orderedStroke);
                    socket.emit('stroke_ack', { seq: orderedStroke.seq });

                } finally {
                    await releaseLock(canvasId);
                }
            } catch (err) {
                console.error('Error processing stroke:', err);
                socket.emit('error', { message: "Failed to process stroke", code: "WRITE_ERROR" });
            }
        });

        socket.on('clear_canvas', async (canvasId: string) => {
            // Basic role check if data.user provided
            if (socket.data.user?.role !== 'admin') {
                return; // or emit error
            }
            await redis.del(`canvas:${canvasId}:objects`);
            io.to(`canvas:${canvasId}`).emit('clear_canvas');
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            if (socket.data.user) {
                io.to('admin').emit('admin:user-left', { socketId: socket.id, id: socket.data.user.id });
            }
        });
    });
};
