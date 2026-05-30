import { CloseCode, type Client, Room, ServerError } from "colyseus";
import { GameRoomState } from "../schema/GameRoomState.js";
import { PlayerState } from "../schema/PlayerState.js";

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
    private initialGameData: unknown | null = null;
    private latestGameState: unknown | null = null;
    /** 目前在語音頻道內的 sessionId 集合 */
    private voiceSessionIds = new Set<string>();

    async onCreate(options: CreateRoomOptions = {}) {
        this.maxClients = 4;

        this.password = options.password?.trim() || null;

        const state = new GameRoomState();
        state.roomId = this.roomId;
        state.hasPassword = this.password !== null;
        this.setState(state);
        await this.setMetadata({
            hasPassword: state.hasPassword,
            isGameStarted: state.isGameStarted
        });

        this.onMessage("toggle_ready", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            player.isReady = !player.isReady;
        });

        this.onMessage("start_game", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can start the game.", 403);
            }

            const players = Array.from(this.state.players.values()) as PlayerState[];
            const totalPlayers = players.length + this.state.botCount;
            if (totalPlayers < 2 || totalPlayers > 4) {
                throw new LobbyException("The game requires 2 to 4 players (including bots).");
            }

            const guestsReady = players
                .filter(roomPlayer => !roomPlayer.isHost)
                .every(roomPlayer => roomPlayer.isReady);

            if (!guestsReady) {
                throw new LobbyException("All non-host players must be ready before starting.");
            }

            this.state.isGameStarted = true;
            void this.setMetadata({ isGameStarted: true });
            this.lock();
        });

        this.onMessage("add_bot", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can add bots.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot add bots after the game has started.");
            }
            const totalSlots = this.state.players.size + this.state.botCount;
            if (totalSlots >= this.maxClients) {
                throw new LobbyException("Room is full.");
            }
            this.state.botCount++;
            this.state.botDifficulties.push("hard");
            console.log(`[LoveLetterRoom] Bot added to room ${this.roomId}. Bot count: ${this.state.botCount}`);
        });

        this.onMessage("remove_bot", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can remove bots.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot remove bots after the game has started.");
            }
            if (this.state.botCount <= 0) {
                throw new LobbyException("No bots to remove.");
            }
            this.state.botCount--;
            this.state.botDifficulties.pop();
            console.log(`[LoveLetterRoom] Bot removed from room ${this.roomId}. Bot count: ${this.state.botCount}`);
        });

        this.onMessage("set_bot_difficulty", (client, data: { index: number; difficulty: string }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) throw new LobbyException("Only the host can set bot difficulty.", 403);
            if (this.state.isGameStarted) throw new LobbyException("Cannot change difficulty after the game has started.");
            const valid = ['easy', 'medium', 'hard'];
            if (typeof data?.index !== 'number' || data.index < 0 || data.index >= this.state.botCount) {
                throw new LobbyException("Invalid bot index.");
            }
            if (!valid.includes(data?.difficulty)) throw new LobbyException("Invalid difficulty value.");
            this.state.botDifficulties[data.index] = data.difficulty;
        });

        this.onMessage("set_champion_coins", (client, data: { value: number }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) throw new LobbyException("Only the host can set champion coins.", 403);
            if (this.state.isGameStarted) throw new LobbyException("Cannot change champion coins after the game has started.");
            const v = data?.value;
            if (typeof v !== 'number' || v < 1 || v > 10) throw new LobbyException("Champion coins must be between 1 and 10.");
            this.state.championCoins = v;
        });

        this.onMessage("kick_player", (client, data: { targetSessionId: string }) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can kick players.", 403);
            }
            if (this.state.isGameStarted) {
                throw new LobbyException("Cannot kick players after the game has started.");
            }
            if (!data?.targetSessionId || data.targetSessionId === client.sessionId) {
                throw new LobbyException("Invalid kick target.");
            }
            const targetPlayer = this.state.players.get(data.targetSessionId);
            if (!targetPlayer) {
                throw new LobbyException("Target player not found.");
            }

            // Notify the kicked client before removing them.
            const targetClient = this.clients.find(c => c.sessionId === data.targetSessionId);
            if (targetClient) {
                targetClient.send("kicked_from_room", {});
            }

            this.state.players.delete(data.targetSessionId);
            console.log(`[LoveLetterRoom] ${targetPlayer.name} was kicked from room ${this.roomId} by the host.`);
        });

        this.onMessage("forfeit_game", client => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!this.state.isGameStarted) {
                throw new LobbyException("Game has not started yet.");
            }
            player.hasForfeited = true;
            console.log(`[LoveLetterRoom] ${player.name} forfeited from room ${this.roomId}.`);
        });

        this.onMessage("init_game_data", (client, data) => {
            const player = this.getPlayerOrThrow(client.sessionId);
            if (!player.isHost) {
                throw new LobbyException("Only the host can initialize the game.", 403);
            }

            if (!this.state.isGameStarted) {
                throw new LobbyException("Cannot initialize the game before it starts.");
            }

            this.initialGameData = data;
            this.latestGameState = data;
            this.broadcast("init_game_data", data);
        });

        this.onMessage("sync_game_state", (client, data) => {
            this.getPlayerOrThrow(client.sessionId);
            if (!this.state.isGameStarted) {
                throw new LobbyException("Cannot sync game state before the game starts.");
            }

            this.latestGameState = data;
            // Exclude the sender: the host owns authoritative state and does not
            // need its own echo. Broadcasting back to the host would needlessly
            // overwrite aiMemory/aiExcludedGuesses (always reset to {} in
            // applyOnlineGameState) after every sync.
            this.broadcast("sync_game_state", data, { except: client });
        });

        this.onMessage("request_game_data", client => {
            this.getPlayerOrThrow(client.sessionId);
            const gameData = this.latestGameState ?? this.initialGameData;
            if (gameData) {
                client.send("init_game_data", gameData);
            }
        });

        // ── WebRTC 語音信令 ──────────────────────────────────────────────────

        // 加入語音頻道：回傳現有參與者給新加入者，並廣播給其他人
        this.onMessage("webrtc_join_voice", client => {
            const existing = [...this.voiceSessionIds];
            this.voiceSessionIds.add(client.sessionId);
            client.send("webrtc_voice_state", { type: 'you_joined', existingParticipants: existing });
            this.broadcast("webrtc_voice_state", { type: 'peer_joined', sessionId: client.sessionId }, { except: client });
        });

        // 離開語音頻道
        this.onMessage("webrtc_leave_voice", client => {
            this.voiceSessionIds.delete(client.sessionId);
            this.broadcast("webrtc_voice_state", { type: 'peer_left', sessionId: client.sessionId }, { except: client });
        });

        // P2P 信令中繼（offer / answer / ice candidate）
        this.onMessage("webrtc_signal", (client, data: { to: string; type: string; payload: unknown }) => {
            const target = this.clients.find(c => c.sessionId === data.to);
            if (target) {
                target.send("webrtc_signal", { from: client.sessionId, type: data.type, payload: data.payload });
            }
        });

        // 表情反應：廣播給房間所有人（包含發送者）
        this.onMessage("emoji_react", (_client, data: { emoji: string; playerId: number }) => {
            if (!this.state.isGameStarted) return;
            const validEmojis = ['😊', '😡', '😢', '🤔', '❌', '💯'];
            if (!validEmojis.includes(data?.emoji)) return;
            if (typeof data?.playerId !== 'number') return;
            this.broadcast("emoji_react", { emoji: data.emoji, playerId: data.playerId });
        });

        // 文字聊天：廣播給房間所有人（包含發送者，保持一致性）
        this.onMessage("chat_message", (client, data: { text: string }) => {
            const player = this.state.players.get(client.sessionId);
            const name = player?.name ?? '???';
            const text = typeof data?.text === 'string' ? data.text.trim().slice(0, 200) : '';
            if (!text) return;
            this.broadcast("chat_message", {
                sessionId: client.sessionId,
                name,
                text,
                timestamp: Date.now()
            });
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

        if (this.state.players.size + this.state.botCount >= this.maxClients) {
            throw new LobbyException("Room is full.", 403);
        }

        const player = new PlayerState();
        player.id = client.sessionId;
        player.name = options.name?.trim() || `Player ${this.state.players.size + 1}`;
        player.isHost = this.state.players.size === 0;
        player.isReady = false;
        player.isConnected = true;

        this.state.players.set(client.sessionId, player);

        console.log(`[LoveLetterRoom] ${player.name} joined room ${this.roomId}. Host: ${player.isHost}`);
    }

    async onLeave(client: Client, consented?: boolean | number) {
        // WebRTC 不支援重連，斷線時立即清除語音狀態並通知其他人
        if (this.voiceSessionIds.has(client.sessionId)) {
            this.voiceSessionIds.delete(client.sessionId);
            this.broadcast("webrtc_voice_state", { type: 'peer_left', sessionId: client.sessionId }, { except: client });
        }

        const leavingPlayer = this.state.players.get(client.sessionId);
        if (!leavingPlayer) return;

        if (this.state.isGameStarted) {
            leavingPlayer.isConnected = false;
            leavingPlayer.isReady = false;

            console.log(
                `[LoveLetterRoom] ${leavingPlayer.name} disconnected during game ${this.roomId}. ` +
                `Consented/code: ${String(consented)}. Keeping player slot for game-state stability.`
            );

            // Colyseus calls onLeave(client, CloseCode.CONSENTED) (= 4000) for voluntary leaves,
            // not the boolean `true`. Handle both forms to be safe.
            if (consented === true || consented === CloseCode.CONSENTED) {
                // Voluntary leave during a game: mark the player as forfeited so
                // non-host clients can immediately detect the game is over.
                leavingPlayer.hasForfeited = true;
                this.disposeStartedRoomIfEveryoneLeft("all players left voluntarily");
                return;
            }

            try {
                await this.allowReconnection(client, 60);
                const reconnectedPlayer = this.state.players.get(client.sessionId);
                if (reconnectedPlayer) {
                    reconnectedPlayer.isConnected = true;
                    console.log(`[LoveLetterRoom] ${reconnectedPlayer.name} reconnected to room ${this.roomId}.`);
                }
            } catch {
                const timedOutPlayer = this.state.players.get(client.sessionId);
                if (timedOutPlayer) {
                    timedOutPlayer.isConnected = false;
                    timedOutPlayer.isReady = false;
                    console.log(
                        `[LoveLetterRoom] ${timedOutPlayer.name} did not reconnect to room ${this.roomId} within 20 seconds. ` +
                        `Player slot remains reserved.`
                    );
                }
                this.disposeStartedRoomIfEveryoneLeft("all players disconnected");
            }
            return;
        }

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

    private disposeStartedRoomIfEveryoneLeft(reason: string) {
        if (!this.state.isGameStarted) return;

        const players = Array.from(this.state.players.values()) as PlayerState[];
        if (players.length === 0 || players.some(player => player.isConnected)) return;

        console.log(`[LoveLetterRoom] Disposing room ${this.roomId}: ${reason}.`);
        this.disconnect();
    }
}
