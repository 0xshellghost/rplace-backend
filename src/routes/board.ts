import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { redis } from '../db/redis.js';
import { CANVAS_BYTES } from '../config/canvas.js';

const CANVAS_KEY = 'canvas:state';
const emptyBoard = Buffer.alloc(CANVAS_BYTES);
const ALLOWED_UPLOAD_USERS = ['Coldesy'];

export default async function boardRoutes(app: FastifyInstance) {
	app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => {
		done(null, body);
	});

	app.get('/', async (_request, reply) => {
		try {
			let boardBuffer = await redis.getBuffer(CANVAS_KEY);
			//console.log(boardBuffer)
			if (!boardBuffer) {
				await redis.set(CANVAS_KEY, emptyBoard, 'NX');
				boardBuffer = await redis.getBuffer(CANVAS_KEY);
			}

			if (!boardBuffer) {
				return reply.status(500).send({ error: 'Internal Server Error' });
			}

			const sequence = await redis.get('canvas:seq');
			reply.header('X-Canvas-Sequence', sequence || '0');
			reply.header('Content-Type', 'application/octet-stream');
			reply.header('Cache-Control', 'no-store');
			return reply.send(boardBuffer);
		} catch (error) {
			app.log.error(error, 'Failed to fetch board state');
			return reply.status(500).send({ error: 'Internal Server Error' });
		}
	});

	app.put<{ Body: Buffer }>('/', async (request, reply) => {
		const token = request.cookies?.jwt;
		if (!token) {
			return reply.status(401).send({ error: 'Authentication required' });
		}

		const jwtSecret = process.env.JWT_SECRET;
		if (!jwtSecret) {
			return reply.status(500).send({ error: 'Server misconfiguration' });
		}

		let userId: string | undefined;
		try {
			const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload;
			userId = typeof payload.id === 'string'
				? payload.id
				: typeof payload.username === 'string' ? payload.username : undefined;
		} catch {
			return reply.status(401).send({ error: 'Invalid JWT token' });
		}

		if (!userId || !ALLOWED_UPLOAD_USERS.includes(userId)) {
			return reply.status(403).send({ error: 'Board upload is not allowed for this user' });
		}

		if (!Buffer.isBuffer(request.body) || request.body.length !== CANVAS_BYTES) {
			return reply.status(400).send({
				error: `Board data must be exactly ${CANVAS_BYTES} bytes`
			});
		}

		try {
			const [, sequence] = await redis.multi()
				.set(CANVAS_KEY, request.body)
				.incr('canvas:seq')
				.exec() as [[Error | null, unknown], [Error | null, unknown]];

			return reply.send({
				message: 'Board uploaded successfully',
				sequence: Number(sequence[1])
			});
		} catch (error) {
			app.log.error(error, 'Failed to upload board state');
			return reply.status(500).send({ error: 'Internal Server Error' });
		}
	});
}
