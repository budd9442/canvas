import Redis from 'ioredis';
import dotenv from 'dotenv';
import { EventEmitter } from 'events';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_MOCK_REDIS = process.env.USE_MOCK_REDIS === 'true' || true; // Default to true for now as requested

class MockRedis extends EventEmitter {
    private store: Map<string, any> = new Map();

    constructor() {
        super();
        setTimeout(() => this.emit('connect'), 100);
    }

    async get(key: string) {
        return this.store.get(key) || null;
    }

    async set(key: string, value: any) {
        this.store.set(key, value);
        return 'OK';
    }

    async hset(key: string, value: any) {
        let current = this.store.get(key);
        if (!current) current = {};
        // If value is object, merge it
        if (typeof value === 'object') {
            this.store.set(key, { ...current, ...value });
        } else {
            // Handle arguments like hset(key, field, value) if needed, but our code uses objects
            // For now assuming existing usage: hset(key, object)
            // The User model does: multi.hset(`users:${id}`, user);
            // user is an object.
            this.store.set(key, { ...current, ...value });
        }
        return 1;
    }

    async hgetall(key: string) {
        return this.store.get(key) || {};
    }

    async lrange(key: string, start: number, end: number) {
        const list = this.store.get(key) || [];
        if (end === -1) return list.slice(start);
        return list.slice(start, end + 1);
    }

    async rpush(key: string, value: any) {
        const list = this.store.get(key) || [];
        list.push(value);
        this.store.set(key, list);
        return list.length;
    }

    async del(key: string) {
        return this.store.delete(key) ? 1 : 0;
    }

    multi() {
        const chain: any[] = [];
        const mockMulti = {
            hset: (key: string, value: any) => {
                chain.push(async () => this.hset(key, value));
                return mockMulti;
            },
            set: (key: string, value: any) => {
                chain.push(async () => this.set(key, value));
                return mockMulti;
            },
            exec: async () => {
                for (const fn of chain) {
                    await fn();
                }
                return chain.map(() => [null, 'OK']);
            }
        };
        return mockMulti;
    }
}

// Export a singleton or factory depending on config
export const redis = USE_MOCK_REDIS ? new MockRedis() as unknown as Redis : new Redis(REDIS_URL);
export const pub = USE_MOCK_REDIS ? new MockRedis() as unknown as Redis : new Redis(REDIS_URL);
export const sub = USE_MOCK_REDIS ? new MockRedis() as unknown as Redis : new Redis(REDIS_URL);

if (!USE_MOCK_REDIS) {
    redis.on('connect', () => console.log('Redis connected'));
    redis.on('error', (err) => console.error('Redis Client error:', err));
} else {
    console.log('Mock Redis initialized');
}
