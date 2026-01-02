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

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
