import { db } from '../db/postgres.js';
import { pixelPlacements } from '../db/schema.js';
import { redis } from '../db/redis.js';
import * as os from 'node:os';

const streamName = 'pixel_log';
const consumerGroup = 'pixel-placement-persistence';
const batchSize = 5000; 
const maxBatchWaitMs = 10_000;
//const consumerName = process.env.WORKER_NAME || os.hostname();

export const startPixelPlacementPersistence = async () => {
    const streamRedis = redis.duplicate();
    let batch: {
        streamId: string;
        sequence: number;
        userId: string;
        offset: number;
        color: number;
        placementId: string;
    }[] = [];
    let batchDeadline = 0;
        const consumerName = process.env.WORKER_NAME || os.hostname();
    try {
        try {
            await streamRedis.xgroup('CREATE', streamName, consumerGroup, '0-0', 'MKSTREAM');
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
                throw error;
            }
        }

        //console.log(`[Worker] ${consumerName} listening to ${streamName}...`);

        while (true) {
            if (batch.length === 0) {
                batchDeadline = Date.now() + maxBatchWaitMs;
            }

            const remainingWaitMs = Math.max(1, batchDeadline - Date.now());
            const result = await streamRedis.xreadgroup(
                'GROUP',
                consumerGroup,
                consumerName,
                'COUNT',
                batchSize - batch.length,
                'BLOCK',
                remainingWaitMs,
                'STREAMS',
                streamName,
                '>'
            ) as [string, [string, string[]][]][] | null;

            const flushBatch = async () => {
                if (batch.length === 0) return;
                try {
                    await db.insert(pixelPlacements)
                        .values(batch)
                        .onConflictDoNothing();
                    await streamRedis.xack(
                        streamName,
                        consumerGroup,
                        ...batch.map((placement) => placement.streamId)
                    );
                    await streamRedis.xdel(
                        streamName,
                        ...batch.map((placement) => placement.streamId)
                    );
                } catch (dbErr) {
                    console.error('Failed to flush pixel placements to Postgres (will retry):', dbErr);
                } finally {
                    batch = [];
                }
            };

            if (!result) {
                await flushBatch();
                continue;
            }

            const entries = result[0][1];
            for (const [streamId, fields] of entries) {
                batch.push({
                    streamId,
                    userId: fields[1],
                    offset: Number(fields[3]),
                    color: Number(fields[5]),
                    placementId: fields[7],
                    sequence: Number(fields[9])
                });
            }

            if (batch.length >= batchSize || (Date.now() >= batchDeadline && batch.length > 0)) {
                await flushBatch();
            }
        }
    } catch (error) {
        console.error(`Pixel placement persistence worker error (retrying in 5s):`, error);
        setTimeout(() => {
            void startPixelPlacementPersistence();
        }, 5000);
    }
};