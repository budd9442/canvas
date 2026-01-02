import { verifyToken } from './utils/jwt';
import { saveStrokeToPostgres, getCanvasHistoryFromPostgres, query, saveStrokesBatch, clearCanvasStrokes } from './db';

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

// Batching via Redis Streams (WAL)
const BATCH_INTERVAL = 100; // ms

export const setupSocket = (io: Server) => {
    // Track Redis State
    let isRedisDown = false;
    let recoveryTimeout: NodeJS.Timeout | null = null;

    // WORKER LOOP: Peak-Lock-Trim Pattern (At-Least-Once Delivery)
    const flush = async () => {
        try {
            // 1. Get Processing Candidates
            const sMembersRaw = await redis.smembers('active_canvases');
            const activeCanvases = Array.isArray(sMembersRaw) ? sMembersRaw : [];

            if (activeCanvases.length > 0) {
                const promises = activeCanvases.map(async (canvasId) => {
                    const lockKey = `lock:worker:${canvasId}`;
                    const streamKey = `stream:canvas:${canvasId}`;

                    // 2. Acquire Lock (Concurrency Control)
                    // Only one worker should process a specific canvas queue at a time
                    const tempLock = await redis.set(lockKey, "1", "EX", 5, "NX");

                    if (tempLock !== "OK") {
                        return; // Another worker is handling this canvas
                    }

                    try {
                        // 3. XRANGE (Peek Items)
                        // Read up to 50 items from the beginning of the stream
                        // @ts-ignore
                        const streamEntries = await redis.xrange(streamKey, '-', '+', 'COUNT', 50);

                        // streamEntries format: [[id, [key, val, key, val]], ...]

                        if (streamEntries && streamEntries.length > 0) {
                            const strokesToSave: any[] = [];
                            const connectionIds: string[] = [];

                            streamEntries.forEach((entry: any) => {
                                const id = entry[0];
                                const fields = entry[1];
                                // Parse fields (array of strings)
                                // fields: ['stroke', '{"..."}']
                                for (let i = 0; i < fields.length; i += 2) {
                                    if (fields[i] === 'stroke') {
                                        strokesToSave.push(JSON.parse(fields[i + 1]));
                                        connectionIds.push(id);
                                    }
                                }
                            });

                            if (strokesToSave.length > 0) {
                                // 4. PROCESS (Idempotent Insert)
                                const success = await saveStrokesBatch(canvasId, strokesToSave);

                                if (success) {
                                    // 5. TRIM (Remove processed items)
                                    // XDEL the specific IDs we processed.
                                    // @ts-ignore
                                    await redis.xdel(streamKey, ...connectionIds);

                                    // Broadcast
                                    io.to(`canvas:${canvasId}`).emit('batch_strokes', strokesToSave);
                                } else {
                                    console.warn(`[StreamWorker] DB Write Failed for ${canvasId}. Retrying next tick.`);
                                }
                            }
                        } else {
                            // Empty Stream? Remove from active set
                            // @ts-ignore
                            const len = await redis.xlen(streamKey);
                            if (len === 0) {
                                await redis.srem('active_canvases', canvasId);
                            }
                        }
                    } catch (err) {
                        console.error(`[StreamWorker] Error processing ${canvasId}:`, err);
                    } finally {
                        // 6. Release Lock
                        await redis.del(lockKey);
                    }
                });
                await Promise.all(promises);
            }
        } catch (err) {
            console.error("Worker Loop Error:", err);
        }

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

                // REDIS STREAM (WAL)
                // 1. Add to processing set
                await redis.sadd('active_canvases', canvasId);

                // 2. XADD to Stream
                // key: stream:canvas:{id}, ID: *, fields: stroke, json
                // @ts-ignore
                await redis.xadd(`stream:canvas:${canvasId}`, '*', 'stroke', JSON.stringify(orderedStroke));

                // ACK sending client immediately (Include client-side tempId if provided)
                socket.emit('stroke_ack', { seq: orderedStroke.seq, tempId: stroke.tempId });
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
            await clearCanvasStrokes(canvasId); // Distributed Delete
            io.to(`canvas:${canvasId}`).emit('clear_canvas');
        });

        socket.on('disconnect', () => {
            if (socket.data.user) {
                io.to('admin').emit('admin:user-left', { socketId: socket.id, id: socket.data.user.id });
            }
        });
    });
};
