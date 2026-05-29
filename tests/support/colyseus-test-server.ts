import { LobbyRoom, Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LoveLetterRoom } from '../../src/server/rooms/LoveLetterRoom.js';

const port = Number(process.env.COLYSEUS_PORT ?? 2567);

const gameServer = new Server({
    // Match production: raise the 4KB default maxPayload so full-state syncs fit.
    transport: new WebSocketTransport({ maxPayload: 1024 * 1024 }),
    greet: false,
    express: app => {
        app.get('/health', (_req: unknown, res: { status: (code: number) => { send: (body: string) => void } }) => {
            res.status(200).send('ok');
        });
    }
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('love_letter', LoveLetterRoom).enableRealtimeListing();

await gameServer.listen(port, '127.0.0.1');
console.log(`[Playwright] Colyseus test server listening on 127.0.0.1:${port}`);

const shutdown = async () => {
    await gameServer.gracefullyShutdown(false);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
