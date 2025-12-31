
import { io } from 'socket.io-client';
import { generateToken } from './utils/jwt';

async function testSocketAuth() {
    console.log('Testing Socket Auth...');

    const PORT = process.env.PORT || 3001;
    const url = `http://localhost:${PORT}`;

    // Test 1: No Token
    console.log('Test 1: Connecting without token...');
    const socketNoAuth = io(url, { autoConnect: false, reconnection: false });

    await new Promise<void>((resolve) => {
        socketNoAuth.on('connect_error', (err) => {
            console.log('Expected error (No Token):', err.message);
            resolve();
        });
        socketNoAuth.on('connect', () => {
            console.error('FAILURE: Connected without token!');
            socketNoAuth.disconnect();
            resolve();
        });
        socketNoAuth.connect();
    });

    // Test 2: Valid Token
    console.log('Test 2: Connecting with valid token...');
    const token = generateToken({ id: 'user1', username: 'tester' });
    const socketAuth = io(url, {
        auth: { token },
        autoConnect: false,
        reconnection: false
    });

    await new Promise<void>((resolve) => {
        socketAuth.on('connect', () => {
            console.log('SUCCESS: Connected with valid token.');
            socketAuth.disconnect();
            resolve();
        });
        socketAuth.on('connect_error', (err) => {
            console.error('FAILURE: Could not connect with valid token:', err.message);
            resolve();
        });
        socketAuth.connect();
    });

    process.exit(0);
}

testSocketAuth();
