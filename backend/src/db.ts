import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/canvas_db',
});

// Ensure the strokes table exists
const initDb = async () => {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS strokes (
                id SERIAL PRIMARY KEY,
                canvas_id VARCHAR(255) NOT NULL,
                stroke_limit INT NOT NULL,  -- using stroke_limit to store 'seq' for ordering, renaming might be better but keeping simple for now
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_canvas_id_seq ON strokes(canvas_id, stroke_limit);
        `);
        console.log('Database initialized successfully.');
    } catch (err) {
        console.error('Error initializing database:', err);
    } finally {
        client.release();
    }
};

// Initialize on start
initDb();

export const query = (text: string, params?: any[]) => pool.query(text, params);

export const saveStrokeToPostgres = async (canvasId: string, stroke: any) => {
    try {
        await query(
            'INSERT INTO strokes (canvas_id, stroke_limit, data) VALUES ($1, $2, $3)',
            [canvasId, stroke.seq, stroke]
        );
        console.log(`Saved stroke ${stroke.seq} to Postgres`);
    } catch (err) {
        console.error('Postgres Write Error:', err);
    }
};

export const getCanvasHistoryFromPostgres = async (canvasId: string) => {
    try {
        const res = await query(
            'SELECT data FROM strokes WHERE canvas_id = $1 ORDER BY stroke_limit ASC',
            [canvasId]
        );
        return res.rows.map(row => row.data);
    } catch (err) {
        console.error('Postgres Query Error:', err);
        return [];
    }
};
