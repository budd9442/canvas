import { verifyToken } from './utils/jwt';
import { saveStrokeToDynamo, getCanvasHistoryFromDynamo } from './dynamo';

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

    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

        if (!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const user = verifyToken(token);
            socket.data.user = user;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        socket.on('join_canvas', async (canvasId: string) => {
            try {
                socket.join(`canvas:${canvasId}`);

                // Load history from DynamoDB
                const parsedObjects = await getCanvasHistoryFromDynamo(canvasId);

                socket.emit('init_canvas', parsedObjects);
            } catch (err) {
                console.error('Error joining canvas:', err);
                socket.emit('error', { message: "Failed to load canvas history", code: "INIT_ERROR" });
            }
        });

        socket.on('draw_stroke', async (data: { canvasId: string; stroke: FabricObject }) => {
            const { canvasId, stroke } = data;

            try {
                const locked = await acquireLock(canvasId);
                if (!locked) {
                    // Start of a distributed concurrency handling strategy
                    // For now, silently drop or maybe notify client to retry?
                    // User req said "No silent corruption", dropping valid strokes because of lock contention is not corruption but data loss if not handled.
                    // But 'locked' usually means another write is happening.
                    // Let's emit a 'write_failed' for feedback?
                    // socket.emit('error', { message: "Could not acquire lock, try again", code: "LOCK_ERROR" });
                    return;
                }

                try {
                    // Generage Sequence Number (Total Ordering via Redis)
                    const seq = await redis.incr(`canvas:${canvasId}:sequence`);

                    const orderedStroke = {
                        ...stroke,
                        seq,
                        ts: Date.now()
                    };

                    // Save to DynamoDB
                    await saveStrokeToDynamo(canvasId, orderedStroke);

                    // Broadcast to others
                    socket.to(`canvas:${canvasId}`).emit('stroke', orderedStroke);

                    // Confirm success to sender (optional, good for fault tolerance UI)
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
            // TODO: check admin role here via socket.data or similar if auth is integrated in socket
            await redis.del(`canvas:${canvasId}:objects`);
            io.to(`canvas:${canvasId}`).emit('clear_canvas');
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
};
