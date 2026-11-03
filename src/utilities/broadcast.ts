import type { WebSocket } from "@fastify/websocket";
export const activeClients = new Set<WebSocket>();

export const broadcast = (payload: string | Buffer) => {
    for (const client of activeClients) {
        try {
            if (client.readyState === 1) { // 1 === OPEN
                client.send(payload, (err) => {
                    if (err) {
                        activeClients.delete(client);
                    }
                });
            } else if (client.readyState === 2 || client.readyState === 3) {
                activeClients.delete(client);
            }
        } catch {
            activeClients.delete(client);
        }
    }
};