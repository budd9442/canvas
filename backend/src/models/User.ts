import { query } from '../db';
import bcrypt from 'bcryptjs';

export interface User {
    id: number;
    username: string;
    passwordHash: string;
    role: 'viewer' | 'editor' | 'admin';
}

export const createUser = async (username: string, password: string, role: 'viewer' | 'editor' | 'admin' = 'editor'): Promise<User> => {
    // Check if user exists
    const existing = await findUserByUsername(username);
    if (existing) {
        throw new Error('Username already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const res = await query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id, username, password_hash as "passwordHash", role',
        [username, passwordHash, role]
    );

    return res.rows[0];
};

export const findUserByUsername = async (username: string): Promise<User | null> => {
    const res = await query(
        'SELECT id, username, password_hash as "passwordHash", role FROM users WHERE username = $1',
        [username]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
};

export const findUserById = async (id: number): Promise<User | null> => {
    const res = await query(
        'SELECT id, username, password_hash as "passwordHash", role FROM users WHERE id = $1',
        [id]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0];
};
