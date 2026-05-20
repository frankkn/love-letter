import './style.css'
import guardImage from './assets/cards/guard.png';
import priestImage from './assets/cards/priest.png';
import baronImage from './assets/cards/baron.png';
import handmaidImage from './assets/cards/handmaid.png';
import princeImage from './assets/cards/prince.png';
import kingImage from './assets/cards/king.png';
import countessImage from './assets/cards/countess.png';
import princessImage from './assets/cards/princess.png';

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

// 4. DOM 元素
const mainMenuEl = document.getElementById('main-menu')!;
const modeSelectEl = document.getElementById('mode-select')!;
const botCountSelectEl = document.getElementById('bot-count-select')!;
const gameSceneEl = document.getElementById('game-scene')!;
const playedCardStatsEl = document.getElementById('played-card-stats')!;
const opponentsContainerEl = document.getElementById('opponents-container')!;
const playerAreaEl = document.getElementById('player-area')!;
const playerHandEl = document.getElementById('player-hand')!;
const playerDiscardEl = document.getElementById('player-discard')!;
const deckCountEl = document.getElementById('deck-count')!;
const drawBtn = document.getElementById('draw-btn') as HTMLButtonElement;
const showResultBtn = document.getElementById('show-result-btn') as HTMLButtonElement;
const gameLogEl = document.getElementById('game-log')!;
const turnIndicatorEl = document.getElementById('turn-indicator')!;

// Modal 相關
const modalOverlay = document.getElementById('modal-overlay')!;
const modalTitle = document.getElementById('modal-title')!;
const modalBody = document.getElementById('modal-body')!;
const modalFooter = document.getElementById('modal-footer')!;
let endGameReason = '';

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
    
    const currentPlayer = state.players[state.currentTurnPlayerId];
    renderPlayedCardStats();
    turnIndicatorEl.textContent = `當前回合：${currentPlayer.name}`;
    
    // 渲染對手區域
    opponentsContainerEl.innerHTML = '';
    state.players.slice(1).forEach(bot => {
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
    const human = state.players[0];
    const isHumanTurn = state.currentTurnPlayerId === 0;
    const isHumanActive = !state.isGameOver && isHumanTurn;
    const isHumanWinner = state.winner?.id === human.id;
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
        const isPlayable = isHumanTurn && human.hand.length === 2 && !state.isGameOver;
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
                handlePlayCardRequest(0, card);
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
    drawBtn.disabled = state.isGameOver || isResolvingTurnAction || !isHumanTurn || !human.isAlive || human.hand.length >= 2 || state.deck.length === 0;
    drawBtn.style.display = state.isGameOver ? 'none' : 'block';
    showResultBtn.style.display = state.isGameOver ? 'block' : 'none';
}

function createCardUI(card: Card, isPlayable: boolean): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'card-wrapper';
    if (!isPlayable) wrapper.style.cursor = 'default';

    const actionHints = card.actionHints ?? (card.targetName && card.guessedCardName
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
    });
    cardDiv.addEventListener('pointerleave', () => {
        wrapper.classList.remove('card-wrapper-hovering');
        wrapper.closest('.area')?.classList.remove('card-area-hovering');
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

function drawCard(playerId: number): boolean {
    if (state.isGameOver || isResolvingTurnAction || state.currentTurnPlayerId !== playerId) return false;
    if (state.deck.length === 0) return false;
    const player = state.players[playerId];
    if (!player.isAlive || player.hand.length >= 2) return false;
    player.isHandRevealed = false;
    if (!player.isBot) selectedCardId = null;
    const card = state.deck.pop()!;
    player.hand.push(card);
    pruneInvalidKnownCardsForPlayer(playerId);
    addLog(`${player.name} 抽了一張牌。`);
    render();
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
    player.discardPile.push(card);
    player.isProtected = false;

    addLog(`${player.name} 打出了 ${card.name} (${card.value})`);
    
    await applyEffect(playerId, card, true, rollback);
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
        return;
    }

    if (!state.isGameOver) {
        await endTurn(actorId);
    }
}

async function endTurn(playerId: number) {
    if (state.isGameOver) return;
    
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
            render();
            return;
        }

        state.currentTurnPlayerId = nextId;
        selectedCardId = null;
        isResolvingTurnAction = false;
        render();

        if (state.players[nextId].isBot) {
            // 不需要外部 setTimeout，因為 botTurn 內部會等待
            queueBotTurn(nextId);
        }
    }
}

async function applyEffect(playerId: number, card: Card, shouldEndTurn = true, rollback?: PlayRollback) {
    const player = state.players[playerId];

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
            else render();
            return;
        }

        if (player.isBot) {
            let botTargets = allPotentialTargets;
            if (card.type === CardType.Prince) {
                const opponentTargets = allPotentialTargets.filter(target => target.id !== playerId);
                botTargets = opponentTargets.length > 0 ? opponentTargets : allPotentialTargets.filter(target => target.id === playerId);
            }

            const target = botTargets[Math.floor(Math.random() * botTargets.length)];
            await sleep(1000); // 模擬選標準備
            await resolveTargetEffect(playerId, target.id, card, shouldEndTurn);
        } else {
            let buttonsHTML = '<div class="target-list">';
            allPotentialTargets.forEach(t => {
                buttonsHTML += `<button class="target-btn" data-id="${t.id}">${t.name}</button>`;
            });
            buttonsHTML += '</div>';
            const bodyHTML = card.type === CardType.Baron
                ? `<p class="modal-helper-text">選擇要秘密比大小的對象。下方同步顯示目前出牌統計，方便判斷剩餘牌況。</p>${createPlayedCardStatsHTML()}${buttonsHTML}`
                : buttonsHTML;
            showModal(`請選擇 ${card.name} 的目標`, bodyHTML, cancelButtonHTML());
            bindCancelRollback(rollback);
            
            const btns = modalBody.querySelectorAll('.target-btn');
            btns.forEach(btn => {
                (btn as HTMLElement).onclick = async () => {
                    const targetId = parseInt((btn as HTMLElement).dataset.id!);
                    closeModal();
                    await resolveTargetEffect(playerId, targetId, card, shouldEndTurn, rollback);
                };
            });
        }
    } else {
        if (card.type === CardType.Handmaid) {
            player.isProtected = true;
            addLog(`${player.name} 獲得了侍女的保護。`);
        }
        if (shouldEndTurn) await endTurn(playerId);
        else render();
    }
}

async function resolveTargetEffect(actorId: number, targetId: number, card: Card, shouldEndTurn = true, rollback?: PlayRollback) {
    const actor = state.players[actorId];
    const target = state.players[targetId];

    switch (card.type) {
        case CardType.Guard:
            if (!actor.isBot) {
                let buttonsHTML = '<div class="guess-grid">';
                for (let i = 2; i <= 8; i++) {
                    const def = CARD_DEFINITIONS[i as CardType];
                    buttonsHTML += `<button class="guess-btn" data-value="${i}">
                        <span style="font-weight:bold;">${i}</span>
                        <span>${def.name}</span>
                    </button>`;
                }
                buttonsHTML += '</div>';
                showModal(`對 ${target.name} 使用衛兵`, "<p>請猜測目標的手牌：</p>" + buttonsHTML, cancelButtonHTML());
                bindCancelRollback(rollback);
                
                const btns = modalBody.querySelectorAll('.guess-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const val = parseInt((btn as HTMLElement).dataset.value!);
                        const playedGuard = recordGuardGuess(actor, target, val as CardType);
                        const guessedName = CARD_DEFINITIONS[val as CardType].name;
                        closeModal();
                        addLog(`${actor.name} 對 ${target.name} 猜測 ${val}`);
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
                            else render();
                        }
                    };
                });
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
                    else render();
                }
            }
            break;

        case CardType.Priest:
            if (actor.isBot && target.hand[0]) {
                rememberKnownCard(actorId, targetId, target.hand[0].type);
            }
            card.actionHints = [
                { text: `🎯 對 ${target.name} 使用` }
            ];
            if (!actor.isBot) {
                const cardUI = createCardUI(target.hand[0], false);
                cardUI.style.margin = '0 auto';
                showModal(`神父：看見 ${target.name} 的手牌`, cardUI.outerHTML, `<button class="modal-confirm-btn" id="modal-ok-btn">我了解了</button>${cancelButtonHTML()}`);
                bindCancelRollback(rollback);
                document.getElementById('modal-ok-btn')!.onclick = async () => {
                    closeModal();
                    if (shouldEndTurn) await endTurn(actorId);
                    else render();
                };
            } else {
                addLog(`${actor.name} 看了一下 ${target.name} 的手牌。`);
                if (shouldEndTurn) await endTurn(actorId);
                else render();
            }
            break;

        case CardType.Baron:
            addLog(`${actor.name} 與 ${target.name} 秘密比大小！`);
            await sleep(1000);
            if (actor.hand.length === 0 || target.hand.length === 0) {
                addLog("無法比點數，因為其中一方沒有手牌。");
                if (shouldEndTurn) await endTurn(actorId);
                else render();
                break;
            }

            const actorCard = actor.hand[0];
            const targetCard = target.hand[0];
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
                else render();
            }
            break;

        case CardType.Prince:
            card.actionHints = [
                { text: `🎯 對 ${target.name} 使用` }
            ];
            addLog(`${actor.name} 強迫 ${target.name} 棄牌！`);
            await sleep(500);
            const discardedByPrince = await discardAndDraw(targetId);
            if (discardedByPrince) {
                card.actionHints = [
                    { text: `🎯 對 ${target.name} 使用` },
                    { text: `🗑️ 丟棄了 ${discardedByPrince.name}` }
                ];
            }
            if (shouldEndTurn) await endTurn(actorId);
            else render();
            break;

        case CardType.King:
            card.actionHints = [
                { text: `🎯 對 ${target.name} 交換手牌` }
            ];
            addLog(`${actor.name} 與 ${target.name} 交換手牌！`);
            await sleep(500);
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
            if (shouldEndTurn) await endTurn(actorId);
            else render();
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

async function discardAndDraw(targetId: number): Promise<Card | null> {
    const player = state.players[targetId];
    if (player.hand.length === 0) return null;
    clearKnownCardForPlayer(targetId);
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
    addLog(`${player.name} 棄掉了 ${discarded.name}`);

    if (discarded.type === CardType.Princess) {
        eliminate(targetId, "棄掉了公主");
        return discarded;
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

    await applyEffect(targetId, discarded, false);
    if (state.isGameOver || !player.isAlive) return discarded;

    render();
    return discarded;
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
    }
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
    state.isGameOver = true;
    state.winner = winner;
    endGameReason = reason;
    winner.coins += 1;
    addLog(`【遊戲結束】${winner.name} 獲勝並獲得 1 枚硬幣！(${reason})`);
    render();
}

function showEndGameModal() {
    if (!state.winner) return;

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

    const nextRoundBtn = document.getElementById('next-round-btn');
    if (nextRoundBtn) {
        nextRoundBtn.onclick = () => {
            closeModal();
            startNextRound();
        };
    }

    const viewChampionBtn = document.getElementById('view-champion-btn');
    if (viewChampionBtn) {
        viewChampionBtn.onclick = showChampionModal;
    }

    document.getElementById('ranking-return-btn')!.onclick = () => {
        closeModal();
    };
}

// 8. AI 回合優化
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
    const baron = bot.hand.find(card => card.type === CardType.Baron);
    if (guard && baron) return guard;

    let playable = bot.hand.filter(card => card.type !== CardType.Princess);
    if (playable.length === 0) playable = bot.hand;

    const weightedCards = playable.map(card => ({
        card,
        weight: Math.max(0.1, getAICardPlayWeight(bot, card))
    }));
    const totalWeight = weightedCards.reduce((sum, item) => sum + item.weight, 0);
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
    if (!drawCard(botId)) return;
    
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

// 9. 選單邏輯
function showScene(sceneId: 'main-menu' | 'mode-select' | 'bot-count-select' | 'game-scene') {
    [mainMenuEl, modeSelectEl, botCountSelectEl, gameSceneEl].forEach(el => el.style.display = 'none');
    document.getElementById(sceneId)!.style.display = 'flex';
}

document.getElementById('start-game-btn')!.onclick = () => showScene('mode-select');
document.getElementById('back-to-menu-btn')!.onclick = () => showScene('main-menu');
document.getElementById('local-mode-btn')!.onclick = () => showScene('bot-count-select');
document.getElementById('back-to-mode-btn')!.onclick = () => showScene('mode-select');
document.getElementById('back-home-btn')!.onclick = () => {
    if (confirm("確定要放棄目前戰局並返回主選單嗎？")) showScene('main-menu');
};
showResultBtn.onclick = showEndGameModal;
document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
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

function startNextRound() {
    if (!state.winner) return;

    endGameReason = '';
    queuedBotTurnId = null;
    selectedCardId = null;
    isResolvingTurnAction = false;
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

    if (state.players[firstPlayerId].isBot) {
        queueBotTurn(firstPlayerId);
    }
}

drawBtn.onclick = () => drawCard(0);
initGame(1); // 預設進來時背景跑一個 (雖然會被 menu 蓋住)
showScene('main-menu');
