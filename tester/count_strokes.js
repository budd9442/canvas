const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/canvas_db';
const pool = new Pool({ connectionString });

async function main() {
    try {
        const res = await pool.query('SELECT count(*) FROM strokes');
        console.log('Total Strokes in DB:', res.rows[0].count);
    } catch (e) {
        if (e.message.includes('database "canvas_db" does not exist')) {
            const pool2 = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/canvas' });
            const res2 = await pool2.query('SELECT count(*) FROM strokes');
            console.log('Total Strokes in DB:', res2.rows[0].count);
            pool2.end();
        } else {
            console.error(e);
        }
    } finally {
        await pool.end();
    }
}
main();
