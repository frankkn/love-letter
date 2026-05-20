import { LobbyRoom, Server } from 'colyseus';
import type { NextFunction, Request, Response } from 'express';
import { LoveLetterRoom } from './rooms/LoveLetterRoom.js';

const port = Number(process.env.PORT ?? process.env.COLYSEUS_PORT ?? 2567);
const host = process.env.HOST ?? '0.0.0.0';
const allowedOrigin = process.env.CORS_ORIGIN ?? '*';

const gameServer = new Server({
    express: app => {
        app.use((req: Request, res: Response, next: NextFunction) => {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
                return;
            }

            next();
        });

        app.get('/health', (_req: Request, res: Response) => {
            res.status(200).send('ok');
        });
    }
});

gameServer.define('lobby', LobbyRoom);
gameServer.define('love_letter', LoveLetterRoom).enableRealtimeListing();

await gameServer.listen(port, host);
console.log(`[LoveLetterServer] Listening on ${host}:${port}`);

const shutdown = async () => {
    await gameServer.gracefullyShutdown(false);
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
