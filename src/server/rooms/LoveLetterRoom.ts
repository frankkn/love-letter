import { type Client, Room, ServerError } from "colyseus";
import { GameRoomState } from "../schema/GameRoomState";
import { PlayerState } from "../schema/PlayerState";

interface CreateRoomOptions {
    password?: string;
}

interface JoinRoomOptions {
    name?: string;
    password?: string;
}

class LobbyException extends ServerError {
    constructor(message: string, code = 400) {
        super(code, message);
    }
}

export class LoveLetterRoom extends Room<{ state: GameRoomState }> {
    private password: string | null = null;

    onCreate(options: CreateRoomOptions = {}) {
        this.maxClients = 4;

        this.password = options.password?.trim() || null;

        const state = new GameRoomState();
        state.roomId = this.roomId;
        state.hasPassword = this.password !== null;
        this.setState(state);

        this.onMessage("toggle_ready", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            player.isReady = !player.isReady;
        });

        this.onMessage("start_game", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can start the game.", 403);
            }

            const players = Array.from(this.state.players.values());
            if (players.length < 2 || players.length > 4) {
                throw new LobbyException("The game requires 2 to 4 players.");
            }

            const guestsReady = players
                .filter(roomPlayer => !roomPlayer.isHost)
                .every(roomPlayer => roomPlayer.isReady);

            if (!guestsReady) {
                throw new LobbyException("All non-host players must be ready before starting.");
            }

            this.state.isGameStarted = true;
            this.lock();
        });

        console.log(`[LoveLetterRoom] Created room ${this.roomId}. Password protected: ${state.hasPassword}`);
    }

    onJoin(client: Client, options: JoinRoomOptions = {}) {
        if (this.state.isGameStarted) {
            throw new LobbyException("Cannot join a game that has already started.", 403);
        }

        if (this.password !== null && options.password !== this.password) {
            throw new LobbyException("Invalid room password.", 401);
        }

        if (this.state.players.has(client.sessionId)) {
            throw new LobbyException("Player is already in this room.");
        }

        if (this.state.players.size >= this.maxClients) {
            throw new LobbyException("Room is full.", 403);
        }

        const player = new PlayerState();
        player.id = client.sessionId;
        player.name = options.name?.trim() || `Player ${this.state.players.size + 1}`;
        player.isHost = this.state.players.size === 0;
        player.isReady = false;

        this.state.players.set(client.sessionId, player);

        console.log(`[LoveLetterRoom] ${player.name} joined room ${this.roomId}. Host: ${player.isHost}`);
    }

    onLeave(client: Client, consented?: boolean | number) {
        const leavingPlayer = this.state.players.get(client.sessionId);
        if (!leavingPlayer) return;

        const wasHost = leavingPlayer.isHost;
        this.state.players.delete(client.sessionId);

        if (wasHost) {
            this.transferHostToNextPlayer();
        }

        if (this.state.players.size === 0) {
            console.log(`[LoveLetterRoom] Room ${this.roomId} is empty and will be disposed by Colyseus.`);
        } else {
            console.log(
                `[LoveLetterRoom] ${leavingPlayer.name} left room ${this.roomId}. ` +
                `Consented/code: ${String(consented)}. Remaining players: ${this.state.players.size}`
            );
        }
    }

    private getPlayerOrThrow(sessionId: string): PlayerState {
        const player = this.state.players.get(sessionId);
        if (!player) {
            throw new LobbyException("Player is not in this room.", 404);
        }

        return player;
    }

    private transferHostToNextPlayer() {
        const nextHost = this.state.players.values().next().value as PlayerState | undefined;
        if (!nextHost) return;

        nextHost.isHost = true;
        nextHost.isReady = false;

        console.log(`[LoveLetterRoom] Host transferred to ${nextHost.name} in room ${this.roomId}.`);
    }
}
