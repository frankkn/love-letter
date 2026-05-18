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
}

export type PlayerType = 'player' | 'ai';

export interface GameState {
    deck: Card[];
    burnedCard: Card | null;
    playerHand: Card[];
    playerDiscard: Card[];
    playerIsProtected: boolean;
    playerIsAlive: boolean;
    aiHand: Card[];
    aiDiscard: Card[];
    aiIsProtected: boolean;
    aiIsAlive: boolean;
    currentTurn: PlayerType;
    isGameOver: boolean;
    winner: string | null;
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
const aiAreaEl = document.getElementById('ai-area')!;
const aiHandEl = document.getElementById('ai-hand')!;
const aiDiscardEl = document.getElementById('ai-discard')!;
const playerAreaEl = document.getElementById('player-area')!;
const playerHandEl = document.getElementById('player-hand')!;
const playerDiscardEl = document.getElementById('player-discard')!;
const deckCountEl = document.getElementById('deck-count')!;
const drawBtn = document.getElementById('draw-btn') as HTMLButtonElement;
const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
const gameLogEl = document.getElementById('game-log')!;
const turnIndicatorEl = document.getElementById('turn-indicator')!;

// Modal 相關
const modalOverlay = document.getElementById('modal-overlay')!;
const modalTitle = document.getElementById('modal-title')!;
const modalBody = document.getElementById('modal-body')!;
const modalFooter = document.getElementById('modal-footer')!;

// 5. 渲染函式
function render() {
    deckCountEl.textContent = `牌堆剩餘：${state.deck.length}`;
    turnIndicatorEl.textContent = `當前回合：${state.currentTurn === 'player' ? '玩家' : 'AI'}`;
    
    // AI 區域狀態
    aiAreaEl.className = state.aiIsProtected ? 'area protected' : 'area';
    // 玩家區域狀態
    playerAreaEl.className = state.playerIsProtected ? 'area protected' : 'area';

    // AI 手牌
    aiHandEl.innerHTML = '';
    state.aiHand.forEach(() => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card ai-card';
        cardDiv.textContent = '?';
        aiHandEl.appendChild(cardDiv);
    });

    // AI 棄牌
    aiDiscardEl.innerHTML = '';
    state.aiDiscard.forEach(card => aiDiscardEl.appendChild(createCardUI(card, false)));

    // 玩家手牌
    playerHandEl.innerHTML = '';
    state.playerHand.forEach(card => {
        const cardUI = createCardUI(card, state.currentTurn === 'player' && state.playerHand.length === 2);
        if (state.currentTurn === 'player' && state.playerHand.length === 2) {
            cardUI.onclick = () => handlePlayCardRequest('player', card);
        }
        playerHandEl.appendChild(cardUI);
    });

    // 玩家棄牌
    playerDiscardEl.innerHTML = '';
    state.playerDiscard.forEach(card => playerDiscardEl.appendChild(createCardUI(card, false)));

    // 日誌
    gameLogEl.innerHTML = '';
    state.logs.forEach(log => {
        const logDiv = document.createElement('div');
        logDiv.className = 'log-entry';
        logDiv.textContent = log;
        gameLogEl.prepend(logDiv);
    });

    // 按鈕狀態
    drawBtn.disabled = state.isGameOver || state.currentTurn !== 'player' || state.playerHand.length >= 2 || state.deck.length === 0;
    restartBtn.style.display = state.isGameOver ? 'inline-block' : 'none';
}

function createCardUI(card: Card, isPlayable: boolean): HTMLElement {
    const div = document.createElement('div');
    div.className = 'card';
    if (!isPlayable) div.style.cursor = 'default';
    div.innerHTML = `
        <div class="card-header">
            <span class="card-name">${card.name}</span>
            <div class="card-value">${card.value}</div>
        </div>
        <div class="card-desc">${card.description}</div>
    `;
    return div;
}

// 6. Modal 系統
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
function addLog(msg: string) {
    state.logs.push(`[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${msg}`);
    render();
}

function drawCard(target: PlayerType) {
    if (state.deck.length === 0) return;
    const card = state.deck.pop()!;
    if (target === 'player') {
        state.playerHand.push(card);
        addLog("玩家抽了一張牌。");
    } else {
        state.aiHand.push(card);
        addLog("AI 抽了一張牌。");
    }
    render();
}

function checkCountessConstraint(hand: Card[]): boolean {
    const hasCountess = hand.some(c => c.type === CardType.Countess);
    const hasPrinceOrKing = hand.some(c => c.type === CardType.Prince || c.type === CardType.King);
    return hasCountess && hasPrinceOrKing;
}

function handlePlayCardRequest(actor: PlayerType, card: Card) {
    if (state.isGameOver) return;
    const hand = actor === 'player' ? state.playerHand : state.aiHand;
    
    if (checkCountessConstraint(hand) && card.type !== CardType.Countess) {
        if (actor === 'player') {
            showModal("提示", "<p>當手中持有王子或國王時，必須先打出伯爵夫人！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
        }
        return;
    }

    if (card.type === CardType.Princess && hand.length === 2) {
        const other = hand.find(c => c.id !== card.id);
        if (other && other.type !== CardType.Princess) {
           if (actor === 'player') {
               showModal("提示", "<p>公主不能主動打出！</p>", `<button class="modal-confirm-btn" onclick="this.closest('.modal-overlay').style.display='none'">我知道了</button>`);
           }
           return;
        }
    }

    executePlayCard(actor, card);
}

function executePlayCard(actor: PlayerType, card: Card) {
    if (actor === 'player') {
        state.playerHand = state.playerHand.filter(c => c.id !== card.id);
        state.playerDiscard.push(card);
        state.playerIsProtected = false;
    } else {
        state.aiHand = state.aiHand.filter(c => c.id !== card.id);
        state.aiDiscard.push(card);
        state.aiIsProtected = false;
    }

    addLog(`${actor === 'player' ? '玩家' : 'AI'} 打出了 ${card.name} (${card.value})`);
    
    applyEffect(actor, card);
}

function endTurn(actor: PlayerType) {
    if (!state.isGameOver) {
        checkEndConditions();
    }

    if (!state.isGameOver) {
        state.currentTurn = (actor === 'player') ? 'ai' : 'player';
        render();
        if (state.currentTurn === 'ai') {
            setTimeout(aiTurn, 1000);
        }
    }
}

function applyEffect(actor: PlayerType, card: Card) {
    const opponent: PlayerType = actor === 'player' ? 'ai' : 'player';
    const isOpponentProtected = opponent === 'player' ? state.playerIsProtected : state.aiIsProtected;

    if (card.type === CardType.Princess) {
        eliminate(actor, "打出或棄掉了公主");
        return;
    }

    if (isOpponentProtected && [1, 2, 3, 5, 6].includes(card.value)) {
        addLog(`因對方受侍女保護，${card.name} 的效果失效。`);
        endTurn(actor);
        return;
    }

    switch (card.type) {
        case CardType.Guard:
            if (actor === 'player') {
                let buttonsHTML = '<div class="guess-grid">';
                for (let i = 2; i <= 8; i++) {
                    const def = CARD_DEFINITIONS[i as CardType];
                    buttonsHTML += `<button class="guess-btn" data-value="${i}">
                        <span style="font-weight:bold;">${i}</span>
                        <span>${def.name}</span>
                    </button>`;
                }
                buttonsHTML += '</div>';
                showModal("衛兵猜牌", "<p>請猜測 AI 的手牌：</p>" + buttonsHTML);
                
                // 綁定點擊事件
                const btns = modalBody.querySelectorAll('.guess-btn');
                btns.forEach(btn => {
                    (btn as HTMLElement).onclick = () => {
                        const val = parseInt((btn as HTMLElement).dataset.value!);
                        closeModal();
                        if (state.aiHand[0].value === val) {
                            addLog(`玩家猜中了！AI 的手牌是 ${state.aiHand[0].name}`);
                            eliminate('ai', "被衛兵猜中手牌");
                        } else {
                            addLog(`玩家猜錯了，AI 的手牌不是 ${val}`);
                            endTurn('player');
                        }
                    };
                });
            } else {
                // AI 智慧猜牌
                const guessNum = getAISmartGuess();
                addLog(`AI 猜測玩家的手牌是 ${guessNum} (${CARD_DEFINITIONS[guessNum as CardType].name})`);
                if (state.playerHand[0].value === guessNum) {
                    addLog(`AI 猜中了！`);
                    eliminate('player', "被衛兵猜中手牌");
                } else {
                    addLog(`AI 猜錯了。`);
                    endTurn('ai');
                }
            }
            break;

        case CardType.Priest:
            if (actor === 'player') {
                const cardUI = createCardUI(state.aiHand[0], false);
                cardUI.style.margin = '0 auto';
                showModal("神父：查看手牌", `<p>AI 目前的手牌是：</p>${cardUI.outerHTML}`, `<button class="modal-confirm-btn" id="modal-ok-btn">我了解了</button>`);
                document.getElementById('modal-ok-btn')!.onclick = () => {
                    closeModal();
                    endTurn('player');
                };
            } else {
                addLog(`AI 看了一下玩家的手牌。`);
                endTurn('ai');
            }
            break;

        case CardType.Baron:
            addLog("雙方比點數大小！");
            setTimeout(() => {
                const pVal = state.playerHand[0].value;
                const aVal = state.aiHand[0].value;
                if (pVal > aVal) {
                    eliminate('ai', "男爵比輸了");
                } else if (pVal < aVal) {
                    eliminate('player', "男爵比輸了");
                } else {
                    addLog("點數相同，平安無事。");
                    endTurn(actor);
                }
            }, 500);
            break;

        case CardType.Handmaid:
            if (actor === 'player') state.playerIsProtected = true;
            else state.aiIsProtected = true;
            addLog(`${actor === 'player' ? '玩家' : 'AI'} 獲得了侍女的保護。`);
            endTurn(actor);
            break;

        case CardType.Prince:
            const target = actor === 'player' ? 'ai' : 'player';
            addLog(`${actor === 'player' ? '玩家' : 'AI'} 使用王子指定 ${target === 'player' ? '玩家' : 'AI'} 棄牌。`);
            discardAndDraw(target);
            endTurn(actor);
            break;

        case CardType.King:
            addLog("國王交換手牌！");
            const temp = state.playerHand;
            state.playerHand = state.aiHand;
            state.aiHand = temp;
            endTurn(actor);
            break;

        case CardType.Countess:
            endTurn(actor);
            break;
    }
}

// AI 排除法猜牌邏輯
function getAISmartGuess(): number {
    // 統計場面上已公開的牌 (棄牌堆 + 移除的那張牌不算，因為不知道)
    const knownCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
    [...state.playerDiscard, ...state.aiDiscard].forEach(c => {
        knownCounts[c.value]++;
    });

    // 排除掉已經出完的，以及排除 1 號衛兵
    const possibleGuesses: number[] = [];
    for (let i = 2; i <= 8; i++) {
        if (knownCounts[i] < CARD_DEFINITIONS[i as CardType].count) {
            possibleGuesses.push(i);
        }
    }

    if (possibleGuesses.length === 0) return 2; // 理論上不會發生
    return possibleGuesses[Math.floor(Math.random() * possibleGuesses.length)];
}

function discardAndDraw(target: PlayerType) {
    const hand = target === 'player' ? state.playerHand : state.aiHand;
    if (hand.length === 0) return;
    const discarded = hand.pop()!;
    if (target === 'player') state.playerDiscard.push(discarded);
    else state.aiDiscard.push(discarded);

    addLog(`${target === 'player' ? '玩家' : 'AI'} 棄掉了 ${discarded.name}`);

    if (discarded.type === CardType.Princess) {
        eliminate(target, "棄掉了公主");
    } else {
        if (state.deck.length > 0) {
            const newCard = state.deck.pop()!;
            if (target === 'player') state.playerHand.push(newCard);
            else state.aiHand.push(newCard);
        } else if (state.burnedCard) {
            if (target === 'player') state.playerHand.push(state.burnedCard);
            else state.aiHand.push(state.burnedCard);
            state.burnedCard = null;
        }
    }
}

function eliminate(target: PlayerType, reason: string) {
    if (target === 'player') {
        state.playerIsAlive = false;
        endGame('AI 獲勝！', `玩家${reason}出局了。`);
    } else {
        state.aiIsAlive = false;
        endGame('玩家獲勝！', `AI${reason}出局了。`);
    }
}

function checkEndConditions() {
    if (state.deck.length === 0 && state.playerHand.length === 1 && state.aiHand.length === 1) {
        addLog("牌堆已空，雙方比大小！");
        const pVal = state.playerHand[0].value;
        const aVal = state.aiHand[0].value;
        if (pVal > aVal) endGame('玩家獲勝！', `點數比拼: ${pVal} vs ${aVal}`);
        else if (aVal > pVal) endGame('AI 獲勝！', `點數比拼: ${pVal} vs ${aVal}`);
        else {
            const pSum = state.playerDiscard.reduce((s, c) => s + c.value, 0);
            const aSum = state.aiDiscard.reduce((s, c) => s + c.value, 0);
            if (pSum > aSum) endGame('玩家獲勝！', `平手比拼棄牌總和: ${pSum} vs ${aSum}`);
            else if (aSum > pSum) endGame('AI 獲勝！', `平手比拼棄牌總和: ${aSum} vs ${pSum}`);
            else endGame('平局！', '連棄牌總和都一樣，真是奇蹟。');
        }
    }
}

function endGame(winnerTitle: string, reason: string) {
    state.isGameOver = true;
    state.winner = winnerTitle;
    addLog(`【遊戲結束】${winnerTitle} (${reason})`);
    showModal("遊戲結束", `<h3 style="color:#ff4d4d; font-size: 2rem;">${winnerTitle}</h3><p>${reason}</p>`, `<button class="modal-confirm-btn" id="modal-restart-btn">再玩一局</button>`);
    document.getElementById('modal-restart-btn')!.onclick = () => {
        closeModal();
        initGame();
    };
    render();
}

function aiTurn() {
    if (state.isGameOver) return;
    drawCard('ai');
    setTimeout(() => {
        const hand = state.aiHand;
        if (checkCountessConstraint(hand)) {
            handlePlayCardRequest('ai', hand.find(c => c.type === CardType.Countess)!);
            return;
        }
        let playable = hand.filter(c => c.type !== CardType.Princess);
        if (playable.length === 0) playable = hand;
        const cardToPlay = playable[Math.floor(Math.random() * playable.length)];
        handlePlayCardRequest('ai', cardToPlay);
    }, 1000);
}

function initGame() {
    let deck = createDeck();
    deck = shuffle(deck);
    const burnedCard = deck.pop() || null;
    state = {
        deck,
        burnedCard,
        playerHand: [deck.pop()!],
        playerDiscard: [],
        playerIsProtected: false,
        playerIsAlive: true,
        aiHand: [deck.pop()!],
        aiDiscard: [],
        aiIsProtected: false,
        aiIsAlive: true,
        currentTurn: 'player',
        isGameOver: false,
        winner: null,
        logs: ["遊戲開始，玩家先攻！"]
    };
    render();
}

drawBtn.onclick = () => drawCard('player');
restartBtn.onclick = initGame;
initGame();
