import 'dotenv/config';
import { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { activeClients } from '../utilities/broadcast.js';
import { handleMessage } from '../handlers/webSocket.js';

const fetchPRPoints = async (participantId: string): Promise<number> => {
    const response = await fetch(
        `${process.env.GH_BACKEND_URL}/api/v1/participant/${encodeURIComponent(participantId)}/pr-points`
    );

    if (!response.ok) {
        throw new Error(`PR points request failed with status ${response.status}`);
    }

    const body = await response.json() as { data?: number };
    return body.data ?? 0;
};

const PR_POINTS_CACHE_TTL = 10_000;

export default async function wsRoutes(app: FastifyInstance) {
    app.get('/', { websocket: true }, async (socket, req: FastifyRequest) => {
        let userId = 'anonymous';

        const token = req.cookies?.jwt;
        if(!token){
            return socket.close(1008, 'Missing JWT token');
        }

        if (token) {
            try {
                
                const payload = jwt.verify(token, process.env.JWT as string) as jwt.JwtPayload;
                //console.log('WebSocket connection authenticated for user:', payload.id);
                if (typeof payload.id === 'string') userId = payload.id;
            } catch {
                return socket.close(1008, 'Invalid JWT token');
                
            }
        }
        let prPoints = 0;
        let prPointsFetchedAt = 0;

        const getCachedPRPoints = async (userId: string) => {
            if (userId === 'anonymous') return 0;

            const now = Date.now();
            if (now - prPointsFetchedAt < PR_POINTS_CACHE_TTL) {
                return prPoints;
            }

            try {
                prPoints = await fetchPRPoints(userId);
                
                prPointsFetchedAt = now;
            } catch (error) {
                app.log.error(error, `Unable to fetch PR points for ${userId}`);
            }

            return prPoints;
        };

        activeClients.add(socket);
        //app.log.info(`Client connected: ${userId}. Total active: ${activeClients.size}`);

        //socket.send(JSON.stringify({ type: 'INIT_BOARD', message: 'Board binary will be served here' }));

        socket.on('message', async (message: Buffer) => {
            //console.log(`Received message from user ${userId}:`, message);
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
            //app.log.info(`Client disconnected: ${userId}. Total active: ${activeClients.size}`);
        });
    });
}