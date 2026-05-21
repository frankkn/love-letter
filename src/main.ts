import './style.css'
import { Client, type Room, type RoomAvailable } from '@colyseus/sdk';
import guardImage from './assets/cards/guard.png';
import priestImage from './assets/cards/priest.png';
import baronImage from './assets/cards/baron.png';
import handmaidImage from './assets/cards/handmaid.png';
import princeImage from './assets/cards/prince.png';
import kingImage from './assets/cards/king.png';
import countessImage from './assets/cards/countess.png';
import princessImage from './assets/cards/princess.png';
import { GameRoomState } from './server/schema/GameRoomState.js';

// 1. 定義型別
export enum CardType {
    Guard = 1,
    Priest = 2,
    Baron = 3,
    Handmaid = 4,
    Prince = 5,
    King = 6,
    Countess = 7,
    Princess = 8
}

export interface Card {
    readonly id: string;
    readonly type: CardType;
    readonly name: string;
    readonly value: number;
    readonly description: string;
    actionHints?: CardActionHint[];
    privateActionHints?: CardActionHint[];
    privateHintOwnerId?: number;
    targetName?: string;
    guessedCardName?: string;
}

export interface CardActionHint {
    text: string;
    variant?: 'default' | 'danger' | 'tie';
}

export interface Player {
    id: number;           // 0 為人類玩家，1~3 為電腦
    name: string;         // "玩家", "電腦 A", "電腦 B", "電腦 C"
    isBot: boolean;       // 是否為電腦
    coins: number;        // 聯賽硬幣數，先取得 4 枚者獲勝
    hand: Card[];         // 手牌 (1~2張)
    isProtected: boolean; // 侍女保護狀態
    isAlive: boolean;     // 是否還活著
    discardPile: Card[];  // 已打出的牌堆
    isHandRevealed?: boolean; // 是否需在畫面上暫時強制翻開手牌
}

export interface GameState {
    deck: Card[];
    burnedCard: Card | null;
    players: Player[];
    currentTurnPlayerId: number;
    isGameOver: boolean;
    winner: Player | null;
    logs: string[];
    aiMemory: Record<number, Record<number, CardType>>;
}

interface PlayRollback {
    playerId: number;
    hand: Card[];
    discardPile: Card[];
    isProtected: boolean;
    logLength: number;
}

interface PrinceDiscardResult {
    discarded: Card | null;
    hasPendingForcedEffect: boolean;
}

// 2. 宣告原版 16 張卡牌資料
const CARD_DEFINITIONS: Record<CardType, { name: string; count: number; desc: string }> = {
    [CardType.Guard]: { name: '衛兵', count: 5, desc: '猜對手手牌（衛兵除外），猜中則對方出局。' },
    [CardType.Priest]: { name: '神父', count: 2, desc: '看一名對手的手牌。' },
    [CardType.Baron]: { name: '男爵', count: 2, desc: '與一名對手比大小，小者出局。' },
    [CardType.Handmaid]: { name: '侍女', count: 2, desc: '直到下一回合，你免疫所有卡牌效果。' },
    [CardType.Prince]: { name: '王子', count: 2, desc: '選擇一人棄掉手牌並重抽。' },
    [CardType.King]: { name: '國王', count: 1, desc: '與一名對手交換手牌。' },
    [CardType.Countess]: { name: '伯爵夫人', count: 1, desc: '若持有王子或國王，則必須打出此牌。' },
    [CardType.Princess]: { name: '公主', count: 1, desc: '打出或棄掉此牌時，你直接出局。' },
};

const CARD_IMAGES: Record<CardType, string> = {
    [CardType.Guard]: guardImage,
    [CardType.Priest]: priestImage,
    [CardType.Baron]: baronImage,
    [CardType.Handmaid]: handmaidImage,
    [CardType.Prince]: princeImage,
    [CardType.King]: kingImage,
    [CardType.Countess]: countessImage,
    [CardType.Princess]: princessImage
};

function createDeck(): Card[] {
    const deck: Card[] = [];
    let idCounter = 0;
    for (const typeStr in CARD_DEFINITIONS) {
        const type = Number(typeStr) as CardType;
        const def = CARD_DEFINITIONS[type];
        for (let i = 0; i < def.count; i++) {
            deck.push({
                id: `card-${idCounter++}`,
                type,
                name: def.name,
                value: type,
                description: def.desc
            });
        }
    }
    return deck;
}

function shuffle<T>(array: T[]): T[] {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
}

// 3. 全域狀態
let state: GameState;
let selectedCardId: string | null = null;
let isResolvingTurnAction = false;
let queuedBotTurnId: number | null = null;
let localPlayerId = 0;
let onlineGameInitialized = false;
let isApplyingOnlineState = false;

interface LobbyRoomSummary {
    roomId: string;
    playerCount: number;
    maxClients: number;
    hasPassword: boolean;
    isGameStarted: boolean;
}

interface LobbyRoomMetadata {
    hasPassword?: boolean;
    isGameStarted?: boolean;
}

type LobbyRoomAddMessage =
    | RoomAvailable<LobbyRoomMetadata>
    | [string, RoomAvailable<LobbyRoomMetadata>];

interface RoomWaitPlayerView {
    id: string;
    name: string;
    isReady: boolean;
    isHost: boolean;
    isConnected?: boolean;
}

interface RoomWaitViewState {
    roomId: string;
    players: RoomWaitPlayerView[];
    selfId: string;
    isGameStarted: boolean;
}

interface SyncedRoomPlayerState {
    id: string;
    name: string;
    isReady: boolean;
    isHost: boolean;
    isConnected?: boolean;
}

interface SyncedRoomState {
    roomId: string;
    isGameStarted: boolean;
    players: Map<string, SyncedRoomPlayerState> | Record<string, SyncedRoomPlayerState> | {
        values: () => IterableIterator<SyncedRoomPlayerState>;
    };
}

const colyseusEndpoint = import.meta.env.VITE_COLYSEUS_ENDPOINT ||
    `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:2567`;
const colyseusClient = new Client(colyseusEndpoint);
let lobbyRoom: Room | null = null;
let activeGameRoom: Room<unknown, SyncedRoomState> | null = null;
let lobbyRooms: LobbyRoomSummary[] = [];
let currentRoomWaitState: RoomWaitViewState | null = null;
let pendingForcedEffectsQueue: PendingForcedEffect[] = [];
let resolvingForcedEffect: PendingForcedEffect | null = null;
let pendingBaronDuel: PendingBaronDuel | null = null;
let activeBaronDuelModalKey: string | null = null;
let pendingKingExchange: PendingKingExchange | null = null;
let activeKingExchangeModalKey: string | null = null;
let isHandlingPendingForcedEffect = false;
let hasShownEndGameModal = false;
let nextRoundReadyPlayerIds: number[] = [];

async function leaveRoomIfConnected(room: Room | null) {
    if (!room) return;

    room.removeAllListeners();
    await room.leave();
}

async function resetClientState() {
    const leavingGameRoom = activeGameRoom;
    const leavingLobbyRoom = lobbyRoom;

    activeGameRoom = null;
    lobbyRoom = null;

    try {
        await leaveRoomIfConnected(leavingGameRoom);
    } catch (error) {
        console.warn('Failed to leave active game room during client reset:', error);
    }

    try {
        await leaveRoomIfConnected(leavingLobbyRoom);
    } catch (error) {
        console.warn('Failed to leave lobby room during client reset:', error);
    }

    lobbyRooms = [];
    currentRoomWaitState = null;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    hasShownEndGameModal = false;
    nextRoundReadyPlayerIds = [];
    selectedCardId = null;
    isResolvingTurnAction = false;
    queuedBotTurnId = null;
    localPlayerId = 0;
    onlineGameInitialized = false;
    isApplyingOnlineState = false;
    endGameReason = '';
    closeModal();
}

// 4. DOM 元素
const mainMenuEl = document.getElementById('main-menu')!;
const modeSelectEl = document.getElementById('mode-select')!;
const botCountSelectEl = document.getElementById('bot-count-select')!;
const lobbySceneEl = document.getElementById('lobby-scene')!;
const roomWaitSceneEl = document.getElementById('room-wait-scene')!;
const gameSceneEl = document.getElementById('game-scene')!;
const roomListContainerEl = document.getElementById('room-list-container')!;
const currentRoomIdEl = document.getElementById('current-room-id')!;
const roomPlayerCountEl = document.getElementById('room-player-count')!;
const roomPlayerListEl = document.getElementById('room-player-list')!;
const readyToggleBtn = document.getElementById('ready-toggle-btn') as HTMLButtonElement;
const cardStatsAreaEl = document.querySelector('.card-stats-area') as HTMLElement;
const playedCardStatsEl = document.getElementById('played-card-stats')!;
const opponentsContainerEl = document.getElementById('opponents-container')!;
const playerAreaEl = document.getElementById('player-area')!;
const playerHandEl = document.getElementById('player-hand')!;
const playerDiscardEl = document.getElementById('player-discard')!;
const deckCountEl = document.getElementById('deck-count')!;
const drawBtn = document.getElementById('draw-btn') as HTMLButtonElement;
const showResultBtn = document.getElementById('show-result-btn') as HTMLButtonElement;
const showLogBtn = document.getElementById('show-log-btn') as HTMLButtonElement;
const gameLogEl = document.getElementById('game-log')!;
const turnIndicatorEl = document.getElementById('turn-indicator')!;
showLogBtn.textContent = '查看對戰紀錄';

// Modal 相關
const modalOverlay = document.getElementById('modal-overlay')!;
const modalTitle = document.getElementById('modal-title')!;
const modalBody = document.getElementById('modal-body')!;
const modalFooter = document.getElementById('modal-footer')!;
let endGameReason = '';

const mobileStatsToggleBtn = document.createElement('button');
mobileStatsToggleBtn.type = 'button';
mobileStatsToggleBtn.className = 'mobile-stats-toggle';
mobileStatsToggleBtn.textContent = '📊 出牌統計';
mobileStatsToggleBtn.setAttribute('aria-controls', 'played-card-stats');
mobileStatsToggleBtn.setAttribute('aria-expanded', 'false');
document.body.appendChild(mobileStatsToggleBtn);

// 5. 輔助函式
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 6. 渲染函式
function renderPlayedCardStats() {
    const counts = new Map<CardType, number>();
    state.players
        .flatMap(player => player.discardPile)
        .forEach(card => counts.set(card.type, (counts.get(card.type) || 0) + 1));

    playedCardStatsEl.innerHTML = '';
    for (let type = CardType.Guard; type <= CardType.Princess; type++) {
        const count = counts.get(type) || 0;
        const row = document.createElement('div');
        row.className = `card-stat-row ${count === 0 ? 'empty' : ''}`;

        const value = document.createElement('span');
        value.className = 'card-stat-value';
        value.textContent = String(type);

        const name = document.createElement('span');
        name.className = 'card-stat-name';
        name.textContent = CARD_DEFINITIONS[type].name;

        const total = document.createElement('span');
        total.className = 'card-stat-count';
        total.textContent = `${count}/${CARD_DEFINITIONS[type].count}`;

        row.append(value, name, total);
        playedCardStatsEl.appendChild(row);
    }
}

function createPlayedCardStatsHTML(): string {
    const counts = new Map<CardType, number>();
    state.players
        .flatMap(player => player.discardPile)
        .forEach(card => counts.set(card.type, (counts.get(card.type) || 0) + 1));

    const rows = Array.from({ length: CardType.Princess }, (_, index) => {
        const type = (index + 1) as CardType;
        const count = counts.get(type) || 0;
        const def = CARD_DEFINITIONS[type];
        return `
            <div class="modal-card-stat-row ${count === 0 ? 'empty' : ''}">
                <span class="modal-card-stat-value">${type}</span>
                <span class="modal-card-stat-name">${def.name}</span>
                <span class="modal-card-stat-count">${count}/${def.count}</span>
            </div>
        `;
    }).join('');

    return `
        <section class="modal-card-stats" aria-label="出牌統計">
            <h3>出牌統計</h3>
            <div class="modal-card-stats-grid">${rows}</div>
        </section>
    `;
}

function createStatsModalBodyHTML(bodyHTML: string): string {
    return `
        ${bodyHTML}
        ${createPlayedCardStatsHTML()}
    `;
}

function waitForStatsModalConfirm(title: string, bodyHTML: string, confirmText = '確定'): Promise<void> {
    return new Promise(resolve => {
        showModal(
            title,
            createStatsModalBodyHTML(bodyHTML),
            `<button class="modal-confirm-btn" id="modal-stats-confirm-btn">${confirmText}</button>`
        );

        document.getElementById('modal-stats-confirm-btn')!.onclick = () => {
            closeModal();
            resolve();
        };
    });
}

function createTargetSelectModalBodyHTML(card: Card, targets: Player[]): string {
    const helperTextByType: Partial<Record<CardType, string>> = {
        [CardType.Guard]: '選擇要猜測手牌的對象。下方同步顯示目前出牌統計，方便推測目標手牌。',
        [CardType.Priest]: '選擇要查看手牌的對象。下方同步顯示目前出牌統計，方便推測牌況。',
        [CardType.Baron]: '選擇要秘密比大小的對象。下方同步顯示目前出牌統計，方便判斷剩餘牌況。',
        [CardType.Prince]: '選擇要強迫棄牌並重抽的對象。下方同步顯示目前出牌統計，方便判斷風險。',
        [CardType.King]: '選擇要交換手牌的對象。下方同步顯示目前出牌統計，方便評估交換風險。'
    };
    const buttonsHTML = targets.map(target => (
        `<button class="target-btn" data-id="${target.id}">${target.name}</button>`
    )).join('');

    return `
        <p class="modal-helper-text">${helperTextByType[card.type] ?? `選擇 ${card.name} 的目標。下方同步顯示目前出牌統計，方便判斷剩餘牌況。`}</p>
        ${createPlayedCardStatsHTML()}
        <div class="target-list">${buttonsHTML}</div>
    `;
}

function coinIconHTML(): string {
    return `<svg class="coin-icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:1em;height:1em;display:inline-block;vertical-align:-0.12em;flex:0 0 auto;"><circle cx="12" cy="12" r="10" fill="#f6c85f" stroke="#9b6b13" stroke-width="1.8"></circle><circle cx="12" cy="12" r="6.7" fill="#ffd978" stroke="#c58a1d" stroke-width="1.2"></circle><path d="M8.6 12.9h6.8M9.6 9.6h4.8M9.6 16.1h4.8" stroke="#8b5a0a" stroke-width="1.6" stroke-linecap="round"></path></svg>`;
}

function getCoinIcons(coins: number): string {
    return coins > 0
        ? `<span class="coin-icons" aria-label="${coins} 枚硬幣" style="display:inline-flex;align-items:center;gap:0.12em;line-height:1;vertical-align:-0.12em;">${coinIconHTML().repeat(coins)}</span>`
        : '';
}

function render() {
    deckCountEl.textContent = `牌堆剩餘：${state.deck.length}`;
    
    const currentPlayer = state.players[state.currentTurnPlayerId] ?? getAlivePlayers()[0] ?? state.players[0];
    const localPlayer = state.players[localPlayerId] ?? state.players[0];
    renderPlayedCardStats();
    turnIndicatorEl.textContent = `當前回合：${currentPlayer.name}`;
    
    // 渲染對手區域
    opponentsContainerEl.innerHTML = '';
    state.players.filter(player => player.id !== localPlayer.id).forEach(bot => {
        const botArea = document.createElement('div');
        const isActive = !state.isGameOver && state.currentTurnPlayerId === bot.id;
        const isWinner = state.winner?.id === bot.id;
        const shouldRevealHand = state.isGameOver || bot.isHandRevealed;
        botArea.className = `area opponent-area ${bot.isProtected ? 'protected' : ''} ${!bot.isAlive ? 'eliminated' : ''} ${isActive ? 'active-turn' : ''} ${isWinner ? 'winner-area' : ''}`;
        botArea.innerHTML = `
            ${isWinner ? '<div class="winner-crown" title="勝利者">♛</div>' : ''}
            <h3>${bot.name}${getCoinIcons(bot.coins)}</h3>
            <div class="discard-container"></div>
            <div class="hand-container"></div>
        `;
        const discardContainer = botArea.querySelector('.discard-container')!;
        bot.discardPile.forEach(card => discardContainer.appendChild(createCardUI(card, false)));
        const handContainer = botArea.querySelector('.hand-container')!;
        bot.hand.forEach(card => {
            if (shouldRevealHand) {
                handContainer.appendChild(createCardUI(card, false));
            } else {
                const hiddenCard = document.createElement('div');
                hiddenCard.className = 'card ai-card';
                hiddenCard.textContent = '?';
                handContainer.appendChild(hiddenCard);
            }
        });
        opponentsContainerEl.appendChild(botArea);
    });

    // 渲染玩家區域
    const human = localPlayer;
    const isHumanTurn = state.currentTurnPlayerId === human.id;
    const isHumanActive = !state.isGameOver && isHumanTurn;
    const isHumanWinner = state.winner?.id === human.id;
    const canDraw = !state.isGameOver &&
        !isResolvingTurnAction &&
        isHumanTurn &&
        human.isAlive &&
        human.hand.length < 2 &&
        state.deck.length > 0;
    playerAreaEl.className = `area ${human.isProtected ? 'protected' : ''} ${!human.isAlive ? 'eliminated' : ''} ${isHumanActive ? 'active-turn' : ''} ${isHumanWinner ? 'winner-area' : ''}`;

    const existingCrown = playerAreaEl.querySelector('.winner-crown');
    existingCrown?.remove();
    if (isHumanWinner) {
        const crown = document.createElement('div');
        crown.className = 'winner-crown';
        crown.title = '勝利者';
        crown.textContent = '♛';
        playerAreaEl.prepend(crown);
    }

    const humanTitle = playerAreaEl.querySelector('h3');
    if (humanTitle) {
        humanTitle.innerHTML = `${human.name}${getCoinIcons(human.coins)} 狀態`;
    }
    
    playerHandEl.innerHTML = '';
    human.hand.forEach(card => {
        const isPlayable = isHumanTurn && human.hand.length === 2 && !state.isGameOver && !isResolvingTurnAction;
        const cardUI = createCardUI(card, isPlayable);
        const cardEl = cardUI.querySelector('.card');
        cardEl?.classList.toggle('card-selected', selectedCardId === card.id);
        if (cardEl instanceof HTMLElement && selectedCardId === card.id) {
            positionCardDescription(cardEl);
        }
        cardUI.onclick = event => {
            event.stopPropagation();
            if (selectedCardId !== card.id) {
                selectedCardId = card.id;
                render();
                return;
            }
            if (isPlayable) {
                selectedCardId = null;
                handlePlayCardRequest(human.id, card);
            }
        };
        playerHandEl.appendChild(cardUI);
    });

    playerDiscardEl.innerHTML = '';
    human.discardPile.forEach(card => playerDiscardEl.appendChild(createCardUI(card, false)));

    // 日誌
    gameLogEl.innerHTML = '';
    state.logs.forEach(log => {
        const logDiv = document.createElement('div');
        logDiv.className = 'log-entry';
        logDiv.textContent = log;
        gameLogEl.appendChild(logDiv);
    });
    gameLogEl.scrollTop = gameLogEl.scrollHeight;

    // 按鈕狀態
    drawBtn.disabled = !canDraw;
    drawBtn.style.display = canDraw ? 'block' : 'none';
    showResultBtn.style.display = state.isGameOver ? 'block' : 'none';
}

function createCardUI(card: Card, isPlayable: boolean): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';
    if (!isPlayable) wrapper.style.cursor = 'default';

    const visiblePrivateHints = card.privateHintOwnerId === localPlayerId
        ? card.privateActionHints
        : undefined;
    const actionHints = visiblePrivateHints ?? card.actionHints ?? (card.targetName && card.guessedCardName
        ? [{ text: `🎯 對 ${card.targetName} 猜: ${card.guessedCardName}` }]
        : []);

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.innerHTML = `
        <div class="card-header">
            <span class="card-name">${card.name}</span>
            <div class="card-value">${card.value}</div>
        </div>
        <div class="card-img">
            <img src="${CARD_IMAGES[card.type]}" alt="${card.name}" loading="lazy">
        </div>
        <div class="card-desc">${card.description}</div>
    `;
    cardDiv.addEventListener('pointerenter', () => {
        wrapper.classList.add('card-wrapper-hovering');
        wrapper.closest('.area')?.classList.add('card-area-hovering');
        positionCardDescription(cardDiv);
    });
    cardDiv.addEventListener('pointerleave', () => {
        wrapper.classList.remove('card-wrapper-hovering');
        wrapper.closest('.area')?.classList.remove('card-area-hovering');
        cardDiv.classList.remove('card-desc-below');
        cardDiv.style.removeProperty('--card-desc-shift');
    });
    wrapper.appendChild(cardDiv);

    if (actionHints.length > 0) {
        const hintsDiv = document.createElement('div');
        hintsDiv.className = 'card-action-hints';
        hintsDiv.innerHTML = actionHints.map(hint => `
            <div class="card-action-hint ${hint.variant ? `card-action-hint-${hint.variant}` : ''}">
                ${hint.text}
            </div>
        `).join('');
        wrapper.appendChild(hintsDiv);
    }

    if (!isPlayable) {
        cardDiv.style.cursor = 'default';
    }
    return wrapper;
}

function positionCardDescription(cardEl: HTMLElement) {
    const desc = cardEl.querySelector<HTMLElement>('.card-desc');
    if (!desc) return;

    cardEl.classList.remove('card-desc-below');
    cardEl.style.setProperty('--card-desc-shift', '0px');

    window.requestAnimationFrame(() => {
        const margin = 8;
        let rect = desc.getBoundingClientRect();

        if (rect.top < margin) {
            cardEl.classList.add('card-desc-below');
            rect = desc.getBoundingClientRect();
        }

        let shift = 0;
        if (rect.left < margin) {
            shift = margin - rect.left;
        } else if (rect.right > window.innerWidth - margin) {
            shift = window.innerWidth - margin - rect.right;
        }
        cardEl.style.setProperty('--card-desc-shift', `${shift}px`);
    });
}

// Modal 系統
function showModal(title: string, bodyHTML: string, footerHTML: string = '') {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHTML;
    modalFooter.innerHTML = footerHTML;
    modalOverlay.style.display = 'flex';
}

function closeModal() {
    modalOverlay.style.display = 'none';
}

function createPlayRollback(playerId: number): PlayRollback {
    const player = state.players[playerId];
    return {
        playerId,
        hand: [...player.hand],
        discardPile: [...player.discardPile],
        isProtected: player.isProtected,
        logLength: state.logs.length
    };
}

function restorePlayRollback(rollback?: PlayRollback) {
    if (!rollback) return;
    const player = state.players[rollback.playerId];
    player.hand = [...rollback.hand];
    player.discardPile = [...rollback.discardPile];
    player.isProtected = rollback.isProtected;
    state.logs = state.logs.slice(0, rollback.logLength);
    selectedCardId = null;
    isResolvingTurnAction = false;
    closeModal();
    render();
}

function cancelButtonHTML(): string {
    return '<button class="modal-cancel-btn" id="modal-cancel-btn">❌ 取消返回</button>';
}

function bindCancelRollback(rollback?: PlayRollback) {
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => {
        restorePlayRollback(rollback);
    });
}

// 7. 核心遊戲邏輯
function recordGuardGuess(actor: Player, target: Player, guessedType: CardType): Card | null {
    const playedGuard = [...actor.discardPile].reverse().find(discarded => discarded.type === CardType.Guard);
    if (!playedGuard) return null;

    playedGuard.targetName = target.name;
    playedGuard.guessedCardName = CARD_DEFINITIONS[guessedType].name;
    playedGuard.actionHints = [
        { text: `🎯 對 ${target.name} 猜 ${CARD_DEFINITIONS[guessedType].name}` }
    ];
    return playedGuard;
}

function addLog(msg: string) {
    state.logs.push(`[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${msg}`);
    render();
}

function createAIMemory(players: Player[]): Record<number, Record<number, CardType>> {
    return players
        .filter(player => player.isBot)
        .reduce<Record<number, Record<number, CardType>>>((memory, bot) => {
            memory[bot.id] = {};
            return memory;
        }, {});
}

function rememberKnownCard(observerId: number, targetId: number, cardType: CardType) {
    if (!state.players[observerId]?.isBot) return;
    state.aiMemory[observerId] ??= {};
    state.aiMemory[observerId][targetId] = cardType;
}

function clearKnownCardForPlayer(playerId: number) {
    Object.values(state.aiMemory).forEach(memory => {
        delete memory[playerId];
    });
}

function pruneInvalidKnownCardsForPlayer(playerId: number) {
    const player = state.players[playerId];
    Object.values(state.aiMemory).forEach(memory => {
        const rememberedType = memory[playerId];
        if (rememberedType && !player.hand.some(card => card.type === rememberedType)) {
            delete memory[playerId];
        }
    });
}

function getKnownGuardTarget(botId: number, potentialTargets: Player[]): Player | null {
    const memory = state.aiMemory[botId];
    if (!memory) return null;

    const potentialTargetIds = new Set(potentialTargets.map(target => target.id));
    for (const [targetIdText, rememberedType] of Object.entries(memory)) {
        const targetId = Number(targetIdText);
        const target = state.players[targetId];
        const targetStillHasRememberedCard = target?.hand.some(card => card.type === rememberedType);

        if (!target?.isAlive || !targetStillHasRememberedCard) {
            delete memory[targetId];
            continue;
        }

        if (rememberedType !== CardType.Guard && potentialTargetIds.has(targetId)) {
            return target;
        }
    }

    return null;
}

function getRememberedCardType(observerId: number, targetId: number): CardType | null {
    const rememberedType = state.aiMemory[observerId]?.[targetId];
    const target = state.players[targetId];
    if (!rememberedType || !target?.hand.some(card => card.type === rememberedType)) {
        if (state.aiMemory[observerId]) delete state.aiMemory[observerId][targetId];
        return null;
    }

    return rememberedType;
}

function getBaronLegalTargets(bot: Player): Player[] {
    return state.players.filter(player => (
        player.id !== bot.id &&
        player.isAlive &&
        !player.isProtected
    ));
}

function getBaronRemainingCard(bot: Player, baron: Card): Card | null {
    return bot.hand.find(card => card.id !== baron.id) ?? null;
}

function isKnownBaronLoss(bot: Player, baron: Card, target: Player): boolean {
    const remainingCard = getBaronRemainingCard(bot, baron);
    const rememberedType = getRememberedCardType(bot.id, target.id);
    return Boolean(remainingCard && rememberedType && rememberedType > remainingCard.value);
}

function getSafeBaronTargets(bot: Player, baron: Card, targets: Player[]): Player[] {
    return targets.filter(target => !isKnownBaronLoss(bot, baron, target));
}

function drawCard(playerId: number): boolean {
    const player = state.players[playerId];
    if (
        !player ||
        state.isGameOver ||
        isResolvingTurnAction ||
        state.currentTurnPlayerId !== playerId ||
        state.deck.length === 0 ||
        !player.isAlive ||
        player.hand.length >= 2
    ) {
        render();
        return false;
    }

    player.isHandRevealed = false;
    if (!player.isBot) selectedCardId = null;
    const card = state.deck.pop()!;
    player.hand.push(card);
    pruneInvalidKnownCardsForPlayer(playerId);
    addLog(`${player.name} 抽了一張牌。`);
    render();
    syncOnlineGameState();
    return true;
}

function checkCountessConstraint(hand: Card[]): boolean {
    const hasCountess = hand.some(c => c.type === CardType.Countess);
    const hasPrinceOrKing = hand.some(c => c.type === CardType.Prince || c.type === CardType.King);
    return hasCountess && hasPrinceOrKing;
}

async function handlePlayCardRequest(playerId: number, card: Card) {
    if (state.isGameOver || isResolvingTurnAction || state.currentTurnPlayerId !== playerId) return;
    const player = state.players[playerId];
    if (!player.isAlive || player.hand.length < 2) return;
    
    if (checkCountessConstraint(player.hand) && card.type !== CardType.Countess) {
        if (!player.isBot) {
            showModal("提示", "<p>當手中持有王子或國王時，必須先打出伯爵夫人！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
        }
        return;
    }

    if (!player.isBot && card.type === CardType.Princess && player.hand.length === 2) {
        const other = player.hand.find(c => c.id !== card.id);
        if (other && other.type !== CardType.Princess) {
           showModal("提示", "<p>公主不能主動打出！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
           return;
        }
    }

    await executePlayCard(playerId, card);
}

async function executePlayCard(playerId: number, card: Card) {
    const player = state.players[playerId];
    const rollback = player.isBot ? undefined : createPlayRollback(playerId);
    isResolvingTurnAction = true;
    player.hand = player.hand.filter(c => c.id !== card.id);
    pruneInvalidKnownCardsForPlayer(playerId);
    player.discardPile.push(card);
    player.isProtected = false;

    addLog(`${player.name} 打出了 ${card.name} (${card.value})`);
    syncOnlineGameState();
    
    await applyEffect(playerId, card, true, rollback);
    if (modalOverlay.style.display !== 'flex') {
        syncOnlineGameState();
    }
}

function getAlivePlayers(): Player[] {
    return state.players.filter(player => player.isAlive);
}

function findNextAlivePlayerId(afterPlayerId: number): number | null {
    const totalPlayers = state.players.length;
    if (totalPlayers === 0) return null;

    const startIndex = ((afterPlayerId % totalPlayers) + totalPlayers) % totalPlayers;
    for (let offset = 1; offset <= totalPlayers; offset++) {
        const candidateId = (startIndex + offset) % totalPlayers;
        const candidate = state.players[candidateId];
        if (candidate?.isAlive) {
            return candidateId;
        }
    }

    return null;
}

function handoffTurnIfCurrentPlayerWasEliminated(eliminatedPlayerId: number) {
    if (
        state.isGameOver ||
        state.currentTurnPlayerId !== eliminatedPlayerId
    ) {
        syncOnlineGameState();
        return;
    }

    const survivors = getAlivePlayers();
    if (survivors.length <= 1) {
        if (survivors.length === 1) {
            endGame(survivors[0], `場上只剩下最後一名存活者`);
        }
        syncOnlineGameStateThenRender();
        return;
    }

    const nextId = findNextAlivePlayerId(eliminatedPlayerId);
    if (nextId === null) {
        syncOnlineGameStateThenRender();
        return;
    }

    state.currentTurnPlayerId = nextId;
    selectedCardId = null;
    isResolvingTurnAction = false;
    syncOnlineGameStateThenRender();

    if (state.players[nextId].isBot) {
        queueBotTurn(nextId);
    }
}

function queueBotTurn(botId: number) {
    queuedBotTurnId = botId;
    window.setTimeout(() => {
        if (
            queuedBotTurnId !== botId ||
            state.isGameOver ||
            state.currentTurnPlayerId !== botId ||
            !state.players[botId]?.isAlive
        ) {
            return;
        }

        queuedBotTurnId = null;
        void botTurn(botId);
    }, 0);
}

async function finishEffectTurn(actorId: number, shouldEndTurn: boolean) {
    if (!shouldEndTurn) {
        isResolvingTurnAction = false;
        render();
        syncOnlineGameState();
        return;
    }

    if (!state.isGameOver) {
        await endTurn(actorId);
    }
}

async function endTurn(playerId: number) {
    if (state.isGameOver) {
        syncOnlineGameStateThenRender();
        return;
    }
    
    checkEndConditions();

    if (!state.isGameOver) {
        const survivors = getAlivePlayers();
        if (survivors.length <= 1) {
            if (survivors.length === 1) {
                endGame(survivors[0], `作為最後的倖存者`);
            }
            return;
        }

        const nextId = findNextAlivePlayerId(playerId);
        if (nextId === null) {
            selectedCardId = null;
            isResolvingTurnAction = false;
            addLog("找不到下一位存活玩家，回合停止。");
            syncOnlineGameStateThenRender();
            return;
        }

        state.currentTurnPlayerId = nextId;
        selectedCardId = null;
        isResolvingTurnAction = false;
        syncOnlineGameStateThenRender();

        if (state.players[nextId].isBot) {
            // 不需要外部 setTimeout，因為 botTurn 內部會等待
            queueBotTurn(nextId);
        }
    }
}

async function applyEffect(playerId: number, card: Card, shouldEndTurn = true, rollback?: PlayRollback, isForcedResolution = false) {
    const player = state.players[playerId];
    const canControlInteractiveEffect = isLocalEffectController(playerId) || (isForcedResolution && playerId === localPlayerId);

    if (card.type === CardType.Princess) {
        eliminate(playerId, "打出或棄掉了公主");
        if (shouldEndTurn && !state.isGameOver) await endTurn(playerId);
        return;
    }

    if ([1, 2, 3, 5, 6].includes(card.value)) {
        let allPotentialTargets = state.players.filter(p => p.isAlive && !p.isProtected);
        if (card.type !== CardType.Prince) {
            allPotentialTargets = allPotentialTargets.filter(p => p.id !== playerId);
        }

        if (allPotentialTargets.length === 0) {
            addLog("沒有合法的目標，效果失效。");
            if (shouldEndTurn) await endTurn(playerId);
            else {
                render();
                syncOnlineGameState();
            }
            return;
        }

        if (player.isBot) {
            let botTargets = allPotentialTargets;
            if (card.type === CardType.Prince) {
                const opponentTargets = allPotentialTargets.filter(target => target.id !== playerId);
                botTargets = opponentTargets.length > 0 ? opponentTargets : allPotentialTargets.filter(target => target.id === playerId);
            } else if (card.type === CardType.Baron) {
                const safeTargets = getSafeBaronTargets(player, card, botTargets);
                if (safeTargets.length > 0) {
                    botTargets = safeTargets;
                }
            }

            const knownGuardTarget = card.type === CardType.Guard
                ? getKnownGuardTarget(playerId, botTargets)
                : null;
            const target = knownGuardTarget ?? botTargets[Math.floor(Math.random() * botTargets.length)];
            await sleep(1000); // 模擬選標準備
            await resolveTargetEffect(playerId, target.id, card, shouldEndTurn);
        } else if (canControlInteractiveEffect) {
            await new Promise<void>(resolve => {
                showModal(`請選擇 ${card.name} 的目標`, createTargetSelectModalBodyHTML(card, allPotentialTargets), cancelButtonHTML());
                bindCancelRollback(rollback);

                const btns = modalBody.querySelectorAll('.target-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const targetId = parseInt((btn as HTMLElement).dataset.id!);
                        closeModal();
                        await resolveTargetEffect(playerId, targetId, card, shouldEndTurn, rollback);
                        resolve();
                    };
                });
            });
        } else {
            render();
        }
    } else {
        if (card.type === CardType.Handmaid) {
            player.isProtected = true;
            addLog(`${player.name} 獲得了侍女的保護。`);
        }
        if (shouldEndTurn) await endTurn(playerId);
        else {
            render();
            syncOnlineGameState();
        }
    }
}

async function resolveTargetEffect(actorId: number, targetId: number, card: Card, shouldEndTurn = true, rollback?: PlayRollback) {
    const actor = state.players[actorId];
    const target = state.players[targetId];

    switch (card.type) {
        case CardType.Guard:
            if (!actor.isBot && isLocalEffectController(actorId)) {
                await new Promise<void>(resolve => {
                let buttonsHTML = '<div class="guess-grid">';
                for (let i = 2; i <= 8; i++) {
                    const def = CARD_DEFINITIONS[i as CardType];
                    buttonsHTML += `<button class="guess-btn" data-value="${i}">
                        <span style="font-weight:bold;">${i}</span>
                        <span>${def.name}</span>
                    </button>`;
                }
                buttonsHTML += '</div>';
                showModal(`對 ${target.name} 使用衛兵`, createStatsModalBodyHTML("<p>請猜測目標的手牌：</p>" + buttonsHTML), cancelButtonHTML());
                bindCancelRollback(rollback);
                
                const btns = modalBody.querySelectorAll('.guess-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const val = parseInt((btn as HTMLElement).dataset.value!);
                        const playedGuard = recordGuardGuess(actor, target, val as CardType);
                        const guessedName = CARD_DEFINITIONS[val as CardType].name;
                        closeModal();
                        addLog(`${actor.name} 對 ${target.name} 猜測 ${val} (${guessedName})`);
                        if (target.hand[0].value === val) {
                            if (playedGuard) {
                                playedGuard.actionHints = [
                                    { text: `🎯 對 ${target.name} 猜 ${guessedName}` },
                                    { text: `💥 猜中了！${target.name}出局`, variant: 'danger' }
                                ];
                            }
                            addLog("猜中了！");
                            eliminate(targetId, "被衛兵猜中手牌");
                            if (shouldEndTurn && !state.isGameOver) await endTurn(actorId);
                        } else {
                            if (playedGuard) {
                                playedGuard.actionHints = [
                                    { text: `🎯 對 ${target.name} 猜 ${guessedName}` },
                                    { text: '❌ 猜錯了', variant: 'tie' }
                                ];
                            }
                            addLog("猜錯了。");
                            if (shouldEndTurn) await endTurn(actorId);
                            else {
                                render();
                                syncOnlineGameState();
                            }
                        }
                        resolve();
                    };
                });
                });
            } else if (!actor.isBot) {
                render();
            } else {
                const guessNum = getAISmartGuess(actorId, targetId);
                const playedGuard = recordGuardGuess(actor, target, guessNum as CardType);
                const guessedName = CARD_DEFINITIONS[guessNum as CardType].name;
                addLog(`${actor.name} 對 ${target.name} 猜測 ${guessNum} (${CARD_DEFINITIONS[guessNum as CardType].name})`);
                if (target.hand[0].value === guessNum) {
                    if (playedGuard) {
                        playedGuard.actionHints = [
                            { text: `🎯 對 ${target.name} 猜 ${guessedName}` },
                            { text: `💥 猜中了！${target.name}出局`, variant: 'danger' }
                        ];
                    }
                    addLog("猜中了！");
                    eliminate(targetId, "被衛兵猜中手牌");
                    if (shouldEndTurn && !state.isGameOver) await endTurn(actorId);
                } else {
                    if (playedGuard) {
                        playedGuard.actionHints = [
                            { text: `🎯 對 ${target.name} 猜 ${guessedName}` },
                            { text: '❌ 猜錯了', variant: 'tie' }
                        ];
                    }
                    addLog("猜錯了。");
                    if (shouldEndTurn) await endTurn(actorId);
                    else {
                        render();
                        syncOnlineGameState();
                    }
                }
            }
            break;

        case CardType.Priest:
            if (actor.isBot && target.hand[0]) {
                rememberKnownCard(actorId, targetId, target.hand[0].type);
            }
            const playedPriest = actor.discardPile.find(discarded => discarded.id === card.id) ?? card;
            const priestPublicHint = `\u{1F3AF} \u5C0D ${target.name} \u4F7F\u7528`;
            card.actionHints = [{ text: priestPublicHint, variant: 'default' }];
            playedPriest.actionHints = [{ text: priestPublicHint, variant: 'default' }];
            delete card.privateActionHints;
            delete card.privateHintOwnerId;
            delete playedPriest.privateActionHints;
            delete playedPriest.privateHintOwnerId;
            if (!actor.isBot && target.hand[0]) {
                const privatePriestHint = `\u{1F3AF} \u770B\u898B\u4E86 ${target.name} \u7684 ${target.hand[0].name}(${target.hand[0].value})`;
                const privateHints: CardActionHint[] = [{ text: privatePriestHint, variant: 'default' }];
                card.privateActionHints = privateHints;
                card.privateHintOwnerId = actorId;
                playedPriest.privateActionHints = privateHints;
                playedPriest.privateHintOwnerId = actorId;
            }
            render();
            addLog(`${actor.name} \u770B\u4E86\u4E00\u4E0B ${target.name} \u7684\u624B\u724C\u3002`);
            syncOnlineGameState();
            if (!actor.isBot) {
                await new Promise<void>(resolve => {
                const cardUI = createCardUI(target.hand[0], false);
                cardUI.style.margin = '0 auto';
                showModal(`神父：看見 ${target.name} 的手牌`, createStatsModalBodyHTML(cardUI.outerHTML), `<button class="modal-confirm-btn" id="modal-ok-btn">我了解了</button>`);
                document.getElementById('modal-ok-btn')!.onclick = async () => {
                    closeModal();
                    if (shouldEndTurn) await endTurn(actorId);
                    else {
                        render();
                        syncOnlineGameState();
                    }
                    resolve();
                };
                });
            } else {
                if (shouldEndTurn) await endTurn(actorId);
                else {
                    render();
                    syncOnlineGameState();
                }
            }
            break;

        case CardType.Baron:
            addLog(`${actor.name} 與 ${target.name} 秘密比大小！`);
            await sleep(1000);
            if (actor.hand.length === 0 || target.hand.length === 0) {
                addLog("無法比點數，因為其中一方沒有手牌。");
                if (shouldEndTurn) await endTurn(actorId);
                else {
                    render();
                    syncOnlineGameState();
                }
                break;
            }

            const actorCard = actor.hand[0];
            const targetCard = target.hand[0];

            if (isOnlineGameActive() && !pendingBaronDuel) {
                pendingBaronDuel = {
                    actorId,
                    targetId,
                    actorCard,
                    targetCard,
                    sourceCardId: card.id,
                    confirmedPlayerIds: [
                        ...(actor.isBot ? [actorId] : []),
                        ...(target.isBot ? [targetId] : [])
                    ]
                };
                render();
                syncOnlineGameState();
            }

            if (isOnlineGameActive() && pendingBaronDuel && isSameBaronDuel(pendingBaronDuel, {
                actorId,
                targetId,
                actorCard,
                targetCard,
                sourceCardId: card.id,
                confirmedPlayerIds: []
            })) {
                if (isLocalBaronDuelParticipant(pendingBaronDuel) && !hasConfirmedBaronDuel(pendingBaronDuel, localPlayerId)) {
                    await showBaronDuelModal(clonePendingBaronDuel(pendingBaronDuel));
                }
                await waitForBaronDuelConfirmations(pendingBaronDuel);
                pendingBaronDuel = null;
                syncOnlineGameState();
            } else if (!actor.isBot || !target.isBot) {
                await waitForStatsModalConfirm(
                    '男爵對決提示',
                    `<p>${actor.name} 將與 ${target.name} 秘密比大小。</p><p>按下開始後會公開比牌結果並繼續結算。</p>`,
                    '開始比牌'
                );
            }

            const aVal = actorCard.value;
            const tVal = targetCard.value;
            const aliveBeforeCompare = state.players.filter(p => p.isAlive).length;

            if (aVal > tVal) {
                card.actionHints = [
                    { text: `🎯 對 ${target.name} 比大小` },
                    { text: `❌ ${target.name}輸了 (${targetCard.name})`, variant: 'danger' }
                ];
                if (aliveBeforeCompare === 2) {
                    actor.isHandRevealed = true;
                    target.isHandRevealed = true;
                    addLog(`最後兩名對決者攤牌：${actor.name} 亮出 ${actorCard.name}(${aVal})，${target.name} 亮出 ${targetCard.name}(${tVal})。`);
                } else {
                    target.isHandRevealed = true;
                    addLog(`${actor.name} 與 ${target.name} 比點數，${target.name} 點數較小，攤牌 ${targetCard.name}(${tVal}) 出局！`);
                }
                render();
                syncOnlineGameState();
                await sleep(2000);
                eliminate(targetId, "男爵比輸了");
                await finishEffectTurn(actorId, shouldEndTurn);
            } else if (aVal < tVal) {
                card.actionHints = [
                    { text: `🎯 對 ${target.name} 比大小` },
                    { text: `❌ ${actor.name}輸了 (${actorCard.name})`, variant: 'danger' }
                ];
                if (aliveBeforeCompare === 2) {
                    actor.isHandRevealed = true;
                    target.isHandRevealed = true;
                    addLog(`最後兩名對決者攤牌：${actor.name} 亮出 ${actorCard.name}(${aVal})，${target.name} 亮出 ${targetCard.name}(${tVal})。`);
                } else {
                    actor.isHandRevealed = true;
                    addLog(`${actor.name} 與 ${target.name} 比點數，${actor.name} 點數較小，攤牌 ${actorCard.name}(${aVal}) 出局！`);
                }
                render();
                syncOnlineGameState();
                await sleep(2000);
                eliminate(actorId, "男爵比輸了");
                await finishEffectTurn(actorId, shouldEndTurn);
            } else {
                card.actionHints = [
                    { text: `🎯 對 ${target.name} 比大小` },
                    { text: '🤝 平手', variant: 'tie' }
                ];
                rememberKnownCard(actorId, targetId, targetCard.type);
                rememberKnownCard(targetId, actorId, actorCard.type);
                addLog(`${actor.name} 與 ${target.name} 點數相同，平安無事。`);
                if (shouldEndTurn) await endTurn(actorId);
                else {
                    render();
                    syncOnlineGameState();
                }
            }
            break;

        case CardType.Prince:
            card.actionHints = [
                { text: `🎯 對 ${target.name} 使用` }
            ];
            addLog(`${actor.name} 強迫 ${target.name} 棄牌！`);
            await sleep(500);
            if (!target.isBot) {
                await waitForStatsModalConfirm(
                    '王子效果',
                    `<p>${actor.name} 指定 ${target.name} 棄掉目前手牌並重抽。</p>`,
                    '繼續'
                );
            }
            const princeDiscardResult = await discardAndDraw(targetId, actorId, shouldEndTurn);
            if (princeDiscardResult.discarded) {
                card.actionHints = [
                    { text: `🎯 對 ${target.name} 使用` },
                    { text: `🗑️ 丟棄了 ${princeDiscardResult.discarded.name}` }
                ];
            }
            if (princeDiscardResult.hasPendingForcedEffect) {
                render();
                syncOnlineGameState();
                break;
            }
            if (shouldEndTurn) await endTurn(actorId);
            else {
                render();
                syncOnlineGameState();
            }
            break;

        case CardType.King:
            card.actionHints = [
                { text: `🎯 對 ${target.name} 交換手牌` }
            ];
            addLog(`${actor.name} 與 ${target.name} 交換手牌！`);
            await sleep(500);
            if (isOnlineGameActive() && !pendingKingExchange) {
                pendingKingExchange = {
                    actorId,
                    targetId,
                    sourceCardId: card.id,
                    confirmedPlayerIds: [
                        ...(actor.isBot ? [actorId] : []),
                        ...(target.isBot ? [targetId] : [])
                    ]
                };
                render();
                syncOnlineGameState();
            }

            if (isOnlineGameActive() && pendingKingExchange && isSameKingExchange(pendingKingExchange, {
                actorId,
                targetId,
                sourceCardId: card.id,
                confirmedPlayerIds: []
            })) {
                if (isLocalKingExchangeParticipant(pendingKingExchange) && !hasConfirmedKingExchange(pendingKingExchange, localPlayerId)) {
                    await showKingExchangeModal(clonePendingKingExchange(pendingKingExchange));
                }
                await waitForKingExchangeConfirmations(pendingKingExchange);
                pendingKingExchange = null;
                syncOnlineGameState();
            } else if (!actor.isBot || !target.isBot) {
                await waitForStatsModalConfirm(
                    '國王交換手牌',
                    `<p>${actor.name} 即將與 ${target.name} 交換手牌。</p>`,
                    '確認交換'
                );
            }
            const actorTransferredCard = actor.hand[0];
            const targetTransferredCard = target.hand[0];
            const temp = actor.hand;
            actor.hand = target.hand;
            target.hand = temp;
            clearKnownCardForPlayer(actorId);
            clearKnownCardForPlayer(targetId);
            if (actorTransferredCard) {
                rememberKnownCard(actorId, targetId, actorTransferredCard.type);
            }
            if (targetTransferredCard) {
                rememberKnownCard(targetId, actorId, targetTransferredCard.type);
            }
            if (!actor.isBot || !target.isBot) {
                await waitForStatsModalConfirm(
                    '國王交換完成',
                    `<p>${actor.name} 已與 ${target.name} 完成手牌交換。</p>`,
                    '我了解了'
                );
            }
            if (shouldEndTurn) await endTurn(actorId);
            else {
                render();
                syncOnlineGameState();
            }
            break;
    }
}

function getAISmartGuess(botId: number, targetId: number): number {
    const rememberedType = state.aiMemory[botId]?.[targetId];
    if (rememberedType) {
        const targetStillHasRememberedCard = state.players[targetId].hand.some(card => card.type === rememberedType);
        if (!targetStillHasRememberedCard) {
            delete state.aiMemory[botId][targetId];
        } else if (rememberedType !== CardType.Guard) {
            return rememberedType;
        }
    }

    const knownCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    state.players.forEach(p => {
        p.discardPile.forEach(c => knownCounts[c.value]++);
    });
    state.players[botId].hand.forEach(c => knownCounts[c.value]++);

    const possibleGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
            possibleGuesses.push(i);
        }
    }
    return possibleGuesses.length > 0 ? possibleGuesses[Math.floor(Math.random() * possibleGuesses.length)] : 2;
}

async function discardAndDraw(targetId: number, returnTurnPlayerId: number, shouldEndTurnAfterResolution: boolean): Promise<PrinceDiscardResult> {
    const player = state.players[targetId];
    if (player.hand.length === 0) {
        return { discarded: null, hasPendingForcedEffect: false };
    }
    clearKnownCardForPlayer(targetId);
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
    addLog(`${player.name} 棄掉了 ${discarded.name}`);

    if (discarded.type === CardType.Princess) {
        eliminate(targetId, "棄掉了公主");
        return { discarded, hasPendingForcedEffect: false };
    }

    if (state.deck.length > 0) {
        const newCard = state.deck.pop()!;
        player.hand.push(newCard);
        addLog(`${player.name} 補抽了一張牌。`);
    } else if (state.burnedCard) {
        player.hand.push(state.burnedCard);
        state.burnedCard = null;
        addLog(`${player.name} 補抽了燒掉的牌。`);
    }

    if (isForcedEffectCard(discarded) && isOnlineGameActive() && targetId !== localPlayerId) {
        const inheritedReturnTurnPlayerId = resolvingForcedEffect && !shouldEndTurnAfterResolution
            ? resolvingForcedEffect.returnTurnPlayerId
            : returnTurnPlayerId;
        const inheritedShouldEndTurn = resolvingForcedEffect && !shouldEndTurnAfterResolution
            ? resolvingForcedEffect.shouldEndTurnAfterResolution
            : shouldEndTurnAfterResolution;
        pendingForcedEffectsQueue = [
            ...pendingForcedEffectsQueue,
            {
                reactorId: targetId,
                card: discarded,
                sourcePlayerId: returnTurnPlayerId,
                returnTurnPlayerId: inheritedReturnTurnPlayerId,
                shouldEndTurnAfterResolution: inheritedShouldEndTurn
            }
        ];
        render();
        syncOnlineGameState();
        return { discarded, hasPendingForcedEffect: true };
    }

    await applyEffect(targetId, discarded, false);
    if (state.isGameOver || !player.isAlive) {
        return { discarded, hasPendingForcedEffect: false };
    }

    if (modalOverlay.style.display !== 'flex') {
        render();
        syncOnlineGameState();
    }
    return { discarded, hasPendingForcedEffect: false };
}

function eliminate(playerId: number, reason: string) {
    const player = state.players[playerId];
    if (!player || !player.isAlive) return;

    clearKnownCardForPlayer(playerId);
    player.isAlive = false;
    player.discardPile.push(...player.hand);
    player.hand = [];
    addLog(`${player.name}${reason}出局了！`);
    
    const survivors = getAlivePlayers();
    if (survivors.length === 1) {
        endGame(survivors[0], `作為最後的倖存者`);
    } else {
        handoffTurnIfCurrentPlayerWasEliminated(playerId);
    }

    syncOnlineGameStateThenRender();
}

function checkEndConditions() {
    if (state.isGameOver) return;
    
    if (state.deck.length === 0) {
        const survivors = state.players.filter(p => p.isAlive);
        if (survivors.every(p => p.hand.length === 1)) {
            addLog("牌堆已空，存活者比大小！");
            survivors.sort((a, b) => {
                if (b.hand[0].value !== a.hand[0].value) {
                    return b.hand[0].value - a.hand[0].value;
                }
                const aSum = a.discardPile.reduce((s, c) => s + c.value, 0);
                const bSum = b.discardPile.reduce((s, c) => s + c.value, 0);
                return bSum - aSum;
            });
            endGame(survivors[0], `比點數獲勝 (${survivors[0].hand[0].value})`);
        }
    }
}

function getRankedPlayers() {
    const sortedPlayers = [...state.players].sort((a, b) => b.coins - a.coins);
    let currentRank = 0;
    let lastCoins: number | null = null;

    return sortedPlayers.map(player => {
        if (lastCoins === null || player.coins < lastCoins) {
            currentRank += 1;
            lastCoins = player.coins;
        }

        return {
            player,
            rank: currentRank
        };
    });
}

function getLeagueChampion(): Player | null {
    return state.players.find(player => player.coins >= 4) ?? null;
}

function createRankingHTML(): string {
    const rows = getRankedPlayers().map(({ player, rank }) => `
        <div style="display: grid; grid-template-columns: 4rem 1fr auto; align-items: center; gap: 0.8rem; padding: 0.75rem 0.85rem; border-radius: 8px; background: ${rank === 1 ? 'rgba(255, 176, 0, 0.18)' : 'rgba(255,255,255,0.06)'}; border: 1px solid ${rank === 1 ? 'rgba(255, 176, 0, 0.38)' : 'rgba(255,255,255,0.08)'};">
            <strong style="color: ${rank === 1 ? '#ffb000' : '#f2f2f2'};">第 ${rank} 名</strong>
            <span style="font-weight: 700;">${player.name}</span>
            <span style="font-size: 1.25rem;">${player.coins > 0 ? getCoinIcons(player.coins) : '<span style="font-size: 0.9rem; color: #999;">尚未得分</span>'}</span>
        </div>
    `).join('');

    return `
        <div style="text-align: left; line-height: 1.6;">
            <div style="text-align: center; margin-bottom: 1rem;">
                <h3 style="margin: 0 0 0.35rem; color: #ffb000; font-size: 1.65rem;">目前聯賽排行榜</h3>
                <p style="margin: 0; color: #ddd;">先取得 4 枚硬幣的玩家，成為 Love Letter 總冠軍。</p>
            </div>
            <div style="display: grid; gap: 0.65rem;">
                ${rows}
            </div>
        </div>
    `;
}

function showChampionModal() {
    const champion = getLeagueChampion();
    if (!champion) return;

    showModal("聯賽總冠軍", `
        <div style="text-align: center; line-height: 1.6; padding: 0.35rem 0;">
            <div style="font-size: 3rem; margin-bottom: 0.3rem;">♛</div>
            <h3 style="margin: 0; color: #ffb000; font-size: 1.85rem;">${champion.name}</h3>
            <p style="margin: 0.65rem 0 0; font-size: 1.05rem;">
                最終拿滿 4 枚硬幣的 Love Letter 總冠軍大贏家！🎉
            </p>
            <div style="margin-top: 1rem; font-size: 1.65rem;">${getCoinIcons(champion.coins)}</div>
        </div>
    `, `<button class="modal-confirm-btn" id="champion-return-btn">返回</button>`);

    document.getElementById('champion-return-btn')!.onclick = closeModal;
}

function endGame(winner: Player, reason: string) {
    if (state.isGameOver) return;

    queuedBotTurnId = null;
    selectedCardId = null;
    isResolvingTurnAction = false;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    state.isGameOver = true;
    state.winner = winner;
    endGameReason = reason;
    winner.coins += 1;
    addLog(`【遊戲結束】${winner.name} 獲勝並獲得 1 枚硬幣！(${reason})`);
    render();
    syncOnlineGameState();
    showEndGameModal();
}

function showEndGameModal() {
    if (!state.winner) return;

    hasShownEndGameModal = true;
    showResultBtn.style.display = 'block';

    const champion = getLeagueChampion();
    const primaryButton = champion
        ? `<button class="modal-confirm-btn" id="view-champion-btn">查看獲勝者</button>`
        : `<button class="modal-confirm-btn" id="next-round-btn">開始下一局</button>`;

    showModal("本局結果", `
        <div style="text-align: center; margin-bottom: 1rem;">
            <h3 style="margin: 0; color:#ff4d4d; font-size: 1.65rem;">${state.winner.name} 獲勝！</h3>
            <p style="margin: 0.35rem 0 0;">${endGameReason}</p>
        </div>
        ${createRankingHTML()}
    `, `${primaryButton}<button class="modal-confirm-btn" id="ranking-return-btn" style="margin-left: 0.65rem; background: #64748b;">返回</button>`);

    const rankingReturnBtn = document.getElementById('ranking-return-btn')!;
    rankingReturnBtn.textContent = '📊 留在戰場查看紀錄';

    const nextRoundBtn = document.getElementById('next-round-btn');
    if (nextRoundBtn) {
        nextRoundBtn.onclick = () => {
            closeModal();
            requestNextRound();
        };
    }

    const viewChampionBtn = document.getElementById('view-champion-btn');
    if (viewChampionBtn) {
        viewChampionBtn.onclick = showChampionModal;
    }

    rankingReturnBtn.onclick = () => {
        closeModal();
        showResultBtn.style.display = 'block';
    };
}

// 8. AI 回合優化
function showBattleLogModal() {
    const logsHTML = state.logs.length
        ? state.logs.map(log => `<div class="log-entry">${log}</div>`).join('')
        : '<p class="modal-helper-text">目前還沒有對戰紀錄。</p>';

    showModal('對戰紀錄', `
        <div class="modal-log-container">
            ${logsHTML}
        </div>
    `, '<button class="modal-confirm-btn" id="battle-log-close-btn">關閉</button>');

    const logContainer = document.querySelector<HTMLElement>('.modal-log-container');
    if (logContainer) {
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    document.getElementById('battle-log-close-btn')!.onclick = closeModal;
}

function getAICardPlayWeight(bot: Player, card: Card): number {
    const remainingCard = bot.hand.find(handCard => handCard.id !== card.id);
    let weight = 10;

    switch (card.type) {
        case CardType.Guard:
            weight = 18;
            break;
        case CardType.Priest:
            weight = 12;
            break;
        case CardType.Baron:
            weight = 8;
            if (remainingCard) {
                const legalTargets = getBaronLegalTargets(bot);
                if (legalTargets.some(target => isKnownBaronLoss(bot, card, target))) {
                    weight = 0;
                    break;
                }
                if (remainingCard.value <= CardType.Guard) weight = 0.1;
                else if (remainingCard.value <= CardType.Priest) weight = 2;
                else if (remainingCard.value >= CardType.Prince) weight = 15;
            }
            break;
        case CardType.Handmaid:
            weight = 9;
            break;
        case CardType.Prince:
            weight = 10;
            break;
        case CardType.King:
            weight = 7;
            break;
        case CardType.Countess:
            weight = 6;
            break;
        case CardType.Princess:
            weight = 0.1;
            break;
    }

    return weight;
}

function chooseAICardToPlay(bot: Player): Card {
    const guard = bot.hand.find(card => card.type === CardType.Guard);
    if (guard) {
        const guardTargets = state.players.filter(player => (
            player.id !== bot.id &&
            player.isAlive &&
            !player.isProtected
        ));
        if (getKnownGuardTarget(bot.id, guardTargets)) return guard;
    }

    const baron = bot.hand.find(card => card.type === CardType.Baron);
    if (guard && baron) return guard;

    let playable = bot.hand.filter(card => card.type !== CardType.Princess);
    if (playable.length === 0) playable = bot.hand;

    const weightedCards = playable.map(card => ({
        card,
        weight: Math.max(0, getAICardPlayWeight(bot, card))
    }));
    let totalWeight = weightedCards.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
        weightedCards.forEach(item => {
            item.weight = 1;
        });
        totalWeight = weightedCards.length;
    }
    let roll = Math.random() * totalWeight;

    for (const item of weightedCards) {
        roll -= item.weight;
        if (roll <= 0) return item.card;
    }

    return weightedCards[weightedCards.length - 1].card;
}

async function botTurn(botId: number) {
    if (state.isGameOver || state.currentTurnPlayerId !== botId || !state.players[botId]?.isAlive) return;
    
    // 階段 1：等待（模擬看牌準備）
    await sleep(1000);
    if (state.isGameOver || state.currentTurnPlayerId !== botId || !state.players[botId].isAlive) return;
    
    // 階段 2：抽牌
    if (!drawCard(botId)) {
        checkEndConditions();
        if (!state.isGameOver) {
            await endTurn(botId);
        }
        return;
    }
    
    // 階段 3：模擬思考
    await sleep(1200);
    if (state.isGameOver || state.currentTurnPlayerId !== botId || !state.players[botId].isAlive) return;
    
    const bot = state.players[botId];
    if (checkCountessConstraint(bot.hand)) {
        await handlePlayCardRequest(botId, bot.hand.find(c => c.type === CardType.Countess)!);
        return;
    }

    const hasPrince = bot.hand.some(c => c.type === CardType.Prince);
    const hasPrincess = bot.hand.some(c => c.type === CardType.Princess);
    const princeOpponentTargets = state.players.filter(p => p.id !== botId && p.isAlive && !p.isProtected);

    if (hasPrince && hasPrincess && princeOpponentTargets.length === 0) {
        await handlePlayCardRequest(botId, bot.hand.find(c => c.type === CardType.Princess)!);
        return;
    }

    const cardToPlay = chooseAICardToPlay(bot);
    
    await handlePlayCardRequest(botId, cardToPlay);
}

function escapeHTML(value: string): string {
    return value.replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[char]!);
}

function getPreferredPlayerName(): string {
    return localStorage.getItem('loveLetterPlayerName') || '玩家';
}

function setPreferredPlayerName(name: string) {
    localStorage.setItem('loveLetterPlayerName', name);
}

interface OnlineGameData {
    deck: Card[];
    burnedCard: Card | null;
    players: Player[];
    currentTurnPlayerId: number;
    logs: string[];
}

interface PendingForcedEffect {
    reactorId: number;
    card: Card;
    sourcePlayerId: number;
    returnTurnPlayerId: number;
    shouldEndTurnAfterResolution: boolean;
}

interface PendingBaronDuel {
    actorId: number;
    targetId: number;
    actorCard: Card;
    targetCard: Card;
    sourceCardId: string;
    confirmedPlayerIds: number[];
}

interface PendingKingExchange {
    actorId: number;
    targetId: number;
    sourceCardId: string;
    confirmedPlayerIds: number[];
}

interface OnlineGameStateData extends OnlineGameData {
    isGameOver: boolean;
    winner: Player | null;
    pendingForcedEffect?: PendingForcedEffect | null;
    pendingForcedEffectsQueue?: PendingForcedEffect[];
    pendingBaronDuel: PendingBaronDuel | null;
    pendingKingExchange?: PendingKingExchange | null;
    nextRoundReadyPlayerIds?: number[];
}

function getConnectionErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    return 'Cannot connect to the Colyseus server. Please confirm the backend is running.';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise
            .then(resolve)
            .catch(reject)
            .finally(() => window.clearTimeout(timeoutId));
    });
}

function toLobbyRoomSummary(room: RoomAvailable<LobbyRoomMetadata>): LobbyRoomSummary {
    return {
        roomId: room.roomId,
        playerCount: room.clients,
        maxClients: room.maxClients,
        hasPassword: room.metadata?.hasPassword ?? false,
        isGameStarted: room.metadata?.isGameStarted ?? false
    };
}

function upsertLobbyRoom(message: LobbyRoomAddMessage) {
    const room = Array.isArray(message) ? message[1] : message;
    if (room.name !== 'love_letter') return;
    if (room.metadata?.isGameStarted) {
        removeLobbyRoom(room.roomId);
        return;
    }

    const summary = toLobbyRoomSummary(room);
    const existingIndex = lobbyRooms.findIndex(candidate => candidate.roomId === summary.roomId);
    if (existingIndex >= 0) {
        lobbyRooms[existingIndex] = summary;
    } else {
        lobbyRooms = [summary, ...lobbyRooms];
    }

    renderLobbyList(lobbyRooms);
}

function removeLobbyRoom(roomId: string) {
    lobbyRooms = lobbyRooms.filter(room => room.roomId !== roomId);
    renderLobbyList(lobbyRooms);
}

function toRoomWaitPlayerView(player: Partial<SyncedRoomPlayerState> | null | undefined): RoomWaitPlayerView | null {
    if (!player || typeof player.id !== 'string' || player.id.length === 0) return null;

    return {
        id: player.id,
        name: typeof player.name === 'string' && player.name.trim().length > 0 ? player.name : '玩家',
        isReady: Boolean(player.isReady),
        isHost: Boolean(player.isHost),
        isConnected: player.isConnected ?? true
    };
}

function getSyncedPlayers(state: SyncedRoomState): RoomWaitPlayerView[] {
    const players = state.players;
    let playerList: unknown[] = [];

    if (players instanceof Map) {
        playerList = Array.from(players.values());
    } else if ('values' in players && typeof players.values === 'function') {
        playerList = Array.from(players.values());
    } else if (players && typeof players === 'object') {
        playerList = Object.values(players);
    }

    return playerList
        .map(player => toRoomWaitPlayerView(player as Partial<SyncedRoomPlayerState>))
        .filter((player): player is RoomWaitPlayerView => player !== null);
}

function normalizeRoomWaitState(roomState: RoomWaitViewState | SyncedRoomState): RoomWaitViewState {
    if (Array.isArray((roomState as RoomWaitViewState).players)) {
        const viewState = roomState as RoomWaitViewState;
        return {
            ...viewState,
            players: viewState.players
                .map(player => toRoomWaitPlayerView(player))
                .filter((player): player is RoomWaitPlayerView => player !== null)
        };
    }

    const syncedState = roomState as SyncedRoomState;
    return {
        roomId: syncedState.roomId || activeGameRoom?.roomId || '-',
        players: getSyncedPlayers(syncedState),
        selfId: activeGameRoom?.sessionId || '',
        isGameStarted: syncedState.isGameStarted
    };
}

function createOnlinePlayers(roomPlayers: RoomWaitPlayerView[]): Player[] {
    return roomPlayers.map((roomPlayer, index) => ({
        id: index,
        name: roomPlayer.name,
        isBot: false,
        coins: 0,
        hand: [],
        isProtected: false,
        isAlive: true,
        discardPile: [],
        isHandRevealed: false
    }));
}

function createInitialOnlineGameData(roomState: RoomWaitViewState): OnlineGameData {
    let deck = createDeck();
    deck = shuffle(deck);
    const burnedCard = deck.pop() || null;
    const players = createOnlinePlayers(roomState.players);

    players.forEach(player => {
        player.hand = [deck.pop()!];
    });

    return {
        deck,
        burnedCard,
        players,
        currentTurnPlayerId: 0,
        logs: ['多人遊戲開始，房主已同步初始牌局。']
    };
}

function isOnlineGameActive(): boolean {
    return Boolean(activeGameRoom && onlineGameInitialized);
}

function cloneCardForOnlineSync(card: Card): Card {
    const { privateActionHints, privateHintOwnerId, actionHints, ...publicCard } = card;
    void privateActionHints;
    void privateHintOwnerId;
    return {
        ...publicCard,
        ...(actionHints ? { actionHints: actionHints.map(hint => ({ ...hint })) } : {})
    };
}

function cloneOnlinePlayer(player: Player): Player {
    return {
        ...player,
        hand: player.hand.map(cloneCardForOnlineSync),
        discardPile: player.discardPile.map(cloneCardForOnlineSync),
        isBot: false
    };
}

function restoreLocalPrivateHints(players: Player[]): Player[] {
    const previousLocalPlayer = state.players[localPlayerId];
    const incomingLocalPlayer = players[localPlayerId];
    if (!previousLocalPlayer || !incomingLocalPlayer) return players;

    const privateHintsByCardId = new Map<string, Pick<Card, 'privateActionHints' | 'privateHintOwnerId'>>();
    [...previousLocalPlayer.hand, ...previousLocalPlayer.discardPile].forEach(card => {
        if (card.privateHintOwnerId === localPlayerId && card.privateActionHints?.length) {
            privateHintsByCardId.set(card.id, {
                privateActionHints: card.privateActionHints.map(hint => ({ ...hint })),
                privateHintOwnerId: card.privateHintOwnerId
            });
        }
    });

    const restoreCard = (card: Card): Card => {
        const privateHint = privateHintsByCardId.get(card.id);
        return privateHint ? { ...card, ...privateHint } : card;
    };

    incomingLocalPlayer.hand = incomingLocalPlayer.hand.map(restoreCard);
    incomingLocalPlayer.discardPile = incomingLocalPlayer.discardPile.map(restoreCard);
    return players;
}

function createOnlineGameStateData(): OnlineGameStateData {
    return {
        deck: [...state.deck],
        burnedCard: state.burnedCard,
        players: state.players.map(cloneOnlinePlayer),
        currentTurnPlayerId: state.currentTurnPlayerId,
        isGameOver: state.isGameOver,
        winner: state.winner ? cloneOnlinePlayer(state.winner) : null,
        logs: [...state.logs],
        pendingForcedEffectsQueue: pendingForcedEffectsQueue.map(effect => ({
            ...effect,
            card: cloneCardForOnlineSync(effect.card)
        })),
        pendingBaronDuel: pendingBaronDuel ? {
            ...pendingBaronDuel,
            actorCard: cloneCardForOnlineSync(pendingBaronDuel.actorCard),
            targetCard: cloneCardForOnlineSync(pendingBaronDuel.targetCard),
            confirmedPlayerIds: [...pendingBaronDuel.confirmedPlayerIds]
        } : null,
        pendingKingExchange: pendingKingExchange ? {
            ...pendingKingExchange,
            confirmedPlayerIds: [...pendingKingExchange.confirmedPlayerIds]
        } : null,
        nextRoundReadyPlayerIds: [...nextRoundReadyPlayerIds]
    };
}

function syncOnlineGameState() {
    if (!isOnlineGameActive() || isApplyingOnlineState) return;

    const room = activeGameRoom;
    if (!room) return;

    try {
        room.send('sync_game_state', createOnlineGameStateData());
    } catch (error) {
        console.warn('Failed to sync online game state:', error);
    }
}

function syncOnlineGameStateThenRender() {
    syncOnlineGameState();
    render();
}

function isLocalEffectController(playerId: number) {
    return !isOnlineGameActive() || playerId === localPlayerId;
}

function isForcedEffectCard(card: Card) {
    return card.type !== CardType.Princess && card.type !== CardType.Handmaid;
}

function clonePendingForcedEffect(effect: PendingForcedEffect): PendingForcedEffect {
    return {
        ...effect,
        sourcePlayerId: effect.sourcePlayerId ?? effect.returnTurnPlayerId,
        card: { ...effect.card }
    };
}

function clonePendingForcedEffectsQueue(queue: PendingForcedEffect[] | undefined, fallback?: PendingForcedEffect | null) {
    if (queue) {
        return queue.map(clonePendingForcedEffect);
    }

    return fallback ? [clonePendingForcedEffect(fallback)] : [];
}

function clonePendingBaronDuel(duel: PendingBaronDuel): PendingBaronDuel {
    return {
        ...duel,
        actorCard: { ...duel.actorCard },
        targetCard: { ...duel.targetCard },
        confirmedPlayerIds: [...duel.confirmedPlayerIds]
    };
}

function clonePendingKingExchange(exchange: PendingKingExchange): PendingKingExchange {
    return {
        ...exchange,
        confirmedPlayerIds: [...exchange.confirmedPlayerIds]
    };
}

function isSamePendingForcedEffect(a: PendingForcedEffect | null, b: PendingForcedEffect | null) {
    return Boolean(
        a &&
        b &&
        a.reactorId === b.reactorId &&
        a.returnTurnPlayerId === b.returnTurnPlayerId &&
        a.shouldEndTurnAfterResolution === b.shouldEndTurnAfterResolution &&
        a.card.id === b.card.id
    );
}

function getBaronDuelKey(duel: PendingBaronDuel | null) {
    return duel ? `${duel.actorId}:${duel.targetId}:${duel.sourceCardId}:${duel.actorCard.id}:${duel.targetCard.id}` : null;
}

function isSameBaronDuel(a: PendingBaronDuel | null, b: PendingBaronDuel | null) {
    const aKey = getBaronDuelKey(a);
    const bKey = getBaronDuelKey(b);
    return Boolean(aKey && bKey && aKey === bKey);
}

function isLocalBaronDuelParticipant(duel: PendingBaronDuel | null) {
    return Boolean(duel && (duel.actorId === localPlayerId || duel.targetId === localPlayerId));
}

function hasConfirmedBaronDuel(duel: PendingBaronDuel | null, playerId: number) {
    return Boolean(duel?.confirmedPlayerIds.includes(playerId));
}

function confirmLocalBaronDuel(duel: PendingBaronDuel) {
    if (!pendingBaronDuel || !isSameBaronDuel(pendingBaronDuel, duel)) return;
    if (!pendingBaronDuel.confirmedPlayerIds.includes(localPlayerId)) {
        pendingBaronDuel.confirmedPlayerIds = [...pendingBaronDuel.confirmedPlayerIds, localPlayerId];
    }
    syncOnlineGameState();
}

function areBaronDuelParticipantsConfirmed(duel: PendingBaronDuel | null) {
    return Boolean(
        duel &&
        duel.confirmedPlayerIds.includes(duel.actorId) &&
        duel.confirmedPlayerIds.includes(duel.targetId)
    );
}

function createBaronDuelBodyHTML(duel: PendingBaronDuel) {
    const actor = state.players[duel.actorId];
    const target = state.players[duel.targetId];

    return `
        <p>${actor.name} 與 ${target.name} 展開男爵對決。</p>
        <div class="duel-card-row">
            <div>
                <strong>${actor.name}</strong>
                ${createCardUI(duel.actorCard, false).outerHTML}
            </div>
            <div>
                <strong>${target.name}</strong>
                ${createCardUI(duel.targetCard, false).outerHTML}
            </div>
        </div>
    `;
}

async function showBaronDuelModal(duel: PendingBaronDuel) {
    const duelKey = getBaronDuelKey(duel);
    if (!duelKey || activeBaronDuelModalKey === duelKey) return;

    activeBaronDuelModalKey = duelKey;
    isResolvingTurnAction = true;
    try {
        await waitForStatsModalConfirm('男爵對決', createBaronDuelBodyHTML(duel), '確認對決');
        confirmLocalBaronDuel(duel);
    } finally {
        if (activeBaronDuelModalKey === duelKey) {
            activeBaronDuelModalKey = null;
        }
    }
}

async function handlePendingBaronDuel() {
    if (!pendingBaronDuel || !isLocalBaronDuelParticipant(pendingBaronDuel)) return;
    if (hasConfirmedBaronDuel(pendingBaronDuel, localPlayerId)) return;

    await showBaronDuelModal(clonePendingBaronDuel(pendingBaronDuel));
}

function waitForBaronDuelConfirmations(duel: PendingBaronDuel): Promise<void> {
    return new Promise(resolve => {
        const wait = () => {
            if (!pendingBaronDuel || !isSameBaronDuel(pendingBaronDuel, duel) || areBaronDuelParticipantsConfirmed(pendingBaronDuel)) {
                resolve();
                return;
            }

            window.setTimeout(wait, 100);
        };

        wait();
    });
}

function getKingExchangeKey(exchange: PendingKingExchange | null) {
    return exchange ? `${exchange.actorId}:${exchange.targetId}:${exchange.sourceCardId}` : null;
}

function isSameKingExchange(a: PendingKingExchange | null, b: PendingKingExchange | null) {
    const aKey = getKingExchangeKey(a);
    const bKey = getKingExchangeKey(b);
    return Boolean(aKey && bKey && aKey === bKey);
}

function isLocalKingExchangeParticipant(exchange: PendingKingExchange | null) {
    return Boolean(exchange && (exchange.actorId === localPlayerId || exchange.targetId === localPlayerId));
}

function hasConfirmedKingExchange(exchange: PendingKingExchange | null, playerId: number) {
    return Boolean(exchange?.confirmedPlayerIds.includes(playerId));
}

function confirmLocalKingExchange(exchange: PendingKingExchange) {
    if (!pendingKingExchange || !isSameKingExchange(pendingKingExchange, exchange)) return;
    if (!pendingKingExchange.confirmedPlayerIds.includes(localPlayerId)) {
        pendingKingExchange.confirmedPlayerIds = [...pendingKingExchange.confirmedPlayerIds, localPlayerId];
    }
    syncOnlineGameState();
}

function areKingExchangeParticipantsConfirmed(exchange: PendingKingExchange | null) {
    return Boolean(
        exchange &&
        exchange.confirmedPlayerIds.includes(exchange.actorId) &&
        exchange.confirmedPlayerIds.includes(exchange.targetId)
    );
}

async function showKingExchangeModal(exchange: PendingKingExchange) {
    const exchangeKey = getKingExchangeKey(exchange);
    if (!exchangeKey || activeKingExchangeModalKey === exchangeKey) return;

    const actor = state.players[exchange.actorId];
    const target = state.players[exchange.targetId];
    activeKingExchangeModalKey = exchangeKey;
    isResolvingTurnAction = true;
    try {
        await waitForStatsModalConfirm(
            '國王交換手牌',
            `<p>${actor.name} 對 ${target.name} 打出國王，雙方即將交換手牌。</p>`,
            '確認交換'
        );
        confirmLocalKingExchange(exchange);
    } finally {
        if (activeKingExchangeModalKey === exchangeKey) {
            activeKingExchangeModalKey = null;
        }
    }
}

async function handlePendingKingExchange() {
    if (!pendingKingExchange || !isLocalKingExchangeParticipant(pendingKingExchange)) return;
    if (hasConfirmedKingExchange(pendingKingExchange, localPlayerId)) return;

    await showKingExchangeModal(clonePendingKingExchange(pendingKingExchange));
}

function waitForKingExchangeConfirmations(exchange: PendingKingExchange): Promise<void> {
    return new Promise(resolve => {
        const wait = () => {
            if (!pendingKingExchange || !isSameKingExchange(pendingKingExchange, exchange) || areKingExchangeParticipantsConfirmed(pendingKingExchange)) {
                resolve();
                return;
            }

            window.setTimeout(wait, 100);
        };

        wait();
    });
}

function isLocalForcedEffect(effect: PendingForcedEffect | null) {
    return effect?.reactorId === localPlayerId;
}

function getTopPendingForcedEffect(queue = pendingForcedEffectsQueue) {
    return queue.length > 0 ? queue[queue.length - 1] : null;
}

function hasLocalPendingForcedEffect(queue = pendingForcedEffectsQueue) {
    return queue.some(effect => effect.reactorId === localPlayerId);
}

function createForcedEffectNoticeBodyHTML(effect: PendingForcedEffect) {
    const attacker = state.players[effect.sourcePlayerId] ?? state.players[state.currentTurnPlayerId];
    const attackerName = attacker?.name ?? '對手';

    return `
        <p>玩家 ${attackerName} 對你打出了【王子】！</p>
        <p>你被迫棄掉了手中的【${effect.card.name}】並重新補抽。</p>
        <p>接下來將執行這張棄牌的連鎖效果。</p>
    `;
}

function isResolvingThisForcedEffect(effect: PendingForcedEffect | null) {
    return isSamePendingForcedEffect(resolvingForcedEffect, effect);
}

function isResolvingLocalForcedEffect(incomingPendingForcedEffectsQueue: PendingForcedEffect[]) {
    const incomingTopForcedEffect = getTopPendingForcedEffect(incomingPendingForcedEffectsQueue);
    return Boolean(
        isOnlineGameActive() &&
        isResolvingTurnAction &&
        (
            isLocalForcedEffect(resolvingForcedEffect) ||
            hasLocalPendingForcedEffect()
        ) &&
        (
            isHandlingPendingForcedEffect ||
            incomingPendingForcedEffectsQueue.length === 0 ||
            isResolvingThisForcedEffect(incomingTopForcedEffect) ||
            incomingPendingForcedEffectsQueue.some(effect => pendingForcedEffectsQueue.some(localEffect => isSamePendingForcedEffect(localEffect, effect)))
        )
    );
}

async function handlePendingForcedEffect() {
    const effect = getTopPendingForcedEffect();
    if (!effect || isHandlingPendingForcedEffect) return;
    if (effect.reactorId !== localPlayerId) {
        if (hasLocalPendingForcedEffect()) {
            isResolvingTurnAction = true;
        }
        return;
    }

    isHandlingPendingForcedEffect = true;
    pendingForcedEffectsQueue = pendingForcedEffectsQueue.slice(0, -1);
    resolvingForcedEffect = effect;
    isResolvingTurnAction = true;

    try {
        await waitForStatsModalConfirm(
            '【被迫棄牌連鎖】',
            createForcedEffectNoticeBodyHTML(effect),
            '確認並執行效果'
        );
        await applyEffect(effect.reactorId, effect.card, false, undefined, true);
        if (effect.shouldEndTurnAfterResolution && !state.isGameOver && pendingForcedEffectsQueue.length === 0) {
            await endTurn(effect.returnTurnPlayerId);
        } else {
            isResolvingTurnAction = false;
            render();
            syncOnlineGameState();
        }
    } finally {
        isResolvingTurnAction = false;
        resolvingForcedEffect = null;
        isHandlingPendingForcedEffect = false;
        if (!state.isGameOver) {
            syncOnlineGameState();
        }
        void handlePendingForcedEffect();
    }
}

function applyOnlineGameState(data: OnlineGameStateData) {
    const selfSessionId = activeGameRoom?.sessionId;
    const roomPlayers = currentRoomWaitState?.players ?? [];
    const selfIndex = roomPlayers.findIndex(player => player.id === selfSessionId);
    if (selfIndex >= 0) {
        localPlayerId = selfIndex;
    }

    const incomingPendingForcedEffectsQueue = clonePendingForcedEffectsQueue(
        data.pendingForcedEffectsQueue,
        data.pendingForcedEffect
    );
    const incomingPendingBaronDuel = data.pendingBaronDuel
        ? clonePendingBaronDuel(data.pendingBaronDuel)
        : null;
    const incomingPendingKingExchange = data.pendingKingExchange
        ? clonePendingKingExchange(data.pendingKingExchange)
        : null;

    if (data.isGameOver) {
        const shouldShowEndGameModal = !hasShownEndGameModal;
        isApplyingOnlineState = true;

        try {
            queuedBotTurnId = null;
            selectedCardId = null;
            isResolvingTurnAction = false;
            pendingForcedEffectsQueue = [];
            resolvingForcedEffect = null;
            pendingBaronDuel = null;
            activeBaronDuelModalKey = null;
            pendingKingExchange = null;
            activeKingExchangeModalKey = null;
            isHandlingPendingForcedEffect = false;
            nextRoundReadyPlayerIds = [...(data.nextRoundReadyPlayerIds ?? [])];

            const players = restoreLocalPrivateHints(data.players.map(cloneOnlinePlayer));

            state = {
                deck: [...data.deck],
                burnedCard: data.burnedCard,
                players,
                currentTurnPlayerId: data.currentTurnPlayerId,
                isGameOver: true,
                winner: data.winner ? players.find(player => player.id === data.winner?.id) ?? cloneOnlinePlayer(data.winner) : null,
                logs: [...data.logs],
                aiMemory: {}
            };

            onlineGameInitialized = true;
            if (shouldShowEndGameModal) {
                closeModal();
            }
            showScene('game-scene');
            render();
            if (shouldShowEndGameModal) {
                showEndGameModal();
            } else if (nextRoundReadyPlayerIds.includes(localPlayerId) && modalOverlay.style.display !== 'flex') {
                showNextRoundWaitingModal();
            }
            window.requestAnimationFrame(() => render());
        } finally {
            isApplyingOnlineState = false;
        }

        startNextRoundIfReadyAndHost();
        return;
    }

    const shouldPreserveBaronDuelInteraction = Boolean(
        isOnlineGameActive() &&
        isResolvingTurnAction &&
        isLocalBaronDuelParticipant(pendingBaronDuel) &&
        incomingPendingBaronDuel &&
        isSameBaronDuel(pendingBaronDuel, incomingPendingBaronDuel)
    );
    const shouldPreserveKingExchangeInteraction = Boolean(
        isOnlineGameActive() &&
        isResolvingTurnAction &&
        isLocalKingExchangeParticipant(pendingKingExchange) &&
        incomingPendingKingExchange &&
        isSameKingExchange(pendingKingExchange, incomingPendingKingExchange)
    );
    const isRemoteForcedEffectCompletion = Boolean(
        isResolvingTurnAction &&
        pendingForcedEffectsQueue.length > 0 &&
        incomingPendingForcedEffectsQueue.length === 0
    );
    const shouldPreserveLocalInteraction = Boolean(
        isOnlineGameActive() &&
        (
            (
                isResolvingTurnAction &&
                (
                    (data.currentTurnPlayerId === localPlayerId && state.currentTurnPlayerId === localPlayerId && !isRemoteForcedEffectCompletion) ||
                    isResolvingLocalForcedEffect(incomingPendingForcedEffectsQueue) ||
                    (data.currentTurnPlayerId !== localPlayerId && (hasLocalPendingForcedEffect() || isLocalForcedEffect(resolvingForcedEffect)))
                )
            ) ||
            (
                incomingPendingForcedEffectsQueue.some(effect => effect.reactorId === localPlayerId) &&
                hasLocalPendingForcedEffect()
            )
        )
    );

    if (shouldPreserveBaronDuelInteraction) {
        pendingBaronDuel = incomingPendingBaronDuel;
        onlineGameInitialized = true;
        void handlePendingBaronDuel();
        return;
    }

    if (shouldPreserveKingExchangeInteraction) {
        pendingKingExchange = incomingPendingKingExchange;
        onlineGameInitialized = true;
        void handlePendingKingExchange();
        return;
    }

    if (shouldPreserveLocalInteraction) {
        if (!isResolvingLocalForcedEffect(incomingPendingForcedEffectsQueue) && !hasLocalPendingForcedEffect()) {
            pendingForcedEffectsQueue = incomingPendingForcedEffectsQueue.length > 0
                ? incomingPendingForcedEffectsQueue
                : pendingForcedEffectsQueue;
        }
        onlineGameInitialized = true;
        void handlePendingForcedEffect();
        return;
    }

    isApplyingOnlineState = true;

    try {
        endGameReason = '';
        queuedBotTurnId = null;
        selectedCardId = null;
        isResolvingTurnAction = false;

        const players = restoreLocalPrivateHints(data.players.map(cloneOnlinePlayer));

        state = {
            deck: [...data.deck],
            burnedCard: data.burnedCard,
            players,
            currentTurnPlayerId: data.currentTurnPlayerId,
            isGameOver: data.isGameOver,
            winner: data.winner ? players.find(player => player.id === data.winner?.id) ?? cloneOnlinePlayer(data.winner) : null,
            logs: [...data.logs],
            aiMemory: {}
        };
        pendingForcedEffectsQueue = incomingPendingForcedEffectsQueue;
        pendingBaronDuel = incomingPendingBaronDuel;
        pendingKingExchange = incomingPendingKingExchange;
        nextRoundReadyPlayerIds = [...(data.nextRoundReadyPlayerIds ?? [])];
        hasShownEndGameModal = false;

        onlineGameInitialized = true;
        if (!isLocalBaronDuelParticipant(pendingBaronDuel) && !isLocalKingExchangeParticipant(pendingKingExchange)) {
            closeModal();
        }
        showScene('game-scene');
        render();
        window.requestAnimationFrame(() => render());
    } finally {
        isApplyingOnlineState = false;
    }

    void handlePendingForcedEffect();
    void handlePendingBaronDuel();
    void handlePendingKingExchange();
}

function applyOnlineGameData(data: OnlineGameData) {
    applyOnlineGameState({
        ...data,
        isGameOver: false,
        winner: null,
        pendingForcedEffectsQueue: [],
        pendingBaronDuel: null,
        pendingKingExchange: null,
        nextRoundReadyPlayerIds: []
    });
}

function initOnlineGame(roomState: RoomWaitViewState) {
    if (onlineGameInitialized) return;

    const selfPlayer = roomState.players.find(player => player.id === roomState.selfId);
    if (!selfPlayer?.isHost) {
        activeGameRoom?.send('request_game_data');
        return;
    }

    window.setTimeout(() => {
        const gameData = createInitialOnlineGameData(roomState);
        activeGameRoom?.send('init_game_data', gameData);
    }, 100);
}

function renderLobbyList(rooms: LobbyRoomSummary[]) {
    if (rooms.length === 0) {
        roomListContainerEl.innerHTML = `
            <div class="empty-lobby-state">
                <strong>目前沒有可加入的房間</strong>
                <span>建立一個新房間，等待其他玩家加入。</span>
            </div>
        `;
        return;
    }

    roomListContainerEl.innerHTML = rooms.map(room => `
        <div class="room-list-row" data-room-id="${escapeHTML(room.roomId)}">
            <div class="room-cell room-id-cell">
                <span class="room-label">房間 ID</span>
                <strong>${escapeHTML(room.roomId)}</strong>
            </div>
            <div class="room-cell">
                <span class="room-label">人數</span>
                <strong>${room.playerCount}/${room.maxClients}</strong>
            </div>
            <div class="room-cell">
                <span class="room-label">密碼</span>
                <span class="password-badge ${room.hasPassword ? 'locked' : 'open'}">${room.hasPassword ? '需要密碼' : '公開房間'}</span>
            </div>
            <button class="join-room-btn menu-btn primary" data-room-id="${escapeHTML(room.roomId)}" ${room.playerCount >= room.maxClients ? 'disabled' : ''}>加入</button>
        </div>
    `).join('');

    roomListContainerEl.querySelectorAll<HTMLButtonElement>('.join-room-btn').forEach(button => {
        button.onclick = () => joinLobbyRoom(button.dataset.roomId!);
    });
}

function renderRoomWaitArea(roomState: RoomWaitViewState | SyncedRoomState) {
    const normalizedState = normalizeRoomWaitState(roomState);
    const wasGameStarted = currentRoomWaitState?.isGameStarted ?? false;
    currentRoomWaitState = normalizedState;
    roomWaitSceneEl.dataset.gameStarted = normalizedState.isGameStarted ? 'true' : 'false';

    if (normalizedState.isGameStarted) {
        console.log("\u623f\u9593\u72c0\u614b\u8b8a\u66f4\uff1a\u904a\u6232\u958b\u59cb\uff0c\u6e96\u5099\u52a0\u8f09\u904a\u6232\u6230\u5834");
        if (!wasGameStarted) {
            showModal('\u904a\u6232\u958b\u59cb', '<p>\u623f\u9593\u72c0\u614b\u5df2\u540c\u6b65\uff0c\u6e96\u5099\u8f09\u5165\u591a\u4eba\u904a\u6232\u6230\u5834\u3002</p>', '<button class="modal-confirm-btn" id="game-started-ok-btn">\u78ba\u5b9a</button>');
            document.getElementById('game-started-ok-btn')!.onclick = closeModal;
            initOnlineGame(normalizedState);
        }
    }

    currentRoomIdEl.textContent = normalizedState.roomId;
    roomPlayerCountEl.textContent = `${normalizedState.players.length}/4`;

    roomPlayerListEl.innerHTML = Array.from({ length: 4 }, (_, index) => {
        const player = normalizedState.players[index];
        if (!player) {
            return `
                <div class="room-player-row empty-slot">
                    <span>\u7b49\u5f85\u73a9\u5bb6\u52a0\u5165</span>
                    <span class="player-status">\u7a7a\u4f4d</span>
                </div>
            `;
        }

        const isConnected = player.isConnected ?? true;
        const statusText = !isConnected
            ? '\u26a0\ufe0f \u96e2\u7dda\uff0c\u7b49\u5f85\u91cd\u9023'
            : player.isReady || player.isHost ? '\u2714\ufe0f \u5df2\u6e96\u5099' : '\u23f3 \u6e96\u5099\u4e2d';
        const statusClass = !isConnected ? 'waiting offline' : (player.isReady || player.isHost ? 'ready' : 'waiting');
        return `
            <div class="room-player-row ${player.id === normalizedState.selfId ? 'self-player' : ''} ${!isConnected ? 'offline-player' : ''}">
                <div class="room-player-name">
                    <strong>${escapeHTML(player.name)}</strong>
                    ${player.isHost ? '<span class="host-badge">\ud83d\udc51 \u623f\u4e3b</span>' : ''}
                </div>
                <span class="player-status ${statusClass}">${statusText}</span>
            </div>
        `;
    }).join('');

    const selfPlayer = normalizedState.players.find(player => player.id === normalizedState.selfId);
    const isHost = selfPlayer?.isHost ?? false;
    const guestsReady = normalizedState.players
        .filter(player => !player.isHost && (player.isConnected ?? true))
        .every(player => player.isReady);
    readyToggleBtn.textContent = normalizedState.isGameStarted
        ? '\u904a\u6232\u5df2\u958b\u59cb'
        : isHost ? '\u958b\u59cb\u904a\u6232' : (selfPlayer?.isReady ? '\u53d6\u6d88\u6e96\u5099' : '\u6e96\u5099');
    readyToggleBtn.disabled = normalizedState.isGameStarted || (isHost && (normalizedState.players.length < 2 || !guestsReady));
}

function openCreateRoomModal() {
    showModal('\u5275\u5efa\u623f\u9593', `
        <div class="create-room-form">
            <label class="field-label" for="create-room-player-name">\u73a9\u5bb6\u540d\u7a31</label>
            <input id="create-room-player-name" class="modal-input" type="text" value="${escapeHTML(getPreferredPlayerName())}" autocomplete="nickname" />
            <label class="checkbox-row">
                <input id="create-room-use-password" type="checkbox" />
                <span>\u8a2d\u5b9a\u623f\u9593\u5bc6\u78bc</span>
            </label>
            <label class="field-label" for="create-room-password">\u5bc6\u78bc</label>
            <input id="create-room-password" class="modal-input" type="password" placeholder="\u4e0d\u586b\u4ee3\u8868\u516c\u958b\u623f\u9593" autocomplete="off" />
        </div>
    `, `
        <button class="modal-confirm-btn" id="confirm-create-room-btn">\u5275\u5efa</button>
        <button class="modal-cancel-btn" id="cancel-create-room-btn">\u53d6\u6d88</button>
    `);

    document.getElementById('cancel-create-room-btn')!.onclick = closeModal;
    document.getElementById('confirm-create-room-btn')!.onclick = async () => {
        const confirmButton = document.getElementById('confirm-create-room-btn') as HTMLButtonElement;
        const playerName = (document.getElementById('create-room-player-name') as HTMLInputElement).value.trim() || '\u73a9\u5bb6';
        const usePassword = (document.getElementById('create-room-use-password') as HTMLInputElement).checked;
        const password = (document.getElementById('create-room-password') as HTMLInputElement).value.trim();
        setPreferredPlayerName(playerName);
        confirmButton.disabled = true;
        confirmButton.textContent = '\u5efa\u7acb\u4e2d...';

        try {
            const room = await withTimeout(
                colyseusClient.create<SyncedRoomState>('love_letter', {
                    name: playerName,
                    password: usePassword && password.length > 0 ? password : undefined
                }, GameRoomState),
                15_000,
                `\u5efa\u7acb\u623f\u9593\u903e\u6642\u3002\u8acb\u78ba\u8a8d Colyseus \u5f8c\u7aef\u53ef\u9023\u7dda\uff1a${colyseusEndpoint}`
            );
            closeModal();
            bindGameRoom(room);
        } catch (error) {
            showModal('\u5275\u5efa\u623f\u9593\u5931\u6557', `<p>${escapeHTML(getConnectionErrorMessage(error))}</p>`, '<button class="modal-confirm-btn" id="create-room-error-ok-btn">\u78ba\u5b9a</button>');
            document.getElementById('create-room-error-ok-btn')!.onclick = closeModal;
        }
    };
}

async function joinLobbyRoom(roomId: string) {
    const roomSummary = lobbyRooms.find(candidate => candidate.roomId === roomId);
    if (!roomSummary || roomSummary.playerCount >= roomSummary.maxClients) return;

    const playerName = prompt('請輸入玩家名稱', getPreferredPlayerName())?.trim() || getPreferredPlayerName();
    const password = roomSummary.hasPassword ? prompt('請輸入房間密碼') : undefined;
    if (roomSummary.hasPassword && password === null) return;
    setPreferredPlayerName(playerName);

    try {
        const room = await withTimeout(
            colyseusClient.joinById<SyncedRoomState>(roomId, {
                name: playerName,
                password: password || undefined
            }, GameRoomState),
            15_000,
            `Join room timed out. Please confirm the Colyseus backend is reachable: ${colyseusEndpoint}`
        );
        bindGameRoom(room);
    } catch (error) {
        showModal('加入房間失敗', `<p>${escapeHTML(getConnectionErrorMessage(error))}</p>`, '<button class="modal-confirm-btn" id="join-room-error-ok-btn">確定</button>');
        document.getElementById('join-room-error-ok-btn')!.onclick = closeModal;
    }
}

function bindGameRoom(room: Room<unknown, SyncedRoomState>) {
    activeGameRoom?.removeAllListeners();
    activeGameRoom = room;
    onlineGameInitialized = false;
    isApplyingOnlineState = false;

    room.onStateChange((state) => {
        renderRoomWaitArea(state);
    });

    room.onError((code, message) => {
        console.warn(`LoveLetterRoom error ${code}: ${message ?? ''}`);
    });

    room.onMessage<OnlineGameData>('init_game_data', data => {
        applyOnlineGameData(data);
    });

    room.onMessage<OnlineGameStateData>('sync_game_state', data => {
        applyOnlineGameState(data);
    });

    room.onLeave(() => {
        if (activeGameRoom === room) {
            activeGameRoom = null;
            currentRoomWaitState = null;
            showScene('lobby-scene');
        }
    });

    showScene('room-wait-scene');
    renderRoomWaitArea(room.state);
}

async function connectLobbyRoom() {
    if (lobbyRoom) {
        renderLobbyList(lobbyRooms);
        return;
    }

    try {
        lobbyRoom = await withTimeout(
            colyseusClient.joinOrCreate('lobby'),
            15_000,
            `Lobby connection timed out. Please confirm the Colyseus backend is reachable: ${colyseusEndpoint}`
        );
        lobbyRoom.onMessage<RoomAvailable<LobbyRoomMetadata>[] | { rooms?: RoomAvailable<LobbyRoomMetadata>[] }>('rooms', message => {
            const rooms = Array.isArray(message) ? message : message.rooms ?? [];
            lobbyRooms = rooms
                .filter(room => room.name === 'love_letter' && !room.metadata?.isGameStarted)
                .map(toLobbyRoomSummary);
            renderLobbyList(lobbyRooms);
        });
        lobbyRoom.onMessage<LobbyRoomAddMessage>('+', upsertLobbyRoom);
        lobbyRoom.onMessage<RoomAvailable<LobbyRoomMetadata> | string>('-', message => {
            removeLobbyRoom(typeof message === 'string' ? message : message.roomId);
        });
        renderLobbyList(lobbyRooms);
    } catch (error) {
        console.warn('Lobby connection failed:', error);
        roomListContainerEl.innerHTML = `
            <div class="empty-lobby-state">
                <strong>無法連線至 Colyseus 大廳</strong>
                <span>${escapeHTML(getConnectionErrorMessage(error))}</span>
            </div>
        `;
    }
}

async function leaveCurrentRoom() {
    const leavingRoom = activeGameRoom;
    activeGameRoom = null;
    await leaveRoomIfConnected(leavingRoom);

    currentRoomWaitState = null;
    onlineGameInitialized = false;
    isApplyingOnlineState = false;
    selectedCardId = null;
    renderLobbyList(lobbyRooms);
    showScene('lobby-scene');
}

function toggleReadyOrStartGame() {
    if (!currentRoomWaitState) return;

    const selfPlayer = currentRoomWaitState.players.find(player => player.id === currentRoomWaitState?.selfId);
    if (!selfPlayer) return;

    if (selfPlayer.isHost) {
        activeGameRoom?.send('start_game');
        return;
    }

    activeGameRoom?.send('toggle_ready');
}

// 9. 選單邏輯
function setMobileStatsOpen(isOpen: boolean) {
    gameSceneEl.classList.toggle('mobile-stats-open', isOpen);
    document.body.classList.toggle('mobile-stats-open', isOpen);
    mobileStatsToggleBtn.setAttribute('aria-expanded', String(isOpen));
}

function showScene(sceneId: 'main-menu' | 'mode-select' | 'bot-count-select' | 'lobby-scene' | 'room-wait-scene' | 'game-scene') {
    [mainMenuEl, modeSelectEl, botCountSelectEl, lobbySceneEl, roomWaitSceneEl, gameSceneEl].forEach(el => el.style.display = 'none');
    document.body.classList.toggle('game-scene-active', sceneId === 'game-scene');
    if (sceneId !== 'game-scene') {
        setMobileStatsOpen(false);
    }
    document.getElementById(sceneId)!.style.display = 'flex';
}

document.getElementById('start-game-btn')!.onclick = () => showScene('mode-select');
document.getElementById('back-to-menu-btn')!.onclick = async () => {
    await resetClientState();
    showScene('main-menu');
};
document.getElementById('local-mode-btn')!.onclick = () => showScene('bot-count-select');
document.getElementById('online-mode-btn')!.onclick = async () => {
    showScene('lobby-scene');
    await connectLobbyRoom();
};
document.getElementById('back-to-mode-btn')!.onclick = () => showScene('mode-select');
document.getElementById('back-to-mode-from-lobby-btn')!.onclick = () => showScene('mode-select');
document.getElementById('create-room-btn')!.onclick = openCreateRoomModal;
document.getElementById('refresh-room-list-btn')!.onclick = () => void connectLobbyRoom();
document.getElementById('leave-room-btn')!.onclick = leaveCurrentRoom;
readyToggleBtn.onclick = toggleReadyOrStartGame;
mobileStatsToggleBtn.onclick = event => {
    event.stopPropagation();
    setMobileStatsOpen(!gameSceneEl.classList.contains('mobile-stats-open'));
};
cardStatsAreaEl.addEventListener('click', event => event.stopPropagation());
document.getElementById('back-home-btn')!.onclick = async () => {
    if (confirm("確定要放棄目前戰局並返回主選單嗎？")) {
        await resetClientState();
        showScene('main-menu');
    }
};
showResultBtn.onclick = showEndGameModal;
showLogBtn.onclick = showBattleLogModal;
document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (gameSceneEl.classList.contains('mobile-stats-open') && !target.closest('.card-stats-area, .mobile-stats-toggle')) {
        setMobileStatsOpen(false);
    }
    if (!selectedCardId || target.closest('.card-wrapper, .modal-content, button')) return;
    selectedCardId = null;
    render();
});
document.getElementById('show-rules-btn')!.onclick = () => {
    showModal("遊戲說明", `
        <div style="text-align: left; font-size: 0.92rem; line-height: 1.65; max-height: 68vh; overflow-y: auto; padding-right: 0.4rem;">
            <section style="margin-bottom: 1.35rem;">
                <h3 style="margin: 0 0 0.75rem; color: #ffb000; font-size: 1.15rem;">1. 卡牌種類與效果（整副牌共 16 張）</h3>
                <table style="width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 8px; background: rgba(255,255,255,0.04);">
                    <thead>
                        <tr style="background: rgba(255,176,0,0.16); color: #ffd36a;">
                            <th style="padding: 0.65rem 0.7rem; text-align: left; white-space: nowrap;">點數 / 名稱</th>
                            <th style="padding: 0.65rem 0.7rem; text-align: center; white-space: nowrap;">張數</th>
                            <th style="padding: 0.65rem 0.7rem; text-align: left;">詳細效果描述</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #ff4d4d; color: white;">1</span>衛兵</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">5張</td>
                            <td style="padding: 0.7rem;">選擇一名對手並猜測其手牌（不能猜衛兵），若猜中則對方直接出局。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #ff5a5f; color: white;">2</span>神父</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">2張</td>
                            <td style="padding: 0.7rem;">選擇一名對手並秘密查看他的手牌。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #ef6f6c; color: white;">3</span>男爵</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">2張</td>
                            <td style="padding: 0.7rem;">選擇一名對手秘密比大小，點數較小者直接出局。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #f28f3b; color: white;">4</span>侍女</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">2張</td>
                            <td style="padding: 0.7rem;">直到你的下個回合開始前，你免疫所有卡牌效果指定。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #ffb000; color: #1a1a1a;">5</span>王子</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">2張</td>
                            <td style="padding: 0.7rem;">選擇任一玩家（可選自己）棄掉手牌，被迫棄牌者立刻補抽一張，且被棄掉的卡牌會立刻發動效果。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #49a078; color: white;">6</span>國王</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">1張</td>
                            <td style="padding: 0.7rem;">選擇一名對手並與他秘密交換手牌。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #5f8dd3; color: white;">7</span>伯爵夫人</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">1張</td>
                            <td style="padding: 0.7rem;">若手上另一張牌是[5]王子或[6]國王，則必須強制打出此牌。</td>
                        </tr>
                        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
                            <td style="padding: 0.7rem; font-weight: 700;"><span style="display: inline-flex; align-items: center; justify-content: center; width: 1.7rem; height: 1.7rem; margin-right: 0.45rem; border-radius: 50%; background: #8f5fd3; color: white;">8</span>公主</td>
                            <td style="padding: 0.7rem; text-align: center; color: #ffb000; font-weight: 700;">1張</td>
                            <td style="padding: 0.7rem;">此卡不論因何種原因被主動打出或被迫棄掉，你都將立刻直接出局。</td>
                        </tr>
                    </tbody>
                </table>
            </section>

            <section style="margin-bottom: 1.1rem;">
                <h3 style="margin: 0 0 0.45rem; color: #ffb000; font-size: 1.08rem;">2. 遊戲流程</h3>
                <p style="margin: 0;">遊戲開始時，會先從 16 張卡牌中隨機移除一張（銷毀牌）。每位玩家先發一張手牌。每個回合「抽一張牌，選一張牌打出」，設法透過卡牌效果淘汰其他對手。</p>
            </section>

            <section style="margin-bottom: 1.1rem;">
                <h3 style="margin: 0 0 0.45rem; color: #ffb000; font-size: 1.08rem;">3. 勝負判定</h3>
                <p style="margin: 0;">當牌堆沒有卡牌時，所有存活玩家攤牌比點數，點數最大者獲勝。若點數相同，則比較各自已打出牌堆的點數總和，大者獲勝。</p>
            </section>

            <section>
                <h3 style="margin: 0 0 0.45rem; color: #ffb000; font-size: 1.08rem;">4. 次局規則</h3>
                <p style="margin: 0;">每局遊戲結束後，由該局的勝出者擔任下一局遊戲的先攻（最先開始抽卡的人）。</p>
            </section>
        </div>
    `, `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">關閉</button>`);
};

document.querySelectorAll('.count-btn').forEach(btn => {
    (btn as HTMLElement).onclick = () => {
        const botCount = parseInt((btn as HTMLElement).dataset.count!);
        initGame(botCount);
    };
});

// 10. 初始化
function initGame(botCount: number) {
    endGameReason = '';
    localPlayerId = 0;
    onlineGameInitialized = false;
    isApplyingOnlineState = false;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    hasShownEndGameModal = false;
    nextRoundReadyPlayerIds = [];
    queuedBotTurnId = null;
    selectedCardId = null;
    isResolvingTurnAction = false;
    let deck = createDeck();
    deck = shuffle(deck);
    const burnedCard = deck.pop() || null;

    const players: Player[] = [
        { id: 0, name: "玩家", isBot: false, coins: 0, hand: [deck.pop()!], isProtected: false, isAlive: true, discardPile: [], isHandRevealed: false }
    ];

    const botNames = ["電腦 A", "電腦 B", "電腦 C"];
    for (let i = 0; i < botCount; i++) {
        players.push({
            id: i + 1,
            name: botNames[i],
            isBot: true,
            coins: 0,
            hand: [deck.pop()!],
            isProtected: false,
            isAlive: true,
            discardPile: [],
            isHandRevealed: false
        });
    }

    state = {
        deck,
        burnedCard,
        players,
        currentTurnPlayerId: 0,
        isGameOver: false,
        winner: null,
        logs: ["遊戲開始，玩家先攻！"],
        aiMemory: createAIMemory(players)
    };

    showScene('game-scene');
    render();
}

function getConnectedOnlinePlayerIds(): number[] {
    if (currentRoomWaitState?.players.length) {
        return currentRoomWaitState.players
            .map((player, index) => ({ player, index }))
            .filter(({ player }) => player.isConnected ?? true)
            .map(({ index }) => index);
    }

    return state.players
        .filter(player => !player.isBot)
        .map(player => player.id);
}

function getNextRoundWaitingPlayerNames(): string[] {
    const readyIds = new Set(nextRoundReadyPlayerIds);
    return getConnectedOnlinePlayerIds()
        .filter(playerId => !readyIds.has(playerId))
        .map(playerId => state.players[playerId]?.name ?? `玩家 ${playerId + 1}`);
}

function areAllConnectedPlayersReadyForNextRound() {
    const connectedPlayerIds = getConnectedOnlinePlayerIds();
    return connectedPlayerIds.length > 0 && connectedPlayerIds.every(playerId => nextRoundReadyPlayerIds.includes(playerId));
}

function isLocalRoomHost() {
    return currentRoomWaitState?.players[localPlayerId]?.isHost ?? localPlayerId === 0;
}

function showNextRoundWaitingModal() {
    const waitingNames = getNextRoundWaitingPlayerNames();
    const waitingListHTML = waitingNames.length > 0
        ? waitingNames.map(name => `<li>等待 ${escapeHTML(name)} 加入下一局</li>`).join('')
        : '<li>所有玩家已準備，正在開始下一局...</li>';

    showModal('等待下一局', `
        <div style="text-align: left; line-height: 1.7;">
            <p style="margin-top: 0;">你已準備開始下一局。請等待其他玩家確認。</p>
            <ul style="margin: 0.5rem 0 0; padding-left: 1.25rem;">${waitingListHTML}</ul>
        </div>
    `, '<button class="modal-confirm-btn" id="next-round-wait-log-btn">留在戰場查看紀錄</button>');

    document.getElementById('next-round-wait-log-btn')!.onclick = () => {
        closeModal();
        showResultBtn.style.display = 'block';
    };
}

function requestNextRound() {
    if (!state.winner) return;

    if (!isOnlineGameActive()) {
        startNextRound();
        return;
    }

    if (!nextRoundReadyPlayerIds.includes(localPlayerId)) {
        nextRoundReadyPlayerIds = [...nextRoundReadyPlayerIds, localPlayerId];
    }

    showNextRoundWaitingModal();
    syncOnlineGameState();
    startNextRoundIfReadyAndHost();
}

function startNextRoundIfReadyAndHost() {
    if (!isOnlineGameActive() || !state.isGameOver || !areAllConnectedPlayersReadyForNextRound() || !isLocalRoomHost()) return;

    closeModal();
    startNextRound();
}

function startNextRound() {
    if (!state.winner) return;

    endGameReason = '';
    nextRoundReadyPlayerIds = [];
    queuedBotTurnId = null;
    selectedCardId = null;
    isResolvingTurnAction = false;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    hasShownEndGameModal = false;
    const firstPlayerId = state.winner.id;
    let deck = createDeck();
    deck = shuffle(deck);
    const burnedCard = deck.pop() || null;

    state.players.forEach(player => {
        player.hand = [deck.pop()!];
        player.isProtected = false;
        player.isAlive = true;
        player.discardPile = [];
        player.isHandRevealed = false;
    });

    state.deck = deck;
    state.burnedCard = burnedCard;
    state.currentTurnPlayerId = firstPlayerId;
    state.isGameOver = false;
    state.winner = null;
    state.logs = [`新一局開始，${state.players[firstPlayerId].name} 作為上一局勝出者先攻！`];
    state.aiMemory = createAIMemory(state.players);

    showScene('game-scene');
    render();
    syncOnlineGameState();

    if (state.players[firstPlayerId].isBot) {
        queueBotTurn(firstPlayerId);
    }
}

drawBtn.onclick = () => drawCard(localPlayerId);
initGame(1); // 預設進來時背景跑一個 (雖然會被 menu 蓋住)
showScene('main-menu');
