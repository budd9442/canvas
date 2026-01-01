import { io } from 'socket.io-client';

const URL = undefined;

export const socket = io(URL, {
    autoConnect: false,
    transports: ['websocket'],
    auth: (cb) => {
        const token = localStorage.getItem('token');
        cb({ token });
    }
});
