
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

const STROKES_TABLE = `
CREATE TABLE IF NOT EXISTS strokes (
    canvas_id VARCHAR(255) NOT NULL,
    stroke_id VARCHAR(255) NOT NULL,
    stroke_data JSONB NOT NULL,
    seq SERIAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (canvas_id, stroke_id)
);
`;

const USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export const initDB = async () => {
    try {
        await pool.query(STROKES_TABLE);
        await pool.query(USERS_TABLE);
        console.log('Database initialized: strokes and users tables ready.');
        await initUsers();
    } catch (err) {
        console.error('Error initializing database:', err);
    }
};

import bcrypt from 'bcryptjs';

const initUsers = async () => {
    try {
        const res = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (res.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await pool.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', ['admin', hashedPassword, 'admin']);
            console.log('Default admin user created.');
        }
    } catch (err) {
        console.error('Error creating default admin:', err);
    }
};

// Initialize on start
initDB();

export const saveStrokeToPostgres = async (canvasId: string, stroke: any) => {
    const text = 'INSERT INTO strokes(canvas_id, stroke_id, stroke_data, seq) VALUES($1, $2, $3, $4) RETURNING *';
    const values = [canvasId, `stroke:${stroke.seq}`, JSON.stringify(stroke), stroke.seq];

    try {
        await pool.query(text, values);
    } catch (err) {
        console.error('Postgres Write Error:', err);
    }
};

export const getCanvasHistoryFromPostgres = async (canvasId: string) => {
    const text = 'SELECT stroke_data FROM strokes WHERE canvas_id = $1 ORDER BY seq ASC';
    const values = [canvasId];

    try {
        const res = await pool.query(text, values);
        return res.rows.map(row => row.stroke_data);
    } catch (err) {
        console.error('Postgres Query Error:', err);
        return [];
    }
};
