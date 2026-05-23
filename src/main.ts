import './style.css'
import { t, setLang, getLang, type LangCode, createRulesBodyHTML } from './i18n.js';
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
    aiExcludedGuesses: Record<number, Record<number, CardType[]>>;
    // Monotonically increasing per round. Used to discard stale online syncs that arrive
    // after a newer round has already started locally (3+ player "next round" race).
    roundIndex: number;
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

interface BaronGuardClue {
    winnerId: number;
    loserId: number;
    loserCardType: CardType;
    sourceCardId: string;
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
    botCount: number;
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
    botCount?: number;
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
let recentBaronGuardClue: BaronGuardClue | null = null;
let pendingKingExchange: PendingKingExchange | null = null;
let activeKingExchangeModalKey: string | null = null;
let isHandlingPendingForcedEffect = false;
let hasShownEndGameModal = false;
let nextRoundReadyPlayerIds: number[] = [];
let restartReadyPlayerIds: number[] = [];

async function leaveRoomIfConnected(room: Room | null) {
    if (!room) return;

    room.removeAllListeners();
    // Guard against room.leave() never resolving — has been observed in the wild when the
    // server disposes the room concurrently (e.g. last remaining player leaves mid-game).
    await Promise.race([
        room.leave(),
        new Promise<void>(resolve => window.setTimeout(resolve, 1500))
    ]);
}

function leaveRoomInBackground(room: Room | null, context: string) {
    if (!room) return;

    void leaveRoomIfConnected(room).catch(error => {
        console.warn(`Failed to leave ${context}:`, error);
    });
}

function resetLocalClientState() {
    lobbyRooms = [];
    currentRoomWaitState = null;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    recentBaronGuardClue = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    hasShownEndGameModal = false;
    nextRoundReadyPlayerIds = [];
    restartReadyPlayerIds = [];
    selectedCardId = null;
    isResolvingTurnAction = false;
    queuedBotTurnId = null;
    localPlayerId = 0;
    onlineGameInitialized = false;
    isApplyingOnlineState = false;
    endGameReason = '';
    clearPendingAbortTimer();
    closeModal();
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio System
// ─────────────────────────────────────────────────────────────────────────────
const bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = 0.45;

const sfxAudio = new Audio();
sfxAudio.volume = 0.8;

let isMuted = localStorage.getItem('loveLetter_muted') === 'true';
let currentBGMFile = '';
let audioUnlocked = false;
let pendingBGMFile = '';
// Tracks whether WE paused BGM to make way for an SFX (so we can resume it after)
let bgmPausedForSFX = false;

function getAudioSrc(filename: string): string {
    return `${import.meta.env.BASE_URL}audio/${encodeURIComponent(filename)}`;
}

function applyMuteState() {
    bgmAudio.muted = isMuted;
    sfxAudio.muted = isMuted;
    const icon = isMuted ? '🔇' : '🔊';
    const btn = document.getElementById('mute-btn') as HTMLButtonElement | null;
    if (btn) btn.textContent = icon;
    const btnGlobal = document.getElementById('mute-btn-global') as HTMLButtonElement | null;
    if (btnGlobal) btnGlobal.textContent = icon;
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    // Fade out the splash screen
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        splash.addEventListener('animationend', () => splash.remove(), { once: true });
    }
    // Play the pending BGM immediately (we're now in a user-gesture context)
    if (pendingBGMFile) {
        const f = pendingBGMFile;
        pendingBGMFile = '';
        playBGM(f);
    }
}

function playBGM(filename: string) {
    if (!audioUnlocked) { pendingBGMFile = filename; return; }
    if (currentBGMFile === filename) return; // already committed to this track
    bgmAudio.loop = true;
    currentBGMFile = filename;
    bgmPausedForSFX = false;
    bgmAudio.src = getAudioSrc(filename);
    bgmAudio.currentTime = 0;
    bgmAudio.play().catch(() => {
        audioUnlocked = false;
        pendingBGMFile = filename;
        currentBGMFile = '';
    });
}

function playSFX(filename: string) {
    if (!audioUnlocked) return;
    // Pause BGM so it doesn't overlap with the SFX
    if (!bgmAudio.paused) {
        bgmAudio.pause();
        bgmPausedForSFX = true;
    }
    const resumeBGM = () => {
        if (bgmPausedForSFX && currentBGMFile) {
            bgmPausedForSFX = false;
            bgmAudio.play().catch(() => {});
        }
    };
    sfxAudio.src = getAudioSrc(filename);
    sfxAudio.currentTime = 0;
    sfxAudio.onended = resumeBGM;
    sfxAudio.play().catch(resumeBGM);
}

function playChampionTheme() {
    // Champion theme replaces BGM entirely — don't resume BGM afterwards
    bgmPausedForSFX = false;
    bgmAudio.pause();
    currentBGMFile = '';
    sfxAudio.src = getAudioSrc('Love Conquers All.mp3');
    sfxAudio.currentTime = 0;
    sfxAudio.onended = null;
    sfxAudio.play().catch(() => {});
}

function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('loveLetter_muted', String(isMuted));
    applyMuteState();
    if (!isMuted) unlockAudio();
}

// Use capture phase so unlockAudio fires BEFORE any button handler,
// ensuring audio plays from the very first interaction (works on iOS too).
document.addEventListener('touchstart', unlockAudio, { capture: true, once: true });
document.addEventListener('click',      unlockAudio, { capture: true, once: true });
document.addEventListener('keydown',    unlockAudio, { capture: true, once: true });
applyMuteState();

// ─────────────────────────────────────────────────────────────────────────────

function resetClientState() {
    const leavingGameRoom = activeGameRoom;
    const leavingLobbyRoom = lobbyRoom;

    activeGameRoom = null;
    lobbyRoom = null;

    resetLocalClientState();
    leaveRoomInBackground(leavingGameRoom, 'active game room during client reset');
    leaveRoomInBackground(leavingLobbyRoom, 'lobby room during client reset');
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
// ── i18n helpers ───────────────────────────────────────────────────────────

const CARD_KEY: Record<number, string> = {
    1: 'guard', 2: 'priest', 3: 'baron', 4: 'handmaid',
    5: 'prince', 6: 'king',  7: 'countess', 8: 'princess'
};

function getCardName(type: number): string {
    return t(`card.${CARD_KEY[type] ?? type}`);
}

function getCardDesc(type: number): string {
    return t(`card.desc.${CARD_KEY[type] ?? type}`);
}

function applyStaticTranslations(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n!);
    });
    document.documentElement.lang = getLang() === 'zh' ? 'zh-TW' : 'en';
}

function showLanguageModal(): void {
    const currentKey = getLang() === 'zh' ? 'lang.zh' : 'lang.en';
    showModal(
        t('modal.language'),
        `<div style="text-align:center;padding:0.5rem 0 0.25rem;">
            <p style="margin:0 0 1rem;color:#ccc;">${t('lang.current' as string, t(currentKey))}</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
                <button id="lang-zh-btn" class="menu-btn primary" style="min-width:8rem;${getLang()==='zh'?'border:2px solid #ffb000;':''}">${t('lang.zh')}</button>
                <button id="lang-en-btn" class="menu-btn primary" style="min-width:8rem;${getLang()==='en'?'border:2px solid #ffb000;':''}">${t('lang.en')}</button>
            </div>
        </div>`,
        `<button class="modal-confirm-btn" id="lang-modal-cancel-btn" style="background:#64748b;">${t('btn.cancel')}</button>`
    );

    const applyAndClose = (lang: LangCode) => {
        setLang(lang);
        applyStaticTranslations();
        closeModal();
    };

    document.getElementById('lang-zh-btn')!.onclick = () => applyAndClose('zh');
    document.getElementById('lang-en-btn')!.onclick = () => applyAndClose('en');
    document.getElementById('lang-modal-cancel-btn')!.onclick = closeModal;
}

// Modal 相關
const modalOverlay = document.getElementById('modal-overlay')!;
const modalTitle = document.getElementById('modal-title')!;
const modalBody = document.getElementById('modal-body')!;
const modalFooter = document.getElementById('modal-footer')!;
let endGameReason = '';

const mobileStatsToggleBtn = document.createElement('button');
mobileStatsToggleBtn.type = 'button';
mobileStatsToggleBtn.className = 'mobile-stats-toggle';
mobileStatsToggleBtn.dataset.i18n = 'game.statsToggle';
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
        name.textContent = getCardName(type);

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
                <span class="modal-card-stat-name">${getCardName(type)}</span>
                <span class="modal-card-stat-count">${count}/${def.count}</span>
            </div>
        `;
    }).join('');

    return `
        <section class="modal-card-stats" aria-label="${t('game.stats')}">
            <h3>${t('game.stats')}</h3>
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

function waitForStatsModalConfirm(title: string, bodyHTML: string, confirmText?: string): Promise<void> {
    confirmText ??= t('btn.confirm');
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
    const hintKeyByType: Partial<Record<CardType, string>> = {
        [CardType.Guard]:   'target.hint.guard',
        [CardType.Priest]:  'target.hint.priest',
        [CardType.Baron]:   'target.hint.baron',
        [CardType.Prince]:  'target.hint.prince',
        [CardType.King]:    'target.hint.king',
    };
    const hintKey = hintKeyByType[card.type];
    const hint = hintKey ? t(hintKey) : t('target.hint.default', getCardName(card.type));
    const buttonsHTML = targets.map(target => (
        `<button class="target-btn" data-id="${target.id}">${target.name}</button>`
    )).join('');

    return `
        <p class="modal-helper-text">${hint}</p>
        ${createPlayedCardStatsHTML()}
        <div class="target-list">${buttonsHTML}</div>
    `;
}

function coinIconHTML(): string {
    return `<svg class="coin-icon" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="width:1em;height:1em;display:inline-block;vertical-align:-0.12em;flex:0 0 auto;"><circle cx="12" cy="12" r="10" fill="#f6c85f" stroke="#9b6b13" stroke-width="1.8"></circle><circle cx="12" cy="12" r="6.7" fill="#ffd978" stroke="#c58a1d" stroke-width="1.2"></circle><path d="M8.6 12.9h6.8M9.6 9.6h4.8M9.6 16.1h4.8" stroke="#8b5a0a" stroke-width="1.6" stroke-linecap="round"></path></svg>`;
}

function getCoinIcons(coins: number): string {
    return coins > 0
        ? `<span class="coin-icons" aria-label="${t('coins.label', String(coins))}" style="display:inline-flex;align-items:center;gap:0.12em;line-height:1;vertical-align:-0.12em;">${coinIconHTML().repeat(coins)}</span>`
        : '';
}

function getPlayerTitleHTML(player: Player, suffix = ''): string {
    const statusBadge = player.isAlive ? '' : `<span class="player-status-badge">${t('game.eliminated')}</span>`;
    const title = `${escapeHTML(player.name)}${suffix ? ` ${escapeHTML(suffix)}` : ''}`;
    return `<span class="player-title-name">${title}</span>${getCoinIcons(player.coins)}${statusBadge}`;
}

function render() {
    deckCountEl.textContent = `${t('game.deckLabel')}${state.deck.length}`;
    
    const currentPlayer = state.players[state.currentTurnPlayerId] ?? getAlivePlayers()[0] ?? state.players[0];
    const localPlayer = state.players[localPlayerId] ?? state.players[0];
    renderPlayedCardStats();
    turnIndicatorEl.textContent = `${t('game.turnLabel')}${currentPlayer.name}`;
    
    // 渲染對手區域
    opponentsContainerEl.innerHTML = '';
    const opponents = state.players.filter(player => player.id !== localPlayer.id);
    opponentsContainerEl.dataset.opponentCount = String(opponents.length);
    gameSceneEl.dataset.opponentCount = String(opponents.length);
    document.body.dataset.opponentCount = String(opponents.length);
    opponents.forEach(bot => {
        const botArea = document.createElement('div');
        const isActive = !state.isGameOver && state.currentTurnPlayerId === bot.id;
        const isWinner = state.winner?.id === bot.id;
        const shouldRevealHand = state.isGameOver || bot.isHandRevealed;
        botArea.className = `area opponent-area ${bot.isProtected ? 'protected' : ''} ${!bot.isAlive ? 'eliminated' : ''} ${isActive ? 'active-turn' : ''} ${isWinner ? 'winner-area' : ''}`;
        botArea.innerHTML = `
            ${isWinner ? `<div class="winner-crown" title="${t('game.winner')}">♛</div>` : ''}
            <h3>${getPlayerTitleHTML(bot)}</h3>
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
        crown.title = t('game.winner');
        crown.textContent = '♛';
        playerAreaEl.prepend(crown);
    }

    const humanTitle = playerAreaEl.querySelector('h3');
    if (humanTitle) {
        humanTitle.innerHTML = getPlayerTitleHTML(human, t('player.statusSuffix'));
    }
    
    playerHandEl.innerHTML = '';
    human.hand.forEach(card => {
        const isPlayable = isHumanTurn && human.hand.length === 2 && !state.isGameOver && !isResolvingTurnAction;
        const cardUI = createCardUI(card, isPlayable);
        const cardEl = cardUI.querySelector('.card');
        cardEl?.classList.toggle('card-selected', selectedCardId === card.id);
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
        if (cardEl instanceof HTMLElement && selectedCardId === card.id) {
            positionCardDescription(cardEl);
        }
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
        ? [{ text: t('hint.guardGuess', card.targetName!, card.guessedCardName!) }]
        : []);

    const cardDiv = document.createElement('div');
    cardDiv.className = 'card';
    cardDiv.innerHTML = `
        <div class="card-header">
            <span class="card-name">${getCardName(card.type)}</span>
            <div class="card-value">${card.value}</div>
        </div>
        <div class="card-img">
            <img src="${CARD_IMAGES[card.type]}" alt="${getCardName(card.type)}" loading="lazy">
        </div>
        <div class="card-desc">${getCardDesc(card.type)}</div>
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
    return `<button class="modal-cancel-btn" id="modal-cancel-btn">❌ ${t('btn.cancel')}</button>`;
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
    playedGuard.guessedCardName = getCardName(guessedType);
    playedGuard.actionHints = [
        { text: t('hint.guardGuess', target.name, getCardName(guessedType)) }
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

function createAIExcludedGuesses(players: Player[]): Record<number, Record<number, CardType[]>> {
    return players
        .filter(player => player.isBot)
        .reduce<Record<number, Record<number, CardType[]>>>((exclusions, bot) => {
            exclusions[bot.id] = {};
            return exclusions;
        }, {});
}

function rememberKnownCard(observerId: number, targetId: number, cardType: CardType) {
    if (!state.players[observerId]?.isBot) return;
    state.aiMemory[observerId] ??= {};
    state.aiMemory[observerId][targetId] = cardType;
}

function isUsefulBaronGuardClue(loserCardType: CardType) {
    return loserCardType >= CardType.Handmaid && loserCardType <= CardType.Countess;
}

function rememberBaronGuardClue(winnerId: number, loserId: number, loserCardType: CardType, sourceCardId: string) {
    if (!isUsefulBaronGuardClue(loserCardType)) {
        recentBaronGuardClue = null;
        return;
    }

    recentBaronGuardClue = {
        winnerId,
        loserId,
        loserCardType,
        sourceCardId
    };
}

function clearBaronGuardClueForPlayer(playerId: number) {
    if (recentBaronGuardClue?.winnerId === playerId) {
        recentBaronGuardClue = null;
    }
}

function getActiveBaronGuardClue(botId: number, targetId?: number): BaronGuardClue | null {
    const clue = recentBaronGuardClue;
    if (!clue || clue.winnerId === botId) return null;
    if (targetId !== undefined && clue.winnerId !== targetId) return null;

    const winner = state.players[clue.winnerId];
    if (!winner?.isAlive || winner.isProtected || winner.hand.length === 0) {
        recentBaronGuardClue = null;
        return null;
    }

    return clue;
}

function getBaronGuardClueTarget(botId: number, potentialTargets: Player[]): Player | null {
    const clue = getActiveBaronGuardClue(botId);
    if (!clue) return null;

    return potentialTargets.find(target => target.id === clue.winnerId) ?? null;
}

function rememberGuardMiss(targetId: number, guessedType: CardType) {
    if (guessedType === CardType.Guard) return;

    state.players
        .filter(player => player.isBot)
        .forEach(bot => {
            state.aiExcludedGuesses[bot.id] ??= {};
            const excludedTypes = state.aiExcludedGuesses[bot.id][targetId] ?? [];
            if (!excludedTypes.includes(guessedType)) {
                state.aiExcludedGuesses[bot.id][targetId] = [...excludedTypes, guessedType];
            }
        });
}

function clearKnownCardForPlayer(playerId: number) {
    Object.values(state.aiMemory).forEach(memory => {
        delete memory[playerId];
    });
    clearBaronGuardClueForPlayer(playerId);
    clearExcludedGuardGuessesForPlayer(playerId);
}

function clearExcludedGuardGuessesForPlayer(playerId: number) {
    Object.values(state.aiExcludedGuesses).forEach(exclusions => {
        delete exclusions[playerId];
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

function getExcludedGuardGuesses(observerId: number, targetId: number): Set<CardType> {
    const excludedTypes = state.aiExcludedGuesses[observerId]?.[targetId] ?? [];
    return new Set(excludedTypes.filter(type => type !== CardType.Guard));
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
    clearExcludedGuardGuessesForPlayer(playerId);
    pruneInvalidKnownCardsForPlayer(playerId);
    addLog(t('log.drew', player.name));
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
            showModal(t('modal.hint'), `<p>${t('warn.countess')}</p>`, `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">${t('btn.ok')}</button>`);
        }
        return;
    }

    if (!player.isBot && card.type === CardType.Princess && player.hand.length === 2) {
        const other = player.hand.find(c => c.id !== card.id);
        if (other && other.type !== CardType.Princess) {
           showModal(t('modal.hint'), `<p>${t('warn.princess')}</p>`, `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">${t('btn.ok')}</button>`);
           return;
        }
    }

    await executePlayCard(playerId, card);
}

function requiresTargetBeforeReveal(card: Card): boolean {
    // Cards that pop a target-selection modal where the actor can still cancel.
    // While the actor is choosing a target the play must stay local — syncing now
    // would leak the card identity to opponents even if the actor backs out.
    return (
        card.type === CardType.Guard ||
        card.type === CardType.Priest ||
        card.type === CardType.Baron ||
        card.type === CardType.Prince ||
        card.type === CardType.King
    );
}

async function executePlayCard(playerId: number, card: Card) {
    const player = state.players[playerId];
    const rollback = player.isBot ? undefined : createPlayRollback(playerId);
    isResolvingTurnAction = true;
    player.hand = player.hand.filter(c => c.id !== card.id);
    pruneInvalidKnownCardsForPlayer(playerId);
    player.discardPile.push(card);
    player.isProtected = false;

    addLog(t('log.played', player.name, getCardName(card.type), String(card.value)));

    // For human plays of target-selecting cards, defer the broadcast until the actor
    // actually picks a target. Otherwise opponents would briefly see the card in the
    // discard pile and learn what was held even when the play is cancelled.
    const deferSyncUntilTargetSelected = !player.isBot && requiresTargetBeforeReveal(card);
    if (!deferSyncUntilTargetSelected) {
        syncOnlineGameState();
    }

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
            endGame(survivors[0], t('reason.onlyPlayer'));
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
    // In online games only the host drives bot turns — non-host clients just receive synced state.
    if (isOnlineGameActive()) {
        const selfPlayer = currentRoomWaitState?.players.find(p => p.id === activeGameRoom?.sessionId);
        if (!selfPlayer?.isHost) return;
    }

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
                endGame(survivors[0], t('reason.lastSurvivor'));
            }
            return;
        }

        const nextId = findNextAlivePlayerId(playerId);
        if (nextId === null) {
            selectedCardId = null;
            isResolvingTurnAction = false;
            addLog(t('log.noNextPlayer'));
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
        eliminate(playerId, t('reason.princessPlayed'));
        if (shouldEndTurn && !state.isGameOver) await endTurn(playerId);
        return;
    }

    if ([1, 2, 3, 5, 6].includes(card.value)) {
        let allPotentialTargets = state.players.filter(p => p.isAlive && !p.isProtected);
        if (card.type !== CardType.Prince) {
            allPotentialTargets = allPotentialTargets.filter(p => p.id !== playerId);
        }

        if (allPotentialTargets.length === 0) {
            addLog(t('log.noLegalTarget'));
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
            const inferredGuardTarget = card.type === CardType.Guard
                ? getBaronGuardClueTarget(playerId, botTargets)
                : null;
            const target = knownGuardTarget ?? inferredGuardTarget ?? botTargets[Math.floor(Math.random() * botTargets.length)];
            await sleep(1000); // 模擬選標準備
            await resolveTargetEffect(playerId, target.id, card, shouldEndTurn);
        } else if (canControlInteractiveEffect) {
            await new Promise<void>(resolve => {
                showModal(t('modal.selectTarget', getCardName(card.type)), createTargetSelectModalBodyHTML(card, allPotentialTargets), cancelButtonHTML());
                bindCancelRollback(rollback);

                const btns = modalBody.querySelectorAll('.target-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const targetId = parseInt((btn as HTMLElement).dataset.id!);
                        closeModal();
                        // Target chosen — broadcast the play now that the actor has committed.
                        // executePlayCard intentionally skipped the initial sync for these cards
                        // so a cancel here would not have leaked the card identity.
                        if (requiresTargetBeforeReveal(card)) {
                            syncOnlineGameState();
                        }
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
            addLog(t('log.handmaidProtected', player.name));
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
                    buttonsHTML += `<button class="guess-btn" data-value="${i}">
                        <span style="font-weight:bold;">${i}</span>
                        <span>${getCardName(i)}</span>
                    </button>`;
                }
                buttonsHTML += '</div>';
                showModal(t('modal.guardTarget', target.name), createStatsModalBodyHTML(t('guard.prompt') + buttonsHTML), cancelButtonHTML());
                bindCancelRollback(rollback);

                const btns = modalBody.querySelectorAll('.guess-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const val = parseInt((btn as HTMLElement).dataset.value!);
                        const playedGuard = recordGuardGuess(actor, target, val as CardType);
                        const guessedName = getCardName(val);
                        closeModal();
                        addLog(t('log.guardGuess', actor.name, target.name, String(val), guessedName));
                        if (target.hand[0].value === val) {
                            if (playedGuard) {
                                playedGuard.actionHints = [
                                    { text: t('hint.guardGuess', target.name, guessedName) },
                                    { text: t('hint.guardHit', target.name), variant: 'danger' }
                                ];
                            }
                            addLog(t('log.guardHit'));
                            eliminate(targetId, t('reason.guardHit'));
                            if (shouldEndTurn && !state.isGameOver) await endTurn(actorId);
                        } else {
                            rememberGuardMiss(targetId, val as CardType);
                            if (playedGuard) {
                                playedGuard.actionHints = [
                                    { text: t('hint.guardGuess', target.name, guessedName) },
                                    { text: `❌ ${t('log.guardMiss')}`, variant: 'tie' }
                                ];
                            }
                            addLog(t('log.guardMiss'));
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
                const guessedName = getCardName(guessNum);
                addLog(t('log.guardGuess', actor.name, target.name, String(guessNum), guessedName));
                if (target.hand[0].value === guessNum) {
                    if (playedGuard) {
                        playedGuard.actionHints = [
                            { text: t('hint.guardGuess', target.name, guessedName) },
                            { text: t('hint.guardHit', target.name), variant: 'danger' }
                        ];
                    }
                    addLog(t('log.guardHit'));
                    eliminate(targetId, t('reason.guardHit'));
                    if (shouldEndTurn && !state.isGameOver) await endTurn(actorId);
                } else {
                    rememberGuardMiss(targetId, guessNum as CardType);
                    if (playedGuard) {
                        playedGuard.actionHints = [
                            { text: t('hint.guardGuess', target.name, guessedName) },
                            { text: `❌ ${t('log.guardMiss')}`, variant: 'tie' }
                        ];
                    }
                    addLog(t('log.guardMiss'));
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
            const priestPublicHint = t('hint.usedOn', target.name);
            card.actionHints = [{ text: priestPublicHint, variant: 'default' }];
            playedPriest.actionHints = [{ text: priestPublicHint, variant: 'default' }];
            delete card.privateActionHints;
            delete card.privateHintOwnerId;
            delete playedPriest.privateActionHints;
            delete playedPriest.privateHintOwnerId;
            if (!actor.isBot && target.hand[0]) {
                const privatePriestHint = t('hint.priestSaw', target.name, getCardName(target.hand[0].type), String(target.hand[0].value));
                const privateHints: CardActionHint[] = [{ text: privatePriestHint, variant: 'default' }];
                card.privateActionHints = privateHints;
                card.privateHintOwnerId = actorId;
                playedPriest.privateActionHints = privateHints;
                playedPriest.privateHintOwnerId = actorId;
            }
            render();
            addLog(t('log.priestSaw', actor.name, target.name));
            syncOnlineGameState();
            if (!actor.isBot) {
                await new Promise<void>(resolve => {
                const cardUI = createCardUI(target.hand[0], false);
                cardUI.style.margin = '0 auto';
                showModal(t('modal.priestSees', target.name), createStatsModalBodyHTML(cardUI.outerHTML), `<button class="modal-confirm-btn" id="modal-ok-btn">${t('btn.iUnderstand')}</button>`);
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
            addLog(t('log.baronCompare', actor.name, target.name));
            await sleep(1000);
            if (actor.hand.length === 0 || target.hand.length === 0) {
                addLog(t('log.baronNoHand'));
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
                    t('modal.baronDuel'),
                    createHandRevealBodyHTML(
                        t('baron.reveal', actor.name, target.name),
                        actor.name,
                        actorCard,
                        target.name,
                        targetCard
                    ),
                    t('btn.confirmDuel')
                );
            }

            const aVal = actorCard.value;
            const tVal = targetCard.value;
            const aliveBeforeCompare = state.players.filter(p => p.isAlive).length;

            if (aVal > tVal) {
                card.actionHints = [
                    { text: t('hint.baronVs', target.name) },
                    { text: t('hint.baronWin', target.name, getCardName(targetCard.type)), variant: 'danger' }
                ];
                if (aliveBeforeCompare === 2) {
                    actor.isHandRevealed = true;
                    target.isHandRevealed = true;
                    addLog(t('log.baronTie', actor.name, getCardName(actorCard.type), String(aVal), target.name, getCardName(targetCard.type), String(tVal)));
                } else {
                    target.isHandRevealed = true;
                    addLog(t('log.baronTargetLoses', actor.name, target.name, getCardName(targetCard.type), String(tVal)));
                }
                render();
                syncOnlineGameState();
                await sleep(2000);
                rememberBaronGuardClue(actorId, targetId, targetCard.type, card.id);
                eliminate(targetId, t('reason.baronLost'));
                await finishEffectTurn(actorId, shouldEndTurn);
            } else if (aVal < tVal) {
                card.actionHints = [
                    { text: t('hint.baronVs', target.name) },
                    { text: t('hint.baronWin', actor.name, getCardName(actorCard.type)), variant: 'danger' }
                ];
                if (aliveBeforeCompare === 2) {
                    actor.isHandRevealed = true;
                    target.isHandRevealed = true;
                    addLog(t('log.baronTie', actor.name, getCardName(actorCard.type), String(aVal), target.name, getCardName(targetCard.type), String(tVal)));
                } else {
                    actor.isHandRevealed = true;
                    addLog(t('log.baronActorLoses', actor.name, target.name, getCardName(actorCard.type), String(aVal)));
                }
                render();
                syncOnlineGameState();
                await sleep(2000);
                rememberBaronGuardClue(targetId, actorId, actorCard.type, card.id);
                eliminate(actorId, t('reason.baronLost'));
                await finishEffectTurn(actorId, shouldEndTurn);
            } else {
                card.actionHints = [
                    { text: t('hint.baronVs', target.name) },
                    { text: t('hint.baronTie'), variant: 'tie' }
                ];
                rememberKnownCard(actorId, targetId, targetCard.type);
                rememberKnownCard(targetId, actorId, actorCard.type);
                addLog(t('log.baronCompare', actor.name, target.name));
                if (shouldEndTurn) await endTurn(actorId);
                else {
                    render();
                    syncOnlineGameState();
                }
            }
            break;

        case CardType.Prince:
            card.actionHints = [
                { text: t('hint.usedOn', target.name) }
            ];
            addLog(t('log.princeForced', actor.name, target.name));
            await sleep(500);
            if (!target.isBot) {
                await waitForStatsModalConfirm(
                    t('card.prince'),
                    `<p>${t('prince.modal', actor.name, target.name)}</p>`,
                    t('btn.confirm')
                );
            }
            const princeDiscardResult = await discardAndDraw(targetId, actorId, shouldEndTurn);
            if (princeDiscardResult.discarded) {
                card.actionHints = [
                    { text: t('hint.usedOn', target.name) },
                    { text: t('hint.discarded', getCardName(princeDiscardResult.discarded.type)) }
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
                { text: t('hint.kingSwap', target.name) }
            ];
            addLog(t('log.kingExchange', actor.name, target.name));
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
                    t('modal.kingSwap'),
                    createHandRevealBodyHTML(
                        t('king.swapPending', actor.name, target.name),
                        actor.name,
                        actor.hand[0],
                        target.name,
                        target.hand[0]
                    ),
                    t('btn.confirm')
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
                    t('modal.kingSwap'),
                    createHandRevealBodyHTML(
                        t('king.swapDone', actor.name, target.name),
                        actor.name,
                        actor.hand[0],
                        target.name,
                        target.hand[0]
                    ),
                    t('btn.iUnderstand')
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

    const excludedGuesses = getExcludedGuardGuesses(botId, targetId);
    const baronClue = getActiveBaronGuardClue(botId, targetId);
    if (baronClue) {
        const inferredGuesses: number[] = [];
        for (let i = Math.max(CardType.Priest, baronClue.loserCardType + 1); i <= CardType.Princess; i++) {
            if (!excludedGuesses.has(i as CardType) && knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
                inferredGuesses.push(i);
            }
        }
        if (inferredGuesses.length > 0) {
            return inferredGuesses[Math.floor(Math.random() * inferredGuesses.length)];
        }
    }

    const possibleGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (!excludedGuesses.has(i as CardType) && knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
            possibleGuesses.push(i);
        }
    }
    if (possibleGuesses.length > 0) {
        return possibleGuesses[Math.floor(Math.random() * possibleGuesses.length)];
    }

    const fallbackGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (!excludedGuesses.has(i as CardType)) {
            fallbackGuesses.push(i);
        }
    }
    return fallbackGuesses.length > 0 ? fallbackGuesses[Math.floor(Math.random() * fallbackGuesses.length)] : 2;
}

async function discardAndDraw(targetId: number, returnTurnPlayerId: number, shouldEndTurnAfterResolution: boolean): Promise<PrinceDiscardResult> {
    const player = state.players[targetId];
    if (player.hand.length === 0) {
        return { discarded: null, hasPendingForcedEffect: false };
    }
    clearKnownCardForPlayer(targetId);
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
    addLog(t('log.discarded', player.name, getCardName(discarded.type)));

    if (discarded.type === CardType.Princess) {
        eliminate(targetId, t('reason.princessDiscarded'));
        return { discarded, hasPendingForcedEffect: false };
    }

    if (state.deck.length > 0) {
        const newCard = state.deck.pop()!;
        player.hand.push(newCard);
        addLog(t('log.redrew', player.name));
    } else if (state.burnedCard) {
        player.hand.push(state.burnedCard);
        state.burnedCard = null;
        addLog(t('log.redrewBurned', player.name));
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
    addLog(t('log.eliminated', player.name, reason));
    
    const survivors = getAlivePlayers();
    if (survivors.length === 1) {
        endGame(survivors[0], t('reason.lastSurvivor'));
    } else {
        playSFX('Farewell, Chevalier.mp3');
        handoffTurnIfCurrentPlayerWasEliminated(playerId);
    }

    syncOnlineGameStateThenRender();
}

function checkEndConditions() {
    if (state.isGameOver) return;
    
    if (state.deck.length === 0) {
        const survivors = state.players.filter(p => p.isAlive);
        if (survivors.every(p => p.hand.length === 1)) {
            addLog(t('log.deckEmpty'));
            survivors.sort((a, b) => {
                if (b.hand[0].value !== a.hand[0].value) {
                    return b.hand[0].value - a.hand[0].value;
                }
                const aSum = a.discardPile.reduce((s, c) => s + c.value, 0);
                const bSum = b.discardPile.reduce((s, c) => s + c.value, 0);
                return bSum - aSum;
            });
            endGame(survivors[0], t('reason.highestCard', String(survivors[0].hand[0].value)));
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
            <strong style="color: ${rank === 1 ? '#ffb000' : '#f2f2f2'};">${t('ranking.rank', String(rank))}</strong>
            <span style="font-weight: 700;">${player.name}</span>
            <span style="font-size: 1.25rem;">${player.coins > 0 ? getCoinIcons(player.coins) : `<span style="font-size: 0.9rem; color: #999;">${t('ranking.noScore')}</span>`}</span>
        </div>
    `).join('');

    return `
        <div style="text-align: left; line-height: 1.6;">
            <div style="text-align: center; margin-bottom: 1rem;">
                <h3 style="margin: 0 0 0.35rem; color: #ffb000; font-size: 1.65rem;">${t('ranking.title')}</h3>
                <p style="margin: 0; color: #ddd;">${t('ranking.desc')}</p>
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

    playChampionTheme();

    showModal(t('modal.champion'), `
        <div style="text-align: center; line-height: 1.6; padding: 0.35rem 0;">
            <div style="font-size: 3rem; margin-bottom: 0.3rem;">♛</div>
            <h3 style="margin: 0; color: #ffb000; font-size: 1.85rem;">${champion.name}</h3>
            <p style="margin: 0.65rem 0 0; font-size: 1.05rem;">${t('champion.desc')}</p>
            <div style="margin-top: 1rem; font-size: 1.65rem;">${getCoinIcons(champion.coins)}</div>
        </div>
    `, `<button class="modal-confirm-btn" id="champion-restart-btn" style="background: #16a34a;">${t('btn.restart')}</button><button class="modal-confirm-btn" id="champion-return-btn" style="margin-left: 0.65rem; background: #64748b;">${t('btn.back')}</button>`);

    document.getElementById('champion-restart-btn')!.onclick = () => requestRestart();
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
    recentBaronGuardClue = null;
    pendingKingExchange = null;
    activeKingExchangeModalKey = null;
    isHandlingPendingForcedEffect = false;
    state.isGameOver = true;
    state.winner = winner;
    endGameReason = reason;
    winner.coins += 1;
    addLog(t('log.gameOver', winner.name, reason));
    render();
    syncOnlineGameState();
    showEndGameModal();
}

function showEndGameModal() {
    if (!state.winner) return;

    hasShownEndGameModal = true;
    playSFX("The Victor's Token.mp3");
    showResultBtn.style.display = 'block';

    const champion = getLeagueChampion();
    const primaryButton = champion
        ? `<button class="modal-confirm-btn" id="view-champion-btn">${t('btn.viewChampion')}</button>`
        : `<button class="modal-confirm-btn" id="next-round-btn">${t('btn.nextRound')}</button>`;

    showModal(t('modal.gameResult'), `
        <div style="text-align: center; margin-bottom: 1rem;">
            <h3 style="margin: 0; color:#ff4d4d; font-size: 1.65rem;">${t('endgame.wins', state.winner.name)}</h3>
            <p style="margin: 0.35rem 0 0;">${endGameReason}</p>
        </div>
        ${createRankingHTML()}
    `, `${primaryButton}<button class="modal-confirm-btn" id="ranking-return-btn" style="margin-left: 0.65rem; background: #64748b;">${t('btn.back')}</button>`);

    const rankingReturnBtn = document.getElementById('ranking-return-btn')!;
    rankingReturnBtn.textContent = t('btn.stayField');

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
        : `<p class="modal-helper-text">${t('battleLog.noLog')}</p>`;

    showModal(t('modal.battleLog'), `
        <div class="modal-log-container">
            ${logsHTML}
        </div>
    `, `<button class="modal-confirm-btn" id="battle-log-close-btn">${t('btn.close')}</button>`);

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
            if (getBaronGuardClueTarget(bot.id, state.players.filter(player => (
                player.id !== bot.id &&
                player.isAlive &&
                !player.isProtected
            )))) {
                weight = 32;
            }
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
    return localStorage.getItem('loveLetterPlayerName') || t('player.human');
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
    roundIndex: number;
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
    restartReadyPlayerIds?: number[];
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
        name: typeof player.name === 'string' && player.name.trim().length > 0 ? player.name : t('player.human'),
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
            botCount: viewState.botCount ?? 0,
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
        isGameStarted: syncedState.isGameStarted,
        botCount: syncedState.botCount ?? 0
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

    // Append bot players after real players
    const BOT_NAMES = ['電腦 A', '電腦 B', '電腦 C'];
    const botCount = roomState.botCount ?? 0;
    for (let i = 0; i < botCount; i++) {
        players.push({
            id: players.length,
            name: BOT_NAMES[i] ?? `電腦 ${i + 1}`,
            isBot: true,
            coins: 0,
            hand: [],
            isProtected: false,
            isAlive: true,
            discardPile: [],
            isHandRevealed: false
        });
    }

    players.forEach(player => {
        player.hand = [deck.pop()!];
    });

    return {
        deck,
        burnedCard,
        players,
        currentTurnPlayerId: 0,
        logs: [t('log.onlineStart')],
        roundIndex: 0
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
        roundIndex: state.roundIndex,
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
        nextRoundReadyPlayerIds: [...nextRoundReadyPlayerIds],
        restartReadyPlayerIds: [...restartReadyPlayerIds]
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

function createHandRevealBodyHTML(message: string, actorName: string, actorCard: Card, targetName: string, targetCard: Card) {
    return `
        <p>${message}</p>
        <div class="duel-card-row">
            <div class="duel-card-column">
                <strong>${actorName}</strong>
                ${createCardUI(actorCard, false).outerHTML}
            </div>
            <div class="duel-card-column">
                <strong>${targetName}</strong>
                ${createCardUI(targetCard, false).outerHTML}
            </div>
        </div>
    `;
}

function createBaronDuelBodyHTML(duel: PendingBaronDuel) {
    const actor = state.players[duel.actorId];
    const target = state.players[duel.targetId];

    return createHandRevealBodyHTML(
        t('baron.reveal', actor.name, target.name),
        actor.name,
        duel.actorCard,
        target.name,
        duel.targetCard
    );
}

async function showBaronDuelModal(duel: PendingBaronDuel) {
    const duelKey = getBaronDuelKey(duel);
    if (!duelKey || activeBaronDuelModalKey === duelKey) return;

    activeBaronDuelModalKey = duelKey;
    isResolvingTurnAction = true;
    try {
        await waitForStatsModalConfirm(t('modal.baronDuel'), createBaronDuelBodyHTML(duel), t('btn.confirmDuel'));
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
            t('modal.kingSwap'),
            `<p>${t('king.swapPending', actor.name, target.name)}</p>`,
            t('btn.confirmSwap')
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
    const attackerName = attacker?.name ?? t('player.opponent');

    return `
        <p>${t('forced.body1', attackerName)}</p>
        <p>${t('forced.body2', getCardName(effect.card.type))}</p>
        <p>${t('forced.body3')}</p>
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
            t('modal.forcedChain'),
            createForcedEffectNoticeBodyHTML(effect),
            t('btn.executeEffect')
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
    // Drop syncs from prior rounds. With 3+ players, the "next round" sync race can produce
    // late game-over syncs that arrive after a newer round has already begun locally; without
    // this guard those stale syncs would rewind a player's UI to the previous round's result.
    // IMPORTANT: only apply this guard when already in an initialized game session. A fresh
    // init_game_data arriving after a champion game (roundIndex=0) must never be blocked by
    // a stale state.roundIndex leftover from the previous league.
    if (onlineGameInitialized && state && typeof data.roundIndex === 'number' && data.roundIndex < state.roundIndex) {
        return;
    }

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
            recentBaronGuardClue = null;
            pendingKingExchange = null;
            activeKingExchangeModalKey = null;
            isHandlingPendingForcedEffect = false;
            nextRoundReadyPlayerIds = Array.from(new Set([
                ...nextRoundReadyPlayerIds,
                ...(data.nextRoundReadyPlayerIds ?? [])
            ]));
            restartReadyPlayerIds = Array.from(new Set([
                ...restartReadyPlayerIds,
                ...(data.restartReadyPlayerIds ?? [])
            ]));

            const players = restoreLocalPrivateHints(data.players.map(cloneOnlinePlayer));

            state = {
                deck: [...data.deck],
                burnedCard: data.burnedCard,
                players,
                currentTurnPlayerId: data.currentTurnPlayerId,
                isGameOver: true,
                winner: data.winner ? players.find(player => player.id === data.winner?.id) ?? cloneOnlinePlayer(data.winner) : null,
                logs: [...data.logs],
                aiMemory: {},
                aiExcludedGuesses: {},
                roundIndex: data.roundIndex ?? 0
            };

            onlineGameInitialized = true;
            if (shouldShowEndGameModal) {
                closeModal();
            }
            showScene('game-scene');
            render();
            if (shouldShowEndGameModal) {
                showEndGameModal();
            } else if (restartReadyPlayerIds.includes(localPlayerId) && modalOverlay.style.display !== 'flex') {
                showRestartWaitingModal();
            } else if (nextRoundReadyPlayerIds.includes(localPlayerId) && modalOverlay.style.display !== 'flex') {
                showNextRoundWaitingModal();
            }
            window.requestAnimationFrame(() => render());
        } finally {
            isApplyingOnlineState = false;
        }

        startNextRoundIfReadyAndHost();
        startNewLeagueIfReadyAndHost();
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
    const hasNewLocalPendingForcedEffect = incomingPendingForcedEffectsQueue.some(
        incomingEffect =>
            incomingEffect.reactorId === localPlayerId &&
            !isSamePendingForcedEffect(resolvingForcedEffect, incomingEffect) &&
            !pendingForcedEffectsQueue.some(localEffect => isSamePendingForcedEffect(localEffect, incomingEffect))
    );
    const shouldPreserveLocalInteraction = Boolean(
        isOnlineGameActive() &&
        !hasNewLocalPendingForcedEffect &&
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
            aiMemory: {},
            aiExcludedGuesses: {},
            roundIndex: data.roundIndex ?? 0
        };
        pendingForcedEffectsQueue = incomingPendingForcedEffectsQueue;
        pendingBaronDuel = incomingPendingBaronDuel;
        recentBaronGuardClue = null;
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

    // If the current turn belongs to a bot, the host should drive it.
    const currentPlayer = state?.players[state.currentTurnPlayerId];
    if (!state?.isGameOver && currentPlayer?.isBot && currentPlayer.isAlive) {
        queueBotTurn(state.currentTurnPlayerId);
    }
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
                <strong>${t('lobby.noRoomsTitle')}</strong>
                <span>${t('lobby.noRoomsDesc')}</span>
            </div>
        `;
        return;
    }

    roomListContainerEl.innerHTML = rooms.map(room => `
        <div class="room-list-row" data-room-id="${escapeHTML(room.roomId)}">
            <div class="room-cell room-id-cell">
                <span class="room-label">${t('lobby.colId')}</span>
                <strong>${escapeHTML(room.roomId)}</strong>
            </div>
            <div class="room-cell">
                <span class="room-label">${t('lobby.colCount')}</span>
                <strong>${room.playerCount}/${room.maxClients}</strong>
            </div>
            <div class="room-cell">
                <span class="room-label">${t('lobby.colPwd')}</span>
                <span class="password-badge ${room.hasPassword ? 'locked' : 'open'}">${room.hasPassword ? t('lobby.locked') : t('lobby.open')}</span>
            </div>
            <button class="join-room-btn menu-btn primary" data-room-id="${escapeHTML(room.roomId)}" ${room.playerCount >= room.maxClients ? 'disabled' : ''}>${t('lobby.join')}</button>
        </div>
    `).join('');

    roomListContainerEl.querySelectorAll<HTMLButtonElement>('.join-room-btn').forEach(button => {
        button.onclick = () => joinLobbyRoom(button.dataset.roomId!);
    });
}

function renderRoomWaitArea(roomState: RoomWaitViewState | SyncedRoomState) {
    const normalizedState = normalizeRoomWaitState(roomState);
    const wasGameStarted = currentRoomWaitState?.isGameStarted ?? false;
    const previousRoomWaitState = currentRoomWaitState;
    currentRoomWaitState = normalizedState;
    roomWaitSceneEl.dataset.gameStarted = normalizedState.isGameStarted ? 'true' : 'false';

    // Detect mid-game disconnections so the remaining player is not stranded waiting forever.
    maybeShowAbortModalForDisconnections(previousRoomWaitState, normalizedState);

    if (normalizedState.isGameStarted) {
        console.log('\u623f\u9593\u72c0\u614b\u8b8a\u66f4\uff1a\u904a\u6232\u958b\u59cb\uff0c\u6e96\u5099\u52a0\u8f09\u904a\u6232\u6230\u5834');
        if (!wasGameStarted) {
            showModal(t('modal.gameStarted'), `<p>${t('gameStarted.body')}</p>`, `<button class="modal-confirm-btn" id="game-started-ok-btn">${t('btn.confirm')}</button>`);
            document.getElementById('game-started-ok-btn')!.onclick = closeModal;
            initOnlineGame(normalizedState);
        }
    }

    const botCount = normalizedState.botCount ?? 0;
    const totalOccupied = normalizedState.players.length + botCount;
    currentRoomIdEl.textContent = normalizedState.roomId;
    roomPlayerCountEl.textContent = `${totalOccupied}/4`;

    const selfPlayer = normalizedState.players.find(player => player.id === normalizedState.selfId);
    const isHost = selfPlayer?.isHost ?? false;

    // Build real-player rows
    const realPlayerRows = normalizedState.players.map(player => {
        const isConnected = player.isConnected ?? true;
        const statusText = !isConnected
            ? t('room.statusOffline')
            : player.isReady || player.isHost ? t('room.statusReady') : t('room.statusWaiting');
        const statusClass = !isConnected ? 'waiting offline' : (player.isReady || player.isHost ? 'ready' : 'waiting');
        const isSelf = player.id === normalizedState.selfId;
        const kickBtn = isHost && !isSelf && !normalizedState.isGameStarted
            ? `<button class="kick-player-btn" data-session-id="${escapeHTML(player.id)}">${t('room.kickPlayer')}</button>`
            : '';
        return `
            <div class="room-player-row ${isSelf ? 'self-player' : ''} ${!isConnected ? 'offline-player' : ''}">
                <div class="room-player-name">
                    <strong>${escapeHTML(player.name)}</strong>
                    ${player.isHost ? `<span class="host-badge">${t('room.hostBadge')}</span>` : ''}
                </div>
                <div class="room-player-actions">
                    <span class="player-status ${statusClass}">${statusText}</span>
                    ${kickBtn}
                </div>
            </div>
        `;
    });

    // Build bot rows
    const BOT_NAMES_DISPLAY = ['電腦 A', '電腦 B', '電腦 C'];
    const botRows = Array.from({ length: botCount }, (_, i) => {
        const removeBtnHtml = isHost && !normalizedState.isGameStarted && i === botCount - 1
            ? `<button class="remove-bot-btn">${t('room.removeBot')}</button>`
            : '';
        return `
            <div class="room-player-row bot-slot">
                <div class="room-player-name">
                    <strong>${escapeHTML(BOT_NAMES_DISPLAY[i] ?? `電腦 ${i + 1}`)}</strong>
                </div>
                <div class="room-player-actions">
                    <span class="player-status ready">${t('room.botStatus')}</span>
                    ${removeBtnHtml}
                </div>
            </div>
        `;
    });

    // Build empty slot rows with optional "add bot" button in the first empty slot
    const emptySlotCount = 4 - totalOccupied;
    const emptyRows = Array.from({ length: emptySlotCount }, (_, i) => {
        const addBtnHtml = isHost && !normalizedState.isGameStarted && i === 0
            ? `<button class="add-bot-btn">${t('room.addBot')}</button>`
            : '';
        return `
            <div class="room-player-row empty-slot">
                <span>${t('room.waitSlot')}</span>
                <div class="room-player-actions">
                    <span class="player-status">${t('room.emptySlot')}</span>
                    ${addBtnHtml}
                </div>
            </div>
        `;
    });

    roomPlayerListEl.innerHTML = [...realPlayerRows, ...botRows, ...emptyRows].join('');

    // Wire up host-only buttons
    roomPlayerListEl.querySelectorAll<HTMLButtonElement>('.kick-player-btn').forEach(btn => {
        btn.onclick = () => {
            const targetSessionId = btn.dataset.sessionId;
            if (targetSessionId) {
                activeGameRoom?.send('kick_player', { targetSessionId });
            }
        };
    });

    roomPlayerListEl.querySelector<HTMLButtonElement>('.add-bot-btn')?.addEventListener('click', () => {
        activeGameRoom?.send('add_bot');
    });

    roomPlayerListEl.querySelector<HTMLButtonElement>('.remove-bot-btn')?.addEventListener('click', () => {
        activeGameRoom?.send('remove_bot');
    });

    const guestsReady = normalizedState.players
        .filter(player => !player.isHost && (player.isConnected ?? true))
        .every(player => player.isReady);
    readyToggleBtn.textContent = normalizedState.isGameStarted
        ? t('room.started')
        : isHost ? t('room.startGame') : (selfPlayer?.isReady ? t('room.cancelReady') : t('room.ready'));
    readyToggleBtn.disabled = normalizedState.isGameStarted || (isHost && (totalOccupied < 2 || !guestsReady));
}

function openCreateRoomModal() {
    showModal(t('cr.title'), `
        <div class="create-room-form">
            <label class="field-label" for="create-room-player-name">${t('cr.playerName')}</label>
            <input id="create-room-player-name" class="modal-input" type="text" value="${escapeHTML(getPreferredPlayerName())}" autocomplete="nickname" />
            <label class="checkbox-row">
                <input id="create-room-use-password" type="checkbox" />
                <span>${t('cr.usePassword')}</span>
            </label>
            <label class="field-label" for="create-room-password">${t('cr.password')}</label>
            <input id="create-room-password" class="modal-input" type="password" placeholder="${t('cr.pwdHint')}" autocomplete="off" />
        </div>
    `, `
        <button class="modal-confirm-btn" id="confirm-create-room-btn">${t('cr.create')}</button>
        <button class="modal-cancel-btn" id="cancel-create-room-btn">${t('cr.cancel')}</button>
    `);

    document.getElementById('cancel-create-room-btn')!.onclick = closeModal;
    document.getElementById('confirm-create-room-btn')!.onclick = async () => {
        const confirmButton = document.getElementById('confirm-create-room-btn') as HTMLButtonElement;
        const playerName = (document.getElementById('create-room-player-name') as HTMLInputElement).value.trim() || t('player.human');
        const usePassword = (document.getElementById('create-room-use-password') as HTMLInputElement).checked;
        const password = (document.getElementById('create-room-password') as HTMLInputElement).value.trim();
        setPreferredPlayerName(playerName);
        confirmButton.disabled = true;
        confirmButton.textContent = t('cr.creating');

        try {
            const room = await withTimeout(
                colyseusClient.create<SyncedRoomState>('love_letter', {
                    name: playerName,
                    password: usePassword && password.length > 0 ? password : undefined
                }, GameRoomState),
                15_000,
                t('cr.timeout', colyseusEndpoint)
            );
            closeModal();
            bindGameRoom(room);
        } catch (error) {
            showModal(t('cr.failTitle'), `<p>${escapeHTML(getConnectionErrorMessage(error))}</p>`, `<button class="modal-confirm-btn" id="create-room-error-ok-btn">${t('btn.confirm')}</button>`);
            document.getElementById('create-room-error-ok-btn')!.onclick = closeModal;
        }
    };
}

async function joinLobbyRoom(roomId: string) {
    const roomSummary = lobbyRooms.find(candidate => candidate.roomId === roomId);
    if (!roomSummary || roomSummary.playerCount >= roomSummary.maxClients) return;

    const playerName = prompt(t('joinRoom.promptName'), getPreferredPlayerName())?.trim() || getPreferredPlayerName();
    const password = roomSummary.hasPassword ? prompt(t('joinRoom.promptPwd')) : undefined;
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
        showModal(t('cr.joinFailed'), `<p>${escapeHTML(getConnectionErrorMessage(error))}</p>`, `<button class="modal-confirm-btn" id="join-room-error-ok-btn">${t('btn.confirm')}</button>`);
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

    room.onMessage('kicked_from_room', () => {
        // Server notified us we were kicked — leave cleanly and return to lobby.
        void leaveRoomIfConnected(activeGameRoom).then(() => {
            activeGameRoom = null;
            currentRoomWaitState = null;
            showScene('lobby-scene');
            showModal(
                t('room.kicked'),
                `<p>${t('room.kicked')}</p>`,
                `<button class="modal-confirm-btn" id="kicked-ok-btn">${t('btn.confirm')}</button>`
            );
            document.getElementById('kicked-ok-btn')?.addEventListener('click', closeModal);
        });
    });

    room.onLeave(() => {
        if (activeGameRoom !== room) return;

        const wasInOnlineGame = onlineGameInitialized;
        activeGameRoom = null;
        currentRoomWaitState = null;
        clearPendingAbortTimer();

        if (modalOverlay.style.display === 'flex' && modalTitle.textContent === t('modal.gameAborted')) {
            return;
        }

        // If the connection dropped while we were actually playing, show an explicit
        // "lost connection" modal instead of silently dumping the player into the lobby.
        if (wasInOnlineGame) {
            showConnectionLostModal();
        } else {
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
                <strong>${t('lobby.connFailed')}</strong>
                <span>${escapeHTML(getConnectionErrorMessage(error))}</span>
            </div>
        `;
    }
}

// Grace period for "opponent disconnected" detection. Without it, a brief WS hiccup on the
// opponent's side (tab backgrounded and throttled, F5, transient network drop) would
// immediately end the game on the other player's screen, which feels like a random crash.
// 10 seconds covers typical reconnection windows and is well below the server's 20s
// allowReconnection budget.
const ABORT_GRACE_PERIOD_MS = 10_000;
let pendingAbortTimer: number | null = null;

function clearPendingAbortTimer() {
    if (pendingAbortTimer !== null) {
        window.clearTimeout(pendingAbortTimer);
        pendingAbortTimer = null;
    }
}

function maybeShowAbortModalForDisconnections(
    previous: RoomWaitViewState | null,
    current: RoomWaitViewState
) {
    if (!previous || !previous.isGameStarted || !current.isGameStarted) {
        clearPendingAbortTimer();
        return;
    }
    if (!isOnlineGameActive()) {
        clearPendingAbortTimer();
        return;
    }
    if (modalOverlay.style.display === 'flex' && modalTitle.textContent === t('modal.gameAborted')) return;

    const connectedCount = current.players.filter(p => p.isConnected !== false).length;

    // Enough players still connected — cancel any pending abort (player recovered).
    if (connectedCount >= 2) {
        clearPendingAbortTimer();
        return;
    }

    // Schedule the abort modal after the grace period. Re-checks state at fire time so a
    // late reconnect still cancels the abort.
    if (pendingAbortTimer === null) {
        pendingAbortTimer = window.setTimeout(() => {
            pendingAbortTimer = null;
            if (!currentRoomWaitState?.isGameStarted) return;
            if (!isOnlineGameActive()) return;
            const stillConnected = currentRoomWaitState.players.filter(p => p.isConnected !== false).length;
            if (stillConnected >= 2) return;
            if (modalOverlay.style.display === 'flex' && modalTitle.textContent === t('modal.gameAborted')) return;

            const disconnectedNames = currentRoomWaitState.players
                .filter(p => p.isConnected === false)
                .map(p => p.name);
            const reason = disconnectedNames.length > 0
                ? t('abort.reasonNames', disconnectedNames.join(t('abort.separator')))
                : t('abort.reasonGeneral');
            showGameAbortedModal(reason);
        }, ABORT_GRACE_PERIOD_MS);
    }
}

function showGameAbortedModal(reason: string) {
    showModal(t('modal.gameAborted'), `
        <p>${escapeHTML(reason)}</p>
        <p>${t('abort.goHome')}</p>
    `, `<button class="modal-confirm-btn" id="game-aborted-ok-btn">${t('btn.returnMenu')}</button>`);

    document.getElementById('game-aborted-ok-btn')!.onclick = async () => {
        closeModal();
        await resetClientState();
        showScene('main-menu');
    };
}

function showConnectionLostModal() {
    showModal(t('modal.connLost'), `
        <p>${t('connLost.body')}</p>
        <p>${t('connLost.sub')}</p>
    `, `<button class="modal-confirm-btn" id="connection-lost-ok-btn">${t('btn.returnMenu')}</button>`);

    document.getElementById('connection-lost-ok-btn')!.onclick = async () => {
        closeModal();
        await resetClientState();
        showScene('main-menu');
    };
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

    // BGM switching
    if (sceneId === 'game-scene') {
        playBGM('A Game of Hearts.mp3');
    } else {
        playBGM('Royal Intrigue.mp3');
    }
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
    if (confirm(t('confirm.backHome'))) {
        await resetClientState();
        showScene('main-menu');
    }
};
showResultBtn.onclick = showEndGameModal;
showLogBtn.onclick = showBattleLogModal;
document.getElementById('mute-btn')!.onclick = toggleMute;
document.getElementById('mute-btn-global')!.onclick = toggleMute;
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
    showModal(t('menu.gameRules'), createRulesBodyHTML(),
        `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">${t('btn.close')}</button>`);
};
document.getElementById('lang-btn')!.onclick = showLanguageModal;


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
    recentBaronGuardClue = null;
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
        { id: 0, name: t('player.human'), isBot: false, coins: 0, hand: [deck.pop()!], isProtected: false, isAlive: true, discardPile: [], isHandRevealed: false }
    ];

    const botNames = [t('player.botA'), t('player.botB'), t('player.botC')];
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
        logs: [t('log.localStart')],
        aiMemory: createAIMemory(players),
        aiExcludedGuesses: createAIExcludedGuesses(players),
        roundIndex: 0
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
        .map(playerId => state.players[playerId]?.name ?? t('player.fallback', String(playerId + 1)));
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
        ? waitingNames.map(name => `<li>${t('wait.nextRound.waiting', escapeHTML(name))}</li>`).join('')
        : `<li>${t('wait.nextRound.allReady')}</li>`;

    showModal(t('modal.waitNextRound'), `
        <div style="text-align: left; line-height: 1.7;">
            <p style="margin-top: 0;">${t('wait.nextRound.msg')}</p>
            <ul style="margin: 0.5rem 0 0; padding-left: 1.25rem;">${waitingListHTML}</ul>
        </div>
    `, `<button class="modal-confirm-btn" id="next-round-wait-log-btn">${t('wait.nextRound.stay')}</button>`);

    document.getElementById('next-round-wait-log-btn')!.onclick = () => {
        closeModal();
        showResultBtn.style.display = 'block';
    };
}

// ── Restart (重新開始) ──────────────────────────────────────────────────────

function getRestartWaitingPlayerNames(): string[] {
    const readyIds = new Set(restartReadyPlayerIds);
    return getConnectedOnlinePlayerIds()
        .filter(playerId => !readyIds.has(playerId))
        .map(playerId => state.players[playerId]?.name ?? t('player.fallback', String(playerId + 1)));
}

function areAllConnectedPlayersReadyForRestart(): boolean {
    const connectedPlayerIds = getConnectedOnlinePlayerIds();
    return connectedPlayerIds.length > 0 && connectedPlayerIds.every(playerId => restartReadyPlayerIds.includes(playerId));
}

function showRestartWaitingModal() {
    const waitingNames = getRestartWaitingPlayerNames();
    const waitingListHTML = waitingNames.length > 0
        ? waitingNames.map(name => `<li>${t('wait.restart.waiting', escapeHTML(name))}</li>`).join('')
        : `<li>${t('wait.restart.allReady')}</li>`;

    showModal(t('modal.waitRestart'), `
        <div style="text-align: left; line-height: 1.7;">
            <p style="margin-top: 0;">${t('wait.restart.msg')}</p>
            <ul style="margin: 0.5rem 0 0; padding-left: 1.25rem;">${waitingListHTML}</ul>
        </div>
    `, `<button class="modal-confirm-btn" id="restart-wait-cancel-btn" style="background: #64748b;">${t('btn.cancel')}</button>`);

    document.getElementById('restart-wait-cancel-btn')!.onclick = () => {
        restartReadyPlayerIds = restartReadyPlayerIds.filter(id => id !== localPlayerId);
        syncOnlineGameState();
        showChampionModal();
    };
}

function requestRestart() {
    if (!state.isGameOver) return;

    if (!isOnlineGameActive()) {
        // Single-player: reset coins immediately and start a new league
        startNewLeague();
        return;
    }

    if (!restartReadyPlayerIds.includes(localPlayerId)) {
        restartReadyPlayerIds = [...restartReadyPlayerIds, localPlayerId];
    }

    showRestartWaitingModal();
    syncOnlineGameState();
    startNewLeagueIfReadyAndHost();
}

function startNewLeagueIfReadyAndHost() {
    if (!isOnlineGameActive() || !state.isGameOver || !areAllConnectedPlayersReadyForRestart() || !isLocalRoomHost()) return;

    closeModal();
    startNewLeague();
}

/** Reset all player coins to 0 and start a fresh first round. */
function startNewLeague() {
    state.players.forEach(player => {
        player.coins = 0;
    });
    restartReadyPlayerIds = [];
    startNextRound();
}

// ── Next round ─────────────────────────────────────────────────────────────

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
    restartReadyPlayerIds = [];
    queuedBotTurnId = null;
    selectedCardId = null;
    isResolvingTurnAction = false;
    pendingForcedEffectsQueue = [];
    resolvingForcedEffect = null;
    pendingBaronDuel = null;
    activeBaronDuelModalKey = null;
    recentBaronGuardClue = null;
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
    state.logs = [t('log.newRound', state.players[firstPlayerId].name)];
    state.aiMemory = createAIMemory(state.players);
    state.aiExcludedGuesses = createAIExcludedGuesses(state.players);
    state.roundIndex += 1;

    showScene('game-scene');
    render();
    syncOnlineGameState();

    if (state.players[firstPlayerId].isBot) {
        queueBotTurn(firstPlayerId);
    }
}

drawBtn.onclick = () => drawCard(localPlayerId);
applyStaticTranslations();
initGame(1); // 預設進來時背景跑一個 (雖然會被 menu 蓋住)
showScene('main-menu');
