
import { Pool } from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

// --- Distributed Configuration ---
let shards: string[] = [];

if (process.env.DB_SHARDS) {
    try {
        shards = JSON.parse(process.env.DB_SHARDS);
    } catch (e) {
        console.error("Failed to parse DB_SHARDS JSON:", e);
    }
}

// Fallback for local development or legacy config
if (shards.length === 0 && process.env.DATABASE_URL) {
    shards = [process.env.DATABASE_URL];
}

if (shards.length === 0) {
    console.error("❌ No Database Configuration Found (DB_SHARDS or DATABASE_URL).");
    process.exit(1);
}

console.log(`🔌 Initializing ${shards.length} Database Shards...`);

const pools = shards.map((connString, idx) => {
    const pool = new Pool({ connectionString: connString });
    pool.on('error', (err) => {
        console.error(`❌ Unexpected error on idle client for Shard ${idx}:`, err);
        // Don't exit process; pg will attempt to reconnect
    });
    return pool;
});

// Helper: Get Primary Shard (Shard 0) for global tables like Users
const getPrimaryShard = () => pools[0];

// Helper: Get Shard for a specific Sequence Number (Round Robin)
const getShardForSeq = (seq: number) => {
    return pools[seq % pools.length];
};

// --- Schema Definitions ---

const STROKES_TABLE = `
CREATE TABLE IF NOT EXISTS strokes (
    canvas_id VARCHAR(255) NOT NULL,
    stroke_id VARCHAR(255) NOT NULL,
    stroke_data JSONB NOT NULL,
    seq INTEGER NOT NULL,
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

// --- Initialization ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const initDB = async (retries = 5) => {
    while (retries > 0) {
        try {
            // Init Strokes table on ALL shards
            const strokePromises = pools.map((pool, idx) =>
                pool.query(STROKES_TABLE)
                    .then(() => console.log(`✅ Shard ${idx} initialized (strokes)`))
            );
            await Promise.all(strokePromises);

            // Init Users table ONLY on Primary Shard
            await getPrimaryShard().query(USERS_TABLE);
            console.log('✅ Primary Shard initialized (users)');

            await initUsers();
            console.log('🚀 Database Fully Initialized');
            return;
        } catch (err: any) {
            console.error(`❌ Error initializing database (Retries left: ${retries}):`, err.message);
            retries--;
            await sleep(3000); // Wait 3 seconds before retry
        }
    }
    console.error('💀 Failed to initialize database after multiple attempts.');
};

const initUsers = async () => {
    try {
        const primary = getPrimaryShard();
        const res = await primary.query('SELECT * FROM users WHERE username = $1', ['admin']);
        if (res.rows.length === 0) {
            const hashedPassword = await bcrypt.hash('admin', 10);
            await primary.query('INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)', ['admin', hashedPassword, 'admin']);
            console.log('Default admin user created on Primary.');
        }
    } catch (err) {
        console.error('Error creating default admin:', err);
    }
};

// Initialize on start
initDB();

// --- Data Access Layer ---

// Generic query (Defaults to Primary Shard - use with caution)
export const query = (text: string, params?: any[]) => getPrimaryShard().query(text, params);

export const saveStrokeToPostgres = async (canvasId: string, stroke: any) => {
    const shard = getShardForSeq(stroke.seq);
    const text = 'INSERT INTO strokes(canvas_id, stroke_id, stroke_data, seq) VALUES($1, $2, $3, $4) RETURNING *';
    const values = [canvasId, `stroke:${stroke.seq}`, JSON.stringify(stroke), stroke.seq];

    try {
        await shard.query(text, values);
    } catch (err) {
        console.error('Postgres Write Error (Shard):', err);
    }
};

// Distributed Scatter-Gather Read
export const getCanvasHistoryFromPostgres = async (canvasId: string) => {
    try {
        const text = 'SELECT stroke_data, seq FROM strokes WHERE canvas_id = $1';
        const values = [canvasId];

        // 1. Scatter: Query ALL shards in parallel
        const shardPromises = pools.map(pool => pool.query(text, values));
        const results = await Promise.all(shardPromises);

        // 2. Gather: Merge all rows
        let allRows: any[] = [];
        results.forEach(res => {
            allRows = allRows.concat(res.rows);
        });

        // 3. Sort by Global Sequence
        allRows.sort((a, b) => a.seq - b.seq);

        return allRows.map(row => row.stroke_data);
    } catch (err) {
        console.error('Postgres Distributed Query Error:', err);
        return [];
    }
};

export const saveStrokesBatch = async (canvasId: string, strokes: any[]): Promise<boolean> => {
    if (strokes.length === 0) return true;

    // Group strokes by Shard
    const strokesByShard = new Map<number, any[]>();

    strokes.forEach(stroke => {
        const shardIdx = stroke.seq % pools.length;
        if (!strokesByShard.has(shardIdx)) strokesByShard.set(shardIdx, []);
        strokesByShard.get(shardIdx)!.push(stroke);
    });

    // Execute Batch Insert per Shard
    const promises = Array.from(strokesByShard.entries()).map(async ([shardIdx, shardStrokes]) => {
        const pool = pools[shardIdx];

        const values: any[] = [];
        let placeholders: string[] = [];
        let counter = 1;

        shardStrokes.forEach(stroke => {
            values.push(canvasId, `stroke:${stroke.seq}`, JSON.stringify(stroke), stroke.seq);
            placeholders.push(`($${counter++}, $${counter++}, $${counter++}, $${counter++})`);
        });

        const text = `
            INSERT INTO strokes(canvas_id, stroke_id, stroke_data, seq) 
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (canvas_id, stroke_id) DO NOTHING
        `;

        try {
            await pool.query(text, values);
            return true;
        } catch (err) {
            console.error(`Shard ${shardIdx} Batch Write Error:`, err);
            return false;
        }
    });

    const results = await Promise.all(promises);
    return results.every(res => res === true);
};

// --- Monitoring ---

export const getShardCounts = async () => {
    const promises = pools.map(async (pool, idx) => {
        try {
            // Simply identifying by shard index.
            // In k8s, shard 0 usually maps to postgres-0, etc.
            const res = await pool.query('SELECT count(*) FROM strokes');
            return {
                shardId: idx,
                count: parseInt(res.rows[0].count, 10),
                podNameSuggestion: `postgres-${idx}` // Heuristic for UI matching
            };
        } catch (err) {
            console.error(`Error querying stats for shard ${idx}:`, err);
            return { shardId: idx, count: -1, podNameSuggestion: `postgres-${idx}` };
        }
    });

    return Promise.all(promises);
};

export const getCanvasTotalStrokes = async (canvasId: string) => {
    const promises = pools.map(async (pool) => {
        try {
            const res = await pool.query('SELECT count(*) FROM strokes WHERE canvas_id = $1', [canvasId]);
            return parseInt(res.rows[0].count, 10);
        } catch (err) {
            console.error('Error counting strokes on shard:', err);
            return 0;
        }
    });

    const counts = await Promise.all(promises);
    return counts.reduce((a, b) => a + b, 0);
};

export const clearCanvasStrokes = async (canvasId: string) => {
    const promises = pools.map(pool =>
        pool.query('DELETE FROM strokes WHERE canvas_id = $1', [canvasId])
    );
    await Promise.all(promises);
};
