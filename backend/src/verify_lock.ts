
import { redis } from './redis';

async function testLock() {
    console.log('Testing Lock...');
    try {
        const key = 'test_lock_key';
        await redis.del(key);

        // Test Acquire
        const res1 = await redis.set(key, "1", "EX", 2, "NX");
        console.log('Acquire 1 (should be OK):', res1);

        // Test Re-acquire (should fail)
        const res2 = await redis.set(key, "1", "EX", 2, "NX");
        console.log('Acquire 2 (should be null):', res2);

        if (res1 === 'OK' && res2 === null) {
            console.log('SUCCESS: Locking logic works with current Redis client.');
        } else {
            console.error('FAILURE: Unexpected lock behavior.');
        }

    } catch (err) {
        console.error('ERROR:', err);
    } finally {
        process.exit(0);
    }
}

testLock();
