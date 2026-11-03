import "dotenv/config";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redis } from "./db/redis.js";
import { checkPostgresConnection } from "./db/postgres.js";
import wsRoutes from "./routes/ws.js";
import boardRoutes from "./routes/board.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import pixelHistoryRoutes from "./routes/pixelHistory.js";
import { canvas } from "./utilities/canvas.js";
import { startPixelPlacementPersistence } from "./utilities/pixelPlacementPersistence.js";
import cors from "@fastify/cors";

const app = Fastify({
    logger: {
        serializers: {
            req(req) {
                return {
                    method: req.method,
                    url: req.url ? req.url.split('?')[0] : req.url,
                    hostname: req.hostname,
                    remoteAddress: req.ip
                };
            }
        }
    }
});
const port = process.env.PORT || 3001
const host = process.env.HOST ?? "0.0.0.0";

await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
    exposedHeaders: ['X-Canvas-Sequence']
});

await app.register(websocket);
await app.register(cookie);
await app.register(wsRoutes, { prefix: '/ws' });
await app.register(boardRoutes, { prefix: '/api/board' });
await app.register(leaderboardRoutes, { prefix: '/api/leaderboard' });
await app.register(pixelHistoryRoutes, { prefix: '/api/pixels' });

try {
    await canvas.init();
    await checkPostgresConnection();
    void startPixelPlacementPersistence();
    redis.once("ready", async () => {
        console.log("Redis is ready, starting server...");
    });
    await app.listen({ port: Number(port), host });
    console.log(`Server is running on http://${host}:${port}`);
} catch (error) {
    console.error("Error starting server:", error);
}

