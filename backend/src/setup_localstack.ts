
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import dotenv from 'dotenv';

dotenv.config();

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.DYNAMO_ENDPOINT || "http://localhost:4566",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "test",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "test"
    }
});

const TABLE_NAME = process.env.DYNAMO_TABLE_NAME || "CanvasStrokes";

async function setupDynamo() {
    console.log(`Checking DynamoDB at ${process.env.DYNAMO_ENDPOINT}...`);

    try {
        const list = await client.send(new ListTablesCommand({}));
        console.log('Existing tables:', list.TableNames);

        if (list.TableNames?.includes(TABLE_NAME)) {
            console.log(`Table ${TABLE_NAME} already exists.`);
            return;
        }

        console.log(`Creating table ${TABLE_NAME}...`);

        await client.send(new CreateTableCommand({
            TableName: TABLE_NAME,
            KeySchema: [
                { AttributeName: "pk", KeyType: "HASH" }, // Partition Key
                { AttributeName: "sk", KeyType: "RANGE" } // Sort Key
            ],
            AttributeDefinitions: [
                { AttributeName: "pk", AttributeType: "S" },
                { AttributeName: "sk", AttributeType: "S" }
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 5,
                WriteCapacityUnits: 5
            }
        }));

        console.log(`Table ${TABLE_NAME} created successfully!`);

    } catch (err) {
        console.error("Error setting up DynamoDB:", err);
        console.log("Ensure LocalStack is running (usually on port 4566).");
    }
}

setupDynamo();
