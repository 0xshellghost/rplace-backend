import 'dotenv/config';
import { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { activeClients } from '../utilities/broadcast.js';
import { handleMessage } from '../handlers/webSocket.js';
import { getRateLimit } from '../utilities/rateLimit.js';

const fetchPRPoints = async (participantId: string): Promise<number> => {
    try {
        const backendUrl = process.env.GH_BACKEND_URL;
        if (!backendUrl) return 0;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(
            `${backendUrl}/api/v1/participant/${encodeURIComponent(participantId)}/pr-points`,
            { signal: controller.signal }
        ).finally(() => clearTimeout(timeout));

        if (!response.ok) {
            return 0;
        }

        const body = await response.json() as { data?: number };
        return typeof body.data === 'number' ? body.data : 0;
    } catch {
        return 0;
    }
};

const PR_POINTS_CACHE_TTL = 10_000;

export default async function wsRoutes(app: FastifyInstance) {
    app.get('/', { websocket: true }, async (socket, req: FastifyRequest) => {
        let userId = 'anonymous';
        const token = req.cookies?.jwt
            || (req.query as Record<string, string | undefined>)?.token;

        if (!token) {
            return socket.close(1008, 'Missing JWT token');
        }

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
            app.log.error('JWT_SECRET is not configured – refusing WebSocket connections');
            return socket.close(1011, 'Server misconfiguration');
        }

        try {
            const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload;
            if (typeof payload.id === 'string') userId = payload.id;
        } catch {
            return socket.close(1008, 'Invalid JWT token');
        }

        let prPoints = 0;
        let prPointsFetchedAt = 0;

        const getCachedPRPoints = async (uid: string) => {
            if (uid === 'anonymous') return 0;

            const now = Date.now();
            if (now - prPointsFetchedAt < PR_POINTS_CACHE_TTL) {
                return prPoints;
            }

            prPointsFetchedAt = now;
            try {
                prPoints = await fetchPRPoints(uid);
            } catch (error) {
                app.log.error(error, `Unable to fetch PR points for ${uid}`);
            }

            return prPoints;
        };

        activeClients.add(socket);
        try {
            const points = await getCachedPRPoints(userId);
            const tier = getRateLimit(points);
            socket.send(JSON.stringify({
                type: 'TIER_INFO',
                maxPixels: tier.maxPixels,
                cooldown: tier.cooldown
            }));
        } catch (error) {
            app.log.error(error, `Failed to send initial tier info for ${userId}`);
        }

        socket.on('message', async (message: Buffer) => {
            try {
                await handleMessage(socket, message, userId, getCachedPRPoints);
            } catch (error) {
                app.log.error(error, `Unhandled WebSocket message error for ${userId}`);
            }
        });

        socket.on('error', (error) => {
            app.log.error(error, `WebSocket error for ${userId}`);
        });

        socket.on('close', () => {
            activeClients.delete(socket);
        });
    });
}