import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { createUser, findUserByUsername } from '../models/User';
import { generateToken } from '../utils/jwt';

export const register = async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const user = await createUser(username, password);
        const token = generateToken({ id: user.id, username: user.username, role: user.role });
        res.status(201).json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
};

export const login = async (req: Request, res: Response) => {
    const { username, password } = req.body;

    try {
        const user = await findUserByUsername(username);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
            return res.status(403).json({ error: 'Invalid credentials' });
        }

        const token = generateToken({ id: user.id, username: user.username, role: user.role });
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};
