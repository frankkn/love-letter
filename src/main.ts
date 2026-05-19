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

function getCoinIcons(coins: number): string {
    return coins > 0 ? ` ${'🪙'.repeat(coins)}` : '';
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
        humanTitle.textContent = `${human.name}${getCoinIcons(human.coins)} 狀態`;
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
    player.isHandRevealed = false;
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
            } else if (aVal < tVal) {
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
            } else {
                addLog(`${actor.name} 與 ${target.name} 點數相同，平安無事。`);
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
    if (state.isGameOver || !player.isAlive) return;

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
            <span style="font-size: 1.25rem; letter-spacing: 0.08rem;">${player.coins > 0 ? '🪙'.repeat(player.coins) : '<span style="font-size: 0.9rem; color: #999;">尚未得分</span>'}</span>
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
            <div style="margin-top: 1rem; font-size: 1.65rem; letter-spacing: 0.12rem;">${'🪙'.repeat(champion.coins)}</div>
        </div>
    `, `<button class="modal-confirm-btn" id="champion-return-btn">返回</button>`);

    document.getElementById('champion-return-btn')!.onclick = closeModal;
}

function endGame(winner: Player, reason: string) {
    if (state.isGameOver) return;

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
        logs: ["遊戲開始，玩家先攻！"]
    };

    showScene('game-scene');
    render();
}

function startNextRound() {
    if (!state.winner) return;

    endGameReason = '';
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

    showScene('game-scene');
    render();

    if (state.players[firstPlayerId].isBot) {
        botTurn(firstPlayerId);
    }
}

drawBtn.onclick = () => drawCard(0);
initGame(1); // 預設進來時背景跑一個 (雖然會被 menu 蓋住)
showScene('main-menu');
