
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

export const initDB = async () => {
    try {
        await pool.query(STROKES_TABLE);
        console.log('Database initialized: strokes table ready.');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
};

// Initialize on start
initDB();

export const saveStrokeToPostgres = async (canvasId: string, stroke: any) => {
    const text = 'INSERT INTO strokes(canvas_id, stroke_id, stroke_data, seq) VALUES($1, $2, $3, $4) RETURNING *';
    // Use stroke.seq if provided (from Redis), otherwise let Postgres generate it?
    // Actually, we are using Redis for global ordering (seq). We should probably store that seq.
    // However, the table schema I proposed above has `seq SERIAL`. If we want to use Redis seq, we should remove SERIAL or override it.
    // Let's adjust schema to just `seq BIGINT`.
    const values = [canvasId, `stroke:${stroke.seq}`, JSON.stringify(stroke), stroke.seq];

    try {
        await pool.query(text, values);
        // console.log(`Saved stroke ${stroke.seq} to Postgres`);
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
