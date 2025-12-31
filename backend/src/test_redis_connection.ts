
import { redis } from './redis';

async function testConnection() {
    console.log('Testing Redis Connection...');
    try {
        await redis.set('test_key', 'Hello Real Redis');
        const value = await redis.get('test_key');
        console.log('Got value from Redis:', value);
        if (value === 'Hello Real Redis') {
            console.log('SUCCESS: Connected to Real Redis and operations work.');
        } else {
            console.error('FAILURE: Value mismatch.');
        }
        process.exit(0);
    } catch (error) {
        console.error('ERROR: Could not connect or operate on Redis:', error);
        process.exit(1);
    }
}

testConnection();
