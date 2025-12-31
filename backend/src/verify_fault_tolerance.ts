
import { io } from 'socket.io-client';
import { generateToken } from './utils/jwt';

async function verifyFaultTolerance() {
    console.log('Testing Fault Tolerance Mechanisms...');

    const PORT = process.env.PORT || 3001;
    const url = `http://localhost:${PORT}`;

    const token = generateToken({ id: 'ft_user', username: 'fault_tester' });
    const socket = io(url, {
        auth: { token },
        reconnection: false
    });

    const canvasId = 'ft_canvas';

    socket.on('connect', () => {
        console.log('Connected.');
        socket.emit('join_canvas', canvasId);
    });

    socket.on('init_canvas', (history) => {
        console.log(`Initialized with ${history.length} strokes.`);

        // Send a stroke
        const stroke = { type: 'path', path: [], color: 'red' };
        console.log('Sending stroke...');
        socket.emit('draw_stroke', { canvasId, stroke });
    });

    socket.on('stroke_ack', (data) => {
        console.log('SUCCESS: Received stroke_ack with seq:', data.seq);
        console.log('This confirms the server is processing writes and sending feedback.');
        socket.disconnect();
        process.exit(0);
    });

    socket.on('error', (err) => {
        console.error('Received ERROR from server:', err);
        socket.disconnect();
        process.exit(1);
    });

    // Timeout if no ack
    setTimeout(() => {
        console.error('TIMEOUT: Did not receive ack or error.');
        socket.disconnect();
        process.exit(1);
    }, 5000);
}

verifyFaultTolerance();
