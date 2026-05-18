import './style.css'

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
    targetName?: string;
    guessedCardName?: string;
}

export interface Player {
    id: number;           // 0 為人類玩家，1~3 為電腦
    name: string;         // "玩家", "電腦 A", "電腦 B", "電腦 C"
    isBot: boolean;       // 是否為電腦
    hand: Card[];         // 手牌 (1~2張)
    isProtected: boolean; // 侍女保護狀態
    isAlive: boolean;     // 是否還活著
    discardPile: Card[];  // 已打出的牌堆
}

export interface GameState {
    deck: Card[];
    burnedCard: Card | null;
    players: Player[];
    currentTurnPlayerId: number;
    isGameOver: boolean;
    winner: Player | null;
    logs: string[];
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
        botArea.className = `area opponent-area ${bot.isProtected ? 'protected' : ''} ${!bot.isAlive ? 'eliminated' : ''} ${isActive ? 'active-turn' : ''} ${isWinner ? 'winner-area' : ''}`;
        botArea.innerHTML = `
            ${isWinner ? '<div class="winner-crown" title="勝利者">♛</div>' : ''}
            <h3>${bot.name}</h3>
            <div class="discard-container"></div>
            <div class="hand-container">
                ${bot.hand.map(() => '<div class="card ai-card">?</div>').join('')}
            </div>
        `;
        const discardContainer = botArea.querySelector('.discard-container')!;
        bot.discardPile.forEach(card => discardContainer.appendChild(createCardUI(card, false)));
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
    
    playerHandEl.innerHTML = '';
    human.hand.forEach(card => {
        const isPlayable = isHumanTurn && human.hand.length === 2 && !state.isGameOver;
        const cardUI = createCardUI(card, isPlayable);
        if (isPlayable) {
            cardUI.onclick = () => handlePlayCardRequest(0, card);
        }
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
    drawBtn.disabled = state.isGameOver || !isHumanTurn || human.hand.length >= 2 || state.deck.length === 0;
    drawBtn.style.display = state.isGameOver ? 'none' : 'block';
    showResultBtn.style.display = state.isGameOver ? 'block' : 'none';
}

function createCardUI(card: Card, isPlayable: boolean): HTMLElement {
    const div = document.createElement('div');
    div.className = 'card';
    if (!isPlayable) div.style.cursor = 'default';
    const playNote = card.targetName && card.guessedCardName
        ? `<div class="card-play-note">🎯 對 ${card.targetName} 猜: ${card.guessedCardName}</div>`
        : '';
    div.innerHTML = `
        <div class="card-header">
            <span class="card-name">${card.name}</span>
            <div class="card-value">${card.value}</div>
        </div>
        <div class="card-desc">${card.description}</div>
        ${playNote}
    `;
    return div;
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

// 7. 核心遊戲邏輯
function recordGuardGuess(actor: Player, target: Player, guessedType: CardType) {
    const playedGuard = [...actor.discardPile].reverse().find(discarded => discarded.type === CardType.Guard);
    if (!playedGuard) return;

    playedGuard.targetName = target.name;
    playedGuard.guessedCardName = CARD_DEFINITIONS[guessedType].name;
}

function addLog(msg: string) {
    state.logs.push(`[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${msg}`);
    render();
}

function drawCard(playerId: number) {
    if (state.deck.length === 0) return;
    const player = state.players[playerId];
    const card = state.deck.pop()!;
    player.hand.push(card);
    addLog(`${player.name} 抽了一張牌。`);
    render();
}

function checkCountessConstraint(hand: Card[]): boolean {
    const hasCountess = hand.some(c => c.type === CardType.Countess);
    const hasPrinceOrKing = hand.some(c => c.type === CardType.Prince || c.type === CardType.King);
    return hasCountess && hasPrinceOrKing;
}

function handlePlayCardRequest(playerId: number, card: Card) {
    if (state.isGameOver) return;
    const player = state.players[playerId];
    
    if (checkCountessConstraint(player.hand) && card.type !== CardType.Countess) {
        if (!player.isBot) {
            showModal("提示", "<p>當手中持有王子或國王時，必須先打出伯爵夫人！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
        }
        return;
    }

    if (card.type === CardType.Princess && player.hand.length === 2) {
        const other = player.hand.find(c => c.id !== card.id);
        if (other && other.type !== CardType.Princess) {
           if (!player.isBot) {
               showModal("提示", "<p>公主不能主動打出！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
           }
           return;
        }
    }

    executePlayCard(playerId, card);
}

async function executePlayCard(playerId: number, card: Card) {
    const player = state.players[playerId];
    player.hand = player.hand.filter(c => c.id !== card.id);
    player.discardPile.push(card);
    player.isProtected = false;

    addLog(`${player.name} 打出了 ${card.name} (${card.value})`);
    
    await applyEffect(playerId, card);
}

async function endTurn(playerId: number) {
    if (state.isGameOver) return;
    
    checkEndConditions();

    if (!state.isGameOver) {
        let nextId = (playerId + 1) % state.players.length;
        while (!state.players[nextId].isAlive) {
            nextId = (nextId + 1) % state.players.length;
        }
        state.currentTurnPlayerId = nextId;
        render();

        if (state.players[nextId].isBot) {
            // 不需要外部 setTimeout，因為 botTurn 內部會等待
            botTurn(nextId);
        }
    }
}

async function applyEffect(playerId: number, card: Card, shouldEndTurn = true) {
    const player = state.players[playerId];

    if (card.type === CardType.Princess) {
        eliminate(playerId, "打出或棄掉了公主");
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
            const target = allPotentialTargets[Math.floor(Math.random() * allPotentialTargets.length)];
            await sleep(1000); // 模擬選標準備
            await resolveTargetEffect(playerId, target.id, card, shouldEndTurn);
        } else {
            let buttonsHTML = '<div class="target-list">';
            allPotentialTargets.forEach(t => {
                buttonsHTML += `<button class="target-btn" data-id="${t.id}">${t.name}</button>`;
            });
            buttonsHTML += '</div>';
            showModal(`請選擇 ${card.name} 的目標`, buttonsHTML);
            
            const btns = modalBody.querySelectorAll('.target-btn');
            btns.forEach(btn => {
                (btn as HTMLElement).onclick = async () => {
                    const targetId = parseInt((btn as HTMLElement).dataset.id!);
                    closeModal();
                    await resolveTargetEffect(playerId, targetId, card, shouldEndTurn);
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

async function resolveTargetEffect(actorId: number, targetId: number, card: Card, shouldEndTurn = true) {
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
                showModal(`對 ${target.name} 使用衛兵`, "<p>請猜測目標的手牌：</p>" + buttonsHTML);
                
                const btns = modalBody.querySelectorAll('.guess-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = async () => {
                        const val = parseInt((btn as HTMLElement).dataset.value!);
                        recordGuardGuess(actor, target, val as CardType);
                        closeModal();
                        addLog(`${actor.name} 對 ${target.name} 猜測 ${val}`);
                        if (target.hand[0].value === val) {
                            addLog("猜中了！");
                            eliminate(targetId, "被衛兵猜中手牌");
                        } else {
                            addLog("猜錯了。");
                            if (shouldEndTurn) await endTurn(actorId);
                            else render();
                        }
                    };
                });
            } else {
                const guessNum = getAISmartGuess(actorId);
                recordGuardGuess(actor, target, guessNum as CardType);
                addLog(`${actor.name} 對 ${target.name} 猜測 ${guessNum} (${CARD_DEFINITIONS[guessNum as CardType].name})`);
                if (target.hand[0].value === guessNum) {
                    addLog("猜中了！");
                    eliminate(targetId, "被衛兵猜中手牌");
                } else {
                    addLog("猜錯了。");
                    if (shouldEndTurn) await endTurn(actorId);
                    else render();
                }
            }
            break;

        case CardType.Priest:
            if (!actor.isBot) {
                const cardUI = createCardUI(target.hand[0], false);
                cardUI.style.margin = '0 auto';
                showModal(`神父：看見 ${target.name} 的手牌`, cardUI.outerHTML, `<button class="modal-confirm-btn" id="modal-ok-btn">我了解了</button>`);
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
            const aVal = actor.hand[0]?.value ?? card.value;
            const tVal = target.hand[0].value;
            if (aVal > tVal) {
                eliminate(targetId, "男爵比輸了");
            } else if (aVal < tVal) {
                eliminate(actorId, "男爵比輸了");
            } else {
                addLog("點數相同，平安無事。");
                if (shouldEndTurn) await endTurn(actorId);
                else render();
            }
            break;

        case CardType.Prince:
            addLog(`${actor.name} 強迫 ${target.name} 棄牌！`);
            await sleep(500);
            await discardAndDraw(targetId);
            if (shouldEndTurn) await endTurn(actorId);
            else render();
            break;

        case CardType.King:
            addLog(`${actor.name} 與 ${target.name} 交換手牌！`);
            await sleep(500);
            const temp = actor.hand;
            actor.hand = target.hand;
            target.hand = temp;
            if (shouldEndTurn) await endTurn(actorId);
            else render();
            break;
    }
}

function getAISmartGuess(botId: number): number {
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

async function discardAndDraw(targetId: number) {
    const player = state.players[targetId];
    if (player.hand.length === 0) return;
    const discarded = player.hand.pop()!;
    player.discardPile.push(discarded);
    addLog(`${player.name} 棄掉了 ${discarded.name}`);

    if (discarded.type === CardType.Princess) {
        eliminate(targetId, "棄掉了公主");
        return;
    }

    await applyEffect(targetId, discarded, false);
    if (state.isGameOver || !player.isAlive) return;

    if (state.deck.length > 0) {
        const newCard = state.deck.pop()!;
        player.hand.push(newCard);
    } else if (state.burnedCard) {
        player.hand.push(state.burnedCard);
        state.burnedCard = null;
    }
    render();
}

function eliminate(playerId: number, reason: string) {
    const player = state.players[playerId];
    player.isAlive = false;
    player.discardPile.push(...player.hand);
    player.hand = [];
    addLog(`${player.name}${reason}出局了！`);
    
    const survivors = state.players.filter(p => p.isAlive);
    if (survivors.length === 1) {
        endGame(survivors[0], `作為最後的倖存者`);
    } else {
        if (state.currentTurnPlayerId === playerId) {
            endTurn(playerId);
        }
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

function endGame(winner: Player, reason: string) {
    state.isGameOver = true;
    state.winner = winner;
    endGameReason = reason;
    addLog(`【遊戲結束】${winner.name} 獲勝！(${reason})`);
    render();
}

function showEndGameModal() {
    if (!state.winner) return;

    showModal("遊戲結束", `<h3 style="color:#ff4d4d; font-size: 2rem;">${state.winner.name} 獲勝！</h3><p>${endGameReason}</p>`, `<button class="modal-confirm-btn" id="modal-restart-btn">返回主選單</button>`);
    document.getElementById('modal-restart-btn')!.onclick = () => {
        closeModal();
        showScene('main-menu');
    };
}

// 8. AI 回合優化
async function botTurn(botId: number) {
    if (state.isGameOver || state.currentTurnPlayerId !== botId) return;
    
    // 階段 1：等待（模擬看牌準備）
    await sleep(1000);
    
    // 階段 2：抽牌
    drawCard(botId);
    
    // 階段 3：模擬思考
    await sleep(1200);
    
    const bot = state.players[botId];
    if (checkCountessConstraint(bot.hand)) {
        await handlePlayCardRequest(botId, bot.hand.find(c => c.type === CardType.Countess)!);
        return;
    }
    let playable = bot.hand.filter(c => c.type !== CardType.Princess);
    if (playable.length === 0) playable = bot.hand;
    const cardToPlay = playable[Math.floor(Math.random() * playable.length)];
    
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
document.getElementById('show-rules-btn')!.onclick = () => {
    showModal("遊戲說明", `
        <div style="text-align: left; font-size: 0.9rem;">
            <p>1. 每個回合抽一張牌，出一張牌。</p>
            <p>2. 設法透過卡牌效果淘汰其他對手。</p>
            <p>3. 牌堆空時，剩餘手牌點數最大者獲勝。</p>
            <hr>
            <p>8 公主: 棄掉即出局 | 7 伯爵夫人: 若持有 5,6 則必須打出</p>
            <p>6 國王: 交換手牌 | 5 王子: 棄牌重抽</p>
            <p>4 侍女: 一輪保護 | 3 男爵: 比大小</p>
            <p>2 神父: 看對方手牌 | 1 衛兵: 猜對方手牌</p>
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
    let deck = createDeck();
    deck = shuffle(deck);
    const burnedCard = deck.pop() || null;

    const players: Player[] = [
        { id: 0, name: "玩家", isBot: false, hand: [deck.pop()!], isProtected: false, isAlive: true, discardPile: [] }
    ];

    const botNames = ["電腦 A", "電腦 B", "電腦 C"];
    for (let i = 0; i < botCount; i++) {
        players.push({
            id: i + 1,
            name: botNames[i],
            isBot: true,
            hand: [deck.pop()!],
            isProtected: false,
            isAlive: true,
            discardPile: []
        });
    }

    state = {
        deck,
        burnedCard,
        players,
        currentTurnPlayerId: 0,
        isGameOver: false,
        winner: null,
        logs: ["遊戲開始，玩家先攻！"]
    };

    showScene('game-scene');
    render();
}

drawBtn.onclick = () => drawCard(0);
initGame(1); // 預設進來時背景跑一個 (雖然會被 menu 蓋住)
showScene('main-menu');
