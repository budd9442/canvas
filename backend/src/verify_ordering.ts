
import { redis } from './redis';

async function testOrdering() {
    console.log('Testing Ordering...');
    try {
        const canvasId = "test_ordering_canvas";
        await redis.del(`canvas:${canvasId}:objects`);
        await redis.del(`canvas:${canvasId}:sequence`);

        // Simulate Logic (Sequence + Storage)
        // We can't easily invoke socket handler directly without mocking, 
        // so we replicate the logic here to verify Redis behavior.

        for (let i = 0; i < 3; i++) {
            const seq = await redis.incr(`canvas:${canvasId}:sequence`);
            const stroke = { type: 'path', path: [], seq, ts: Date.now() };
            await redis.rpush(`canvas:${canvasId}:objects`, JSON.stringify(stroke));
            console.log(`Stored stroke ${i + 1} with seq: ${seq}`);
        }

        const objects = await redis.lrange(`canvas:${canvasId}:objects`, 0, -1);
        const parsed = objects.map(s => JSON.parse(s));

        console.log('Retrieved objects:', parsed);

        if (parsed.length === 3 && parsed[0].seq === 1 && parsed[2].seq === 3) {
            console.log('SUCCESS: Sequence numbers are correct and incrementing.');
        } else {
            console.error('FAILURE: Sequence numbers mismatch.');
        }

    } catch (err) {
        console.error('ERROR:', err);
    } finally {
        process.exit(0);
    }
}

testOrdering();
