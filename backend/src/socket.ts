import { Server, Socket } from 'socket.io';
import { redis } from './redis';

// Fabric.js Object (Generic JSON)
type FabricObject = any;

export const setupSocket = (io: Server) => {
    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        socket.on('join_canvas', async (canvasId: string) => {
            socket.join(`canvas:${canvasId}`);

            // Load history
            const objects = await redis.lrange(`canvas:${canvasId}:objects`, 0, -1);
            const parsedObjects = objects.map((s: string) => JSON.parse(s));

            socket.emit('init_canvas', parsedObjects);
        });

        socket.on('draw_stroke', async (data: { canvasId: string; stroke: FabricObject }) => {
            const { canvasId, stroke } = data;

            // Save to Redis (Total Ordering)
            await redis.rpush(`canvas:${canvasId}:objects`, JSON.stringify(stroke));

            // Broadcast to others
            socket.to(`canvas:${canvasId}`).emit('stroke', stroke);
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
