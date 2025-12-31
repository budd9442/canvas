
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import dotenv from 'dotenv';

dotenv.config();

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.DYNAMO_TABLE_NAME || "CanvasStrokes";

// Check if we are using a local DynamoDB (e.g. Docker)
const ENDPOINT = process.env.DYNAMO_ENDPOINT;

const client = new DynamoDBClient({
    region: REGION,
    ...(ENDPOINT && { endpoint: ENDPOINT })
});

const docClient = DynamoDBDocumentClient.from(client);

export const saveStrokeToDynamo = async (canvasId: string, stroke: any) => {
    const command = new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            pk: `canvas:${canvasId}`,
            sk: `stroke:${String(stroke.seq).padStart(12, '0')}`, // Pad for string sorting if SK is string
            ...stroke
        }
    });

    try {
        await docClient.send(command);
        console.log(`Saved stroke ${stroke.seq} to DynamoDB`);
    } catch (err) {
        console.error("DynamoDB Write Error:", err);
        // don't crash, just log - maybe add retry queue later
    }
};

export const getCanvasHistoryFromDynamo = async (canvasId: string) => {
    const command = new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: {
            ":pk": `canvas:${canvasId}`
        }
    });

    try {
        const response = await docClient.send(command);
        return response.Items || [];
    } catch (err) {
        console.error("DynamoDB Query Error:", err);
        return [];
    }
};
