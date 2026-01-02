const { Pool } = require('pg');

// Try to detect URL or default to localhost
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/canvas_db';

const pool = new Pool({ connectionString });

async function main() {
    try {
        console.log('Connecting to:', connectionString);
        await pool.query('TRUNCATE TABLE strokes');
        console.log('✅ Strokes table truncated.');
    } catch (e) {
        console.error('❌ Error:', e.message);
        if (e.message.includes('database "canvas_db" does not exist')) {
            console.log('Trying "canvas"...');
            const pool2 = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/canvas' });
            await pool2.query('TRUNCATE TABLE strokes');
            console.log('✅ Strokes table truncated (canvas).');
            pool2.end();
        }
    } finally {
        await pool.end();
    }
}
main();
