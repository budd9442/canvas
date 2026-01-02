import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
// import { initRedis } from './redis'; // TODO: Implement

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

import authRoutes from './routes/auth';
app.use('/api/auth', authRoutes);

import adminRoutes from './routes/admin';
app.use('/api/admin', adminRoutes);

import canvasRoutes from './routes/canvas';
app.use('/api/canvas', canvasRoutes);

import { setupSocket } from './socket';

import { createAdapter } from '@socket.io/redis-adapter';
import { pub, sub } from './redis';
import { setupMonitor } from './k8s/monitor';

const httpServer = createServer(app);
const io = new Server(httpServer, {
    adapter: createAdapter(pub, sub),
    maxHttpBufferSize: 1e8, // 100 MB
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Share io instance with routes
app.set('io', io);

// Setup Socket Logic
setupSocket(io);

// Setup K8s Monitor
setupMonitor(io);

const PORT = process.env.PORT || 3001;

app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// io.on connection handled in socket.ts

const server = httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful Shutdown for K8s
process.on('SIGTERM', () => {
    console.log('SIGTERM received: closing HTTP server...');

    // 1. Stop accepting new connections
    server.close(() => {
        console.log('HTTP server closed.');
    });

    // 2. Allow existing sockets to finish processing (Drain)
    // In a high-load system, we give 10 seconds for the Event Loop to clear
    // pending Redis writes (XADD).
    setTimeout(() => {
        console.log('Draining finished. Exiting.');
        process.exit(0);
    }, 10000); // 10s drain
});
