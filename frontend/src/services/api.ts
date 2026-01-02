import axios from 'axios';

// Create an instance of axios with default configuration
export const api = axios.create({
    baseURL: '/api', // Proxy in vite config or nginx handles this
    headers: {
        'Content-Type': 'application/json',
    },
});

// Add interceptors if needed (e.g. for auth token)
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

export default api;
