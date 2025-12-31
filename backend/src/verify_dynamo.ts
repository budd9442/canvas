
import { saveStrokeToDynamo, getCanvasHistoryFromDynamo } from './dynamo';

async function testDynamo() {
    console.log('Testing DynamoDB...');
    try {
        const canvasId = 'test_canvas_123';
        const stroke = { type: 'path', path: [], seq: 1, ts: Date.now() };

        // Test Save
        await saveStrokeToDynamo(canvasId, stroke);

        // Test Get
        const history = await getCanvasHistoryFromDynamo(canvasId);
        console.log('Retrieved history for canvas:', canvasId);
        console.log(JSON.stringify(history, null, 2));

        if (history.length > 0 && history.find((h: any) => h.seq === 1)) {
            console.log('SUCCESS: Stroke saved and retrieved from DynamoDB.');
        } else {
            console.log('WARNING: Stroke not found. Check DynamoDB configuration or region.');
        }

    } catch (err) {
        console.error('ERROR:', err);
    } finally {
        process.exit(0);
    }
}

testDynamo();
