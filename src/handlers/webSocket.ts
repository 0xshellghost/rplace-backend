import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { broadcast } from '../utilities/broadcast.js';
import { canvas } from '../utilities/canvas.js';
import { getRateLimit } from '../utilities/rateLimit.js';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../config/canvas.js';

const BINARY_PLACEMENT_BYTES = 9;

const encodePixelUpdate = (x: number, y: number, color: number, seq: number) => {
    const payload = Buffer.alloc(BINARY_PLACEMENT_BYTES);
    payload.writeUInt16LE(x, 0);
    payload.writeUInt16LE(y, 2);
    payload.writeUInt8(color, 4);
    payload.writeUInt32LE(seq, 5);
    return payload;
};

export const handleMessage = async (
    socket: WebSocket,
    message: Buffer,
    userId: string,
    getPRPoints: (userId: string) => Promise<number>
) => {
    try {
        let data: { type: string; x: number; y: number; color: number; placementId?: string };
        ;
        if (message.length === BINARY_PLACEMENT_BYTES) {
            data = {
                type: 'PLACE_PIXEL',
                x: message.readUInt16LE(0),
                y: message.readUInt16LE(2),
                color: message.readUInt8(4),
                placementId: String(message.readUInt32LE(5))
            };
        } else {
            data = JSON.parse(message.toString());
        }

        if (data.type === 'PLACE_PIXEL') {
            if (
                !Number.isInteger(data.x) || data.x < 0 || data.x >= CANVAS_WIDTH ||
                !Number.isInteger(data.y) || data.y < 0 || data.y >= CANVAS_HEIGHT ||
                !Number.isInteger(data.color) || data.color < 0 || data.color > 15
            ) {
                socket.send(JSON.stringify({ type: 'ERROR', error: 'INVALID_PIXEL' }));
                return;
            }

            
            
            const prPoints = await getPRPoints(userId);
            const { maxPixels, cooldown } = getRateLimit(prPoints);
            //console.log(`User ${userId} has rate limit: ${maxPixels} pixels, ${cooldown} second cooldown`);
            const placementId = data.placementId || randomUUID();
            
            const result = await canvas.placePixel(
                userId,
                data.x,
                data.y,
                data.color,
                placementId,
                maxPixels,
                cooldown
            );



            if (!result.success) {
                socket.send(JSON.stringify({
                    type: 'ERROR',
                    error: result.error,
                    ...(result.ttl !== undefined ? { ttl: result.ttl } : {})
                }));
                return;
            }

            broadcast(encodePixelUpdate(data.x, data.y, data.color, result.seq));
            socket.send(JSON.stringify({
                type: 'PLACED',
                remaining: result.remaining
            }));
        }
    } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown placement error';
        console.error(`[USER: ${userId}] Failed to place pixel: ${error}`);
        socket.send(JSON.stringify({ type: 'ERROR', error: 'PLACEMENT_FAILED', message: error }));
    }
};