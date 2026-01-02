const { Client } = require('pg');

const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:mysecretpassword@postgres:5432/canvas_db'
    // Note: This needs to run inside K8s or port-forwarded. 
    // If running from 'tester' folder on host, we might accept an arg.
});

async function main() {
    try {
        await client.connect();
        const res = await client.query("SELECT COUNT(*) FROM strokes WHERE canvas_id='default'");
        console.log(`\n📊 Total Strokes in DB (default): ${res.rows[0].count}`);
    } catch (err) {
        console.error("DB Error:", err);
    } finally {
        await client.end();
    }
}

main();
