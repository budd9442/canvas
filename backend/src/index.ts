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
app.use('/auth', authRoutes);

import { setupSocket } from './socket';

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Setup Socket Logic
setupSocket(io);

const PORT = process.env.PORT || 3001;

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
