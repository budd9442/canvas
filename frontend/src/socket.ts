import { io } from 'socket.io-client';

const URL = 'http://localhost:3001';

export const socket = io(URL, {
    autoConnect: false,
    auth: (cb) => {
        const token = localStorage.getItem('token');
        cb({ token });
    }
});
