import { verifyToken } from './utils/jwt';
import { saveStrokeToPostgres, getCanvasHistoryFromPostgres, query, saveStrokesBatch } from './db';

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

// Batching State
interface BatchBuffer {
    [canvasId: string]: any[];
}
const batchBuffer: BatchBuffer = {};
const BATCH_INTERVAL = 100; // ms

export const setupSocket = (io: Server) => {
    // Track Redis State
    let isRedisDown = false;
    let recoveryTimeout: NodeJS.Timeout | null = null;

    // START BATCH LOOP
    // START BATCH LOOP
    const flush = async () => {
        const promises = Object.keys(batchBuffer).map(async (canvasId) => {
            const strokes = batchBuffer[canvasId];
            if (strokes && strokes.length > 0) {
                // Snapshot the current strokes to save
                const strokesToSave = [...strokes];

                // 1. Persistence (wait for success)
                const success = await saveStrokesBatch(canvasId, strokesToSave);

                if (success) {
                    // 2. Broadcast (could be done optimistically before save, but here we do it after to be safe? 
                    // No, existing code did it here. Keeping order.)
                    io.to(`canvas:${canvasId}`).emit('batch_strokes', strokesToSave);

                    // 3. Clear JUST the saved strokes
                    // We must be careful if new strokes were added while we were saving.
                    // Since JS is single-threaded, `batchBuffer[canvasId]` might have grown.
                    // We only want to remove the ones we saved.

                    // Optimization: If the buffer length is exactly what we saved, we can just delete/clear.
                    if (batchBuffer[canvasId].length === strokesToSave.length) {
                        delete batchBuffer[canvasId];
                    } else {
                        // Remove the first N items
                        batchBuffer[canvasId].splice(0, strokesToSave.length);
                    }
                } else {
                    console.warn(`Failed to save batch for ${canvasId}, retrying next tick...`);
                }
            }
        });

        await Promise.all(promises);
        setTimeout(flush, BATCH_INTERVAL);
    };

    // Start the loop
    flush();

    // Redis Error Listeners
    redis.on('reconnecting', () => { if (recoveryTimeout) { clearTimeout(recoveryTimeout); recoveryTimeout = null; } if (!isRedisDown) { isRedisDown = true; io.emit('error', { message: 'System Alert: DB Lost', code: 'REDIS_DOWN' }); } });
    redis.on('close', () => { if (recoveryTimeout) clearTimeout(recoveryTimeout); });
    redis.on('error', (err) => { if (recoveryTimeout) clearTimeout(recoveryTimeout); if (err.message.includes('ECONN')) { if (!isRedisDown) { isRedisDown = true; io.emit('error', { message: 'System Alert: DB Failed', code: 'REDIS_ERROR' }); } } });
    redis.on('ready', () => { if (isRedisDown) { if (recoveryTimeout) clearTimeout(recoveryTimeout); recoveryTimeout = setTimeout(() => { isRedisDown = false; io.emit('success', { message: 'System Alert: DB Restored', code: 'REDIS_UP' }); }, 3000); } });

    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        if (!token) return next(new Error('Authentication error: No token provided'));
        try {
            const decoded = verifyToken(token);
            if (decoded && typeof decoded !== 'string' && decoded.id) {
                const userResult = await query('SELECT id, username, role FROM users WHERE id = $1', [decoded.id]);
                if (userResult.rows.length === 0) return next(new Error('User not found or banned'));
                socket.data.user = userResult.rows[0];
                next();
            } else { next(new Error("Authentication error: Invalid token")); }
        } catch (err) { next(new Error('Authentication error: Invalid token')); }
    });

    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        if (socket.data.user) {
            socket.join('global:users');
            socket.join(`user:${socket.data.user.id}`);
            if (socket.data.user.role === 'admin') {
                socket.join('admin');
            }
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

                // Fetch ALL strokes
                const allStrokes = await getCanvasHistoryFromPostgres(canvasId);
                const total = allStrokes.length;

                // 1. Alert Start
                socket.emit('init_canvas_start', { total });

                if (total === 0) {
                    socket.emit('init_canvas_end');
                    return;
                }

                // 2. Stream Chunks (non-blocking)
                const CHUNK_SIZE = 5000;
                let processed = 0;

                const sendChunk = () => {
                    if (processed >= total) {
                        socket.emit('init_canvas_end');
                        return;
                    }

                    const chunk = allStrokes.slice(processed, processed + CHUNK_SIZE);
                    socket.emit('init_canvas_chunk', chunk);
                    processed += CHUNK_SIZE;

                    // Yield to event loop
                    setImmediate(sendChunk);
                };

                sendChunk();

            } catch (err) {
                console.error("Join Error:", err);
                socket.emit('error', { message: "Failed to load canvas history", code: "INIT_ERROR" });
            }
        });

        socket.on('draw_stroke', async (data: { canvasId: string; stroke: FabricObject }) => {
            console.log(`[TRACE] Received draw_stroke from ${socket.id}`, data.canvasId);
            const { canvasId, stroke } = data;
            try {
                // ATOMIC SEQ (No Lock)
                const seq = await redis.incr(`canvas:${canvasId}:sequence`);

                // Attach senderSocketId to filter on frontend
                // @ts-ignore
                const orderedStroke = { ...stroke, seq, ts: Date.now(), senderSocketId: socket.id };

                // BATCH BUFFERING ONLY
                if (!batchBuffer[canvasId]) {
                    batchBuffer[canvasId] = [];
                }
                batchBuffer[canvasId].push(orderedStroke);

                // ACK sending client immediately
                socket.emit('stroke_ack', { seq: orderedStroke.seq });
                console.log(`Sending ACK to ${socket.id} for seq ${orderedStroke.seq}`);

            } catch (err) {
                console.error('Error processing stroke:', err);
                socket.emit('error', { message: "Failed to process stroke", code: "WRITE_ERROR" });
            }
        });

        socket.on('clear_canvas', async (canvasId: string) => {
            if (socket.data.user?.role !== 'admin') return;
            await redis.del(`canvas:${canvasId}:objects`);
            await redis.del(`canvas:${canvasId}:sequence`); // Reset seq? Optional.
            await query('DELETE FROM strokes WHERE canvas_id = $1', [canvasId]); // Hard Delete
            io.to(`canvas:${canvasId}`).emit('clear_canvas');
        });

        socket.on('disconnect', () => {
            if (socket.data.user) {
                io.to('admin').emit('admin:user-left', { socketId: socket.id, id: socket.data.user.id });
            }
        });
    });
};
