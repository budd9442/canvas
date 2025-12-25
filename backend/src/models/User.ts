import { redis } from '../redis';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export interface User {
    id: string;
    username: string;
    passwordHash: string;
    role: 'viewer' | 'editor' | 'admin';
}

export const createUser = async (username: string, password: string, role: 'viewer' | 'editor' | 'admin' = 'editor'): Promise<User> => {
    const existingId = await redis.get(`username:${username}`);
    if (existingId) {
        throw new Error('Username already exists');
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);

    const user: User = { id, username, passwordHash, role };

    // Transaction to save user and username mapping
    const multi = redis.multi();
    multi.hset(`users:${id}`, user);
    multi.set(`username:${username}`, id);
    await multi.exec();

    return user;
};

export const findUserByUsername = async (username: string): Promise<User | null> => {
    const id = await redis.get(`username:${username}`);
    if (!id) return null;
    return findUserById(id);
};

export const findUserById = async (id: string): Promise<User | null> => {
    const user = await redis.hgetall(`users:${id}`);
    if (!user || !user.id) return null;
    return user as unknown as User;
};
