// src/i18n.ts — Internationalisation for Love Letter
// Supported languages: 'zh' (Traditional Chinese, default) | 'en' (English)

export type LangCode = 'zh' | 'en';

type TV = string | ((...args: string[]) => string);
type TransMap = Record<string, TV>;

// ─────────────────────────────────────────────────────────────────────────────
// Traditional Chinese
// ─────────────────────────────────────────────────────────────────────────────
const zh: TransMap = {
    // Menu
    'menu.title':       '情書 Love Letter',
    'menu.main':        '主選單',
    'menu.startGame':   '開始遊戲',
    'menu.gameRules':   '遊戲說明',
    'menu.language':    '切換語言',
    'menu.selectMode':  '選擇遊戲模式',
    'menu.onlineMode':  '多人連線大廳 (PVP)',
    'menu.localMode':   '電腦對戰 (單機)',
    'menu.selectBots':  '請選擇電腦對手人數',
    'menu.back':        '返回',

    // Lobby
    'lobby.title':    '多人連線大廳',
    'lobby.desc':     '建立或加入一個 2-4 人的情書房間。',
    'lobby.create':   '創建房間',
    'lobby.refresh':  '重新整理',
    'lobby.noRooms':  '目前沒有房間，點「創建房間」開一局吧！',
    'lobby.loading':  '房間列表載入中...',
    'lobby.colId':    '房間 ID',
    'lobby.colCount': '人數',
    'lobby.colPwd':   '密碼',
    'lobby.locked':   '需要密碼',
    'lobby.open':     '公開房間',
    'lobby.join':     '加入',

    // Room wait
    'room.title':          '房間等待中',
    'room.idLabel':        '房間 ID：',
    'room.leave':          '離開房間',
    'room.ready':          '準備',
    'room.cancelReady':    '取消準備',
    'room.startGame':      '開始遊戲',
    'room.started':        '遊戲已開始',
    'room.waitSlot':       '等待玩家加入',
    'room.emptySlot':      '空位',
    'room.hostBadge':      '👑 房主',
    'room.statusReady':    '✔️ 已準備',
    'room.statusWaiting':  '⏳ 準備中',
    'room.statusOffline':  '⚠️ 離線，等待重連',
    'room.addBot':         '＋ 新增電腦',
    'room.removeBot':      '－ 移除電腦',
    'room.kickPlayer':     '踢出',
    'room.botStatus':      '🤖 電腦 AI',
    'room.kicked':         '你已被房主踢出房間。',

    // Create-room modal
    'cr.title':        '創建房間',
    'cr.playerName':   '玩家名稱',
    'cr.usePassword':  '設定房間密碼',
    'cr.password':     '密碼',
    'cr.pwdHint':      '不填代表公開房間',
    'cr.create':       '創建',
    'cr.cancel':       '取消',
    'cr.creating':     '建立中...',
    'cr.failTitle':    '創建房間失敗',
    'cr.joinFailed':   '加入房間失敗',
    'cr.timeout':      (ep: string) => `建立房間逾時。請確認 Colyseus 後端可連線：${ep}`,

    // Game scene
    'game.stats':        '出牌統計',
    'game.statsToggle':  '📊 出牌統計',
    'game.playerLabel':  '玩家狀態',
    'game.turnLabel':    '當前回合：',
    'game.deckLabel':    '牌堆剩餘：',
    'game.draw':         '抽牌',
    'game.viewResult':   '查看結果',
    'game.viewLog':      '查看對戰紀錄',
    'game.backHome':     '回主選單',
    'game.eliminated':   '已出局',
    'game.winner':       '勝利者',

    // Card names
    'card.guard':     '衛兵',
    'card.priest':    '神父',
    'card.baron':     '男爵',
    'card.handmaid':  '侍女',
    'card.prince':    '王子',
    'card.king':      '國王',
    'card.countess':  '伯爵夫人',
    'card.princess':  '公主',

    // Card descriptions (compact, shown on card)
    'card.desc.guard':    '猜對手手牌（衛兵除外），猜中則對方出局。',
    'card.desc.priest':   '看一名對手的手牌。',
    'card.desc.baron':    '與一名對手比大小，小者出局。',
    'card.desc.handmaid': '直到下一回合，你免疫所有卡牌效果。',
    'card.desc.prince':   '選擇一人棄掉手牌並重抽。',
    'card.desc.king':     '與一名對手交換手牌。',
    'card.desc.countess': '若持有王子或國王，則必須打出此牌。',
    'card.desc.princess': '打出或棄掉此牌時，你直接出局。',

    // Card counts (for rules modal)
    'card.count': (n: string) => `${n}張`,

    // Player names
    'player.human': '玩家',
    'player.botA':  '電腦 A',
    'player.botB':  '電腦 B',
    'player.botC':  '電腦 C',
    'player.statusSuffix': '狀態',

    // Common buttons
    'btn.confirm':       '確定',
    'btn.cancel':        '取消',
    'btn.close':         '關閉',
    'btn.ok':            '我知道了',
    'btn.back':          '返回',
    'btn.nextRound':     '開始下一局',
    'btn.viewChampion':  '查看獲勝者',
    'btn.stayField':     '📊 留在戰場查看紀錄',
    'btn.restart':       '重新開始',
    'btn.returnMenu':    '返回主選單',
    'btn.iUnderstand':   '我了解了',
    'btn.confirmDuel':   '確認對決',
    'btn.confirmSwap':   '確認交換',
    'btn.executeEffect': '確認並執行效果',

    // Card action hints
    'hint.baronVs':     (name: string) => `🎯 對 ${name} 比大小`,
    'hint.baronWin':    (name: string, card: string) => `❌ ${name}輸了 (${card})`,
    'hint.baronTie':    '🤝 平手',
    'hint.usedOn':      (name: string) => `🎯 對 ${name} 使用`,
    'hint.discarded':   (card: string) => `🗑️ 丟棄了 ${card}`,
    'hint.kingSwap':    (name: string) => `🎯 對 ${name} 交換手牌`,
    'hint.priestSaw':   (target: string, card: string, val: string) => `🎯 看見了 ${target} 的 ${card}(${val})`,

    // Baron modal
    'baron.reveal':      (a: string, b: string) => `${a} 與 ${b} 展開男爵對決。`,

    // Prince modal
    'prince.modal':      (actor: string, target: string) => `${actor} 指定 ${target} 棄掉目前手牌並重抽。`,

    // King modals
    'modal.kingSwap':    '國王交換手牌',
    'king.swapPending':  (a: string, b: string) => `${a} 即將與 ${b} 交換手牌。`,
    'king.swapDone':     (a: string, b: string) => `${a} 已與 ${b} 完成手牌交換。`,

    // Forced-effect (Prince chain) modal
    'player.opponent':   '對手',
    'modal.forcedChain': '【被迫棄牌連鎖】',
    'forced.body1':      (name: string) => `玩家 ${name} 對你打出了【王子】！`,
    'forced.body2':      (card: string) => `你被迫棄掉了手中的【${card}】並重新補抽。`,
    'forced.body3':      '接下來將執行這張棄牌的連鎖效果。',

    // Warnings
    'warn.countess': '當手中持有王子或國王時，必須先打出伯爵夫人！',
    'warn.princess': '公主不能主動打出！',

    // Target-select helper text
    'target.hint.guard':    '選擇要猜測手牌的對象。下方同步顯示目前出牌統計，方便推測目標手牌。',
    'target.hint.priest':   '選擇要查看手牌的對象。下方同步顯示目前出牌統計，方便推測牌況。',
    'target.hint.baron':    '選擇要秘密比大小的對象。下方同步顯示目前出牌統計，方便判斷剩餘牌況。',
    'target.hint.prince':   '選擇要強迫棄牌並重抽的對象。下方同步顯示目前出牌統計，方便判斷風險。',
    'target.hint.king':     '選擇要交換手牌的對象。下方同步顯示目前出牌統計，方便評估交換風險。',
    'target.hint.default':  (cardName: string) => `選擇 ${cardName} 的目標。下方同步顯示目前出牌統計，方便判斷剩餘牌況。`,

    // Guard guess modal
    'guard.prompt': '<p>請猜測目標的手牌：</p>',

    // Action hints on cards
    'hint.guardHit':   (target: string) => `💥 猜中了！${target}出局`,
    'hint.guardGuess': (target: string, card: string) => `🎯 對 ${target} 猜: ${card}`,

    // Game logs
    'log.drew':              (name: string) => `${name} 抽了一張牌。`,
    'log.played':            (name: string, card: string, val: string) => `${name} 打出了 ${card} (${val})`,
    'log.noNextPlayer':      '找不到下一位存活玩家，回合停止。',
    'log.noLegalTarget':     '沒有合法的目標，效果失效。',
    'log.handmaidProtected': (name: string) => `${name} 獲得了侍女的保護。`,
    'log.guardGuess':        (actor: string, target: string, val: string, card: string) => `${actor} 對 ${target} 猜測 ${val} (${card})`,
    'log.guardHit':          '猜中了！',
    'log.guardMiss':         '猜錯了。',
    'log.priestSaw':         (actor: string, target: string) => `${actor} 看了一下 ${target} 的手牌。`,
    'log.baronCompare':      (actor: string, target: string) => `${actor} 與 ${target} 秘密比大小！`,
    'log.baronNoHand':       '無法比點數，因為其中一方沒有手牌。',
    'log.baronTie':          (a: string, ac: string, av: string, b: string, bc: string, bv: string) =>
                                 `最後兩名對決者攤牌：${a} 亮出 ${ac}(${av})，${b} 亮出 ${bc}(${bv})。`,
    'log.baronTargetLoses':  (actor: string, target: string, tc: string, tv: string) =>
                                 `${actor} 與 ${target} 比點數，${target} 點數較小，攤牌 ${tc}(${tv}) 出局！`,
    'log.baronActorLoses':   (actor: string, target: string, ac: string, av: string) =>
                                 `${actor} 與 ${target} 比點數，${actor} 點數較小，攤牌 ${ac}(${av}) 出局！`,
    'log.princeForced':      (actor: string, target: string) => `${actor} 強迫 ${target} 棄牌！`,
    'log.kingExchange':      (actor: string, target: string) => `${actor} 與 ${target} 交換手牌！`,
    'log.discarded':         (name: string, card: string) => `${name} 棄掉了 ${card}`,
    'log.redrew':            (name: string) => `${name} 補抽了一張牌。`,
    'log.redrewBurned':      (name: string) => `${name} 補抽了燒掉的牌。`,
    'log.eliminated':        (name: string, reason: string) => `${name}${reason}出局了！`,
    'log.deckEmpty':         '牌堆已空，存活者比大小！',
    'log.gameOver':          (winner: string, reason: string) => `【遊戲結束】${winner} 獲勝並獲得 1 枚硬幣！(${reason})`,
    'log.onlineStart':       '多人遊戲開始，房主已同步初始牌局。',
    'log.newRound':          (name: string) => `新一局開始，${name} 作為上一局勝出者先攻！`,
    'log.localStart':        '遊戲開始，玩家先攻！',

    // Elimination reasons (passed into log.eliminated)
    'reason.princessPlayed':    '打出或棄掉了公主，',
    'reason.guardHit':          '被衛兵猜中手牌，',
    'reason.baronLost':         '男爵比輸了，',
    'reason.princessDiscarded': '棄掉了公主，',
    'reason.lastSurvivor':      '作為最後的倖存者',
    'reason.highestCard':       (val: string) => `比點數獲勝 (${val})`,
    'reason.onlyPlayer':        '場上只剩下最後一名存活者',

    // Modal titles
    'modal.hint':            '提示',
    'modal.selectTarget':    (card: string) => `請選擇 ${card} 的目標`,
    'modal.guardTarget':     (target: string) => `對 ${target} 使用衛兵`,
    'modal.priestSees':      (target: string) => `神父：看見 ${target} 的手牌`,
    'modal.gameResult':      '本局結果',
    'modal.champion':        '聯賽總冠軍',
    'modal.battleLog':       '對戰紀錄',
    'modal.gameStarted':     '遊戲開始',
    'modal.waitNextRound':   '等待下一局',
    'modal.waitRestart':     '等待重新開始',
    'modal.baronDuel':       '男爵對決',
    'modal.gameAborted':     '遊戲中斷',
    'modal.connLost':        '連線中斷',
    'modal.language':        '切換語言',

    // Game-started modal body
    'gameStarted.body': '房間狀態已同步，準備載入多人遊戲戰場。',

    // Rankings
    'ranking.title':   '目前聯賽排行榜',
    'ranking.desc':    '先取得 4 枚硬幣的玩家，成為 Love Letter 總冠軍。',
    'ranking.rank':    (r: string) => `第 ${r} 名`,
    'ranking.noScore': '尚未得分',

    // Champion modal
    'champion.desc': '最終拿滿 4 枚硬幣的 Love Letter 總冠軍大贏家！🎉',

    // End-game modal
    'endgame.wins': (name: string) => `${name} 獲勝！`,

    // Wait modals
    'wait.nextRound.msg':      '你已準備開始下一局。請等待其他玩家確認。',
    'wait.nextRound.waiting':  (name: string) => `等待 ${name} 加入下一局`,
    'wait.nextRound.allReady': '所有玩家已準備，正在開始下一局...',
    'wait.nextRound.stay':     '留在戰場查看紀錄',
    'wait.restart.msg':        '你已確認重新開始全新聯賽（所有硬幣歸零）。請等待其他玩家確認。',
    'wait.restart.waiting':    (name: string) => `等待 ${name} 確認重新開始`,
    'wait.restart.allReady':   '所有玩家已確認，正在重新開始...',

    // Abort / connection-lost modals
    'abort.body':      (name: string) => `玩家 ${name} 已離開遊戲，對局中止。`,
    'abort.sub':       '若要繼續遊戲，請回到主選單重新開房間。',
    'connLost.body':   '與伺服器的連線已中斷，可能是網路問題或後端服務暫時無法使用。',
    'connLost.sub':    '若需繼續遊戲，請稍後再試。',

    // Coins aria-label
    'coins.label': (n: string) => `${n} 枚硬幣`,

    // Language names / selector
    'lang.zh':      '繁體中文',
    'lang.en':      'English',
    'lang.current': (name: string) => `目前語言：${name}`,

    // Battle log
    'battleLog.noLog': '目前還沒有對戰紀錄。',

    // Lobby (dynamic content)
    'lobby.connFailed':   '無法連線至 Colyseus 大廳',
    'lobby.noRoomsTitle': '目前沒有可加入的房間',
    'lobby.noRoomsDesc':  '建立一個新房間，等待其他玩家加入。',

    // Join room prompts
    'joinRoom.promptName': '請輸入玩家名稱',
    'joinRoom.promptPwd':  '請輸入房間密碼',

    // Confirm dialog
    'confirm.backHome': '確定要放棄目前戰局並返回主選單嗎？',

    // Abort reasons (dynamic)
    'abort.separator':     '、',
    'abort.reasonNames':   (names: string) => `${names} 失去連線，剩餘玩家不足，本局已結束。`,
    'abort.reasonGeneral': '剩餘玩家不足，本局已結束。',
    'abort.goHome':        '請點擊下方按鈕返回主選單。',

    // Player name fallback
    'player.fallback': (n: string) => `玩家 ${n}`,

    // Guard elimination modal (shown to the player who was caught by a Guard)
    'modal.guardEliminated':   '你被衛兵猜中了！',
    'guard.eliminated':        (actor: string, card: string) => `${actor} 猜中了你的手牌【${card}】，你就此出局。`,

    // Prince + Princess warning (added to the forced-discard confirmation)
    'prince.princess.warning': '你的手牌是公主！棄牌後你將立刻出局。',

    // Deck-empty final showdown modal
    'modal.deckShowdown':      '牌堆已空！最終攤牌',
    'deckShowdown.intro':      '存活玩家展示手牌，點數最大者獲勝：',
    'deckShowdown.winner':     '🏆 獲勝',
};

// ─────────────────────────────────────────────────────────────────────────────
// English
// ─────────────────────────────────────────────────────────────────────────────
const en: TransMap = {
    // Menu
    'menu.title':       'Love Letter',
    'menu.main':        'Main Menu',
    'menu.startGame':   'Start Game',
    'menu.gameRules':   'Game Rules',
    'menu.language':    'Language',
    'menu.selectMode':  'Select Mode',
    'menu.onlineMode':  'Online Lobby (PVP)',
    'menu.localMode':   'vs. Computer (Solo)',
    'menu.selectBots':  'Number of Opponents',
    'menu.back':        'Back',

    // Lobby
    'lobby.title':    'Online Lobby',
    'lobby.desc':     'Create or join a 2–4 player Love Letter room.',
    'lobby.create':   'Create Room',
    'lobby.refresh':  'Refresh',
    'lobby.noRooms':  'No rooms yet — click "Create Room" to start one!',
    'lobby.loading':  'Loading rooms…',
    'lobby.colId':    'Room ID',
    'lobby.colCount': 'Players',
    'lobby.colPwd':   'Password',
    'lobby.locked':   'Password required',
    'lobby.open':     'Open',
    'lobby.join':     'Join',

    // Room wait
    'room.title':          'Waiting Room',
    'room.idLabel':        'Room ID: ',
    'room.leave':          'Leave Room',
    'room.ready':          'Ready',
    'room.cancelReady':    'Cancel Ready',
    'room.startGame':      'Start Game',
    'room.started':        'Game Started',
    'room.waitSlot':       'Waiting for player…',
    'room.emptySlot':      'Empty',
    'room.hostBadge':      '👑 Host',
    'room.statusReady':    '✔️ Ready',
    'room.statusWaiting':  '⏳ Not Ready',
    'room.statusOffline':  '⚠️ Offline, reconnecting…',
    'room.addBot':         '＋ Add Bot',
    'room.removeBot':      '－ Remove Bot',
    'room.kickPlayer':     'Kick',
    'room.botStatus':      '🤖 Computer AI',
    'room.kicked':         'You have been kicked from the room by the host.',

    // Create-room modal
    'cr.title':        'Create Room',
    'cr.playerName':   'Your Name',
    'cr.usePassword':  'Set room password',
    'cr.password':     'Password',
    'cr.pwdHint':      'Leave blank for a public room',
    'cr.create':       'Create',
    'cr.cancel':       'Cancel',
    'cr.creating':     'Creating…',
    'cr.failTitle':    'Failed to Create Room',
    'cr.joinFailed':   'Failed to Join Room',
    'cr.timeout':      (ep: string) => `Room creation timed out. Make sure the Colyseus backend is reachable: ${ep}`,

    // Game scene
    'game.stats':        'Card Stats',
    'game.statsToggle':  '📊 Card Stats',
    'game.playerLabel':  'Player Status',
    'game.turnLabel':    'Turn: ',
    'game.deckLabel':    'Deck: ',
    'game.draw':         'Draw',
    'game.viewResult':   'View Results',
    'game.viewLog':      'Battle Log',
    'game.backHome':     'Menu',
    'game.eliminated':   'Eliminated',
    'game.winner':       'Winner',

    // Card names
    'card.guard':     'Guard',
    'card.priest':    'Priest',
    'card.baron':     'Baron',
    'card.handmaid':  'Handmaid',
    'card.prince':    'Prince',
    'card.king':      'King',
    'card.countess':  'Countess',
    'card.princess':  'Princess',

    // Card descriptions
    'card.desc.guard':    "Guess an opponent's card (not Guard). Correct = they're out.",
    'card.desc.priest':   "Secretly peek at one opponent's hand.",
    'card.desc.baron':    'Compare hands with an opponent. Lower card is eliminated.',
    'card.desc.handmaid': 'Protected from all card effects until your next turn.',
    'card.desc.prince':   'Force any player to discard and redraw. That card triggers its effect.',
    'card.desc.king':     'Swap hands with an opponent.',
    'card.desc.countess': 'Must be played if you also hold the Prince or King.',
    'card.desc.princess': 'Eliminated if you ever play or discard this card.',

    // Card counts
    'card.count': (n: string) => `×${n}`,

    // Player names
    'player.human': 'Player',
    'player.botA':  'Bot A',
    'player.botB':  'Bot B',
    'player.botC':  'Bot C',
    'player.statusSuffix': '',

    // Common buttons
    'btn.confirm':       'OK',
    'btn.cancel':        'Cancel',
    'btn.close':         'Close',
    'btn.ok':            'Got it',
    'btn.back':          'Back',
    'btn.nextRound':     'Next Round',
    'btn.viewChampion':  'View Champion',
    'btn.stayField':     '📊 Stay & View Log',
    'btn.restart':       'Restart League',
    'btn.returnMenu':    'Return to Menu',
    'btn.iUnderstand':   'Understood',
    'btn.confirmDuel':   'Confirm Duel',
    'btn.confirmSwap':   'Confirm Swap',
    'btn.executeEffect': 'OK — Resolve Effect',

    // Card action hints
    'hint.baronVs':     (name: string) => `🎯 vs ${name}`,
    'hint.baronWin':    (name: string, card: string) => `❌ ${name} lost (${card})`,
    'hint.baronTie':    '🤝 Tie',
    'hint.usedOn':      (name: string) => `🎯 Used on ${name}`,
    'hint.discarded':   (card: string) => `🗑️ Discarded ${card}`,
    'hint.kingSwap':    (name: string) => `🎯 Swapped with ${name}`,
    'hint.priestSaw':   (target: string, card: string, val: string) => `🎯 Saw ${target}'s ${card}(${val})`,

    // Baron modal
    'baron.reveal':      (a: string, b: string) => `${a} and ${b} face off in a Baron duel.`,

    // Prince modal
    'prince.modal':      (actor: string, target: string) => `${actor} forces ${target} to discard and redraw.`,

    // King modals
    'modal.kingSwap':    'King: Swap Hands',
    'king.swapPending':  (a: string, b: string) => `${a} is about to swap hands with ${b}.`,
    'king.swapDone':     (a: string, b: string) => `${a} and ${b} have swapped hands.`,

    // Forced-effect (Prince chain) modal
    'player.opponent':   'Opponent',
    'modal.forcedChain': 'Forced Discard Chain',
    'forced.body1':      (name: string) => `${name} played the Prince on you!`,
    'forced.body2':      (card: string) => `You were forced to discard the ${card} and draw a new card.`,
    'forced.body3':      "The discarded card's effect will now trigger.",

    // Warnings
    'warn.countess': 'You must play the Countess while holding the Prince or King!',
    'warn.princess': 'You cannot voluntarily play the Princess!',

    // Target-select helper text
    'target.hint.guard':   "Choose whose hand to guess. Card stats below can help narrow it down.",
    'target.hint.priest':  "Choose whose hand to peek at. Card stats below can help.",
    'target.hint.baron':   "Choose who to compare hands with. Card stats below can help assess risk.",
    'target.hint.prince':  "Choose who must discard and redraw. Card stats below show the risks.",
    'target.hint.king':    "Choose who to swap hands with. Card stats below can help evaluate the trade.",
    'target.hint.default': (cardName: string) => `Choose a target for ${cardName}. Card stats are shown below.`,

    // Guard guess modal
    'guard.prompt': "<p>Guess the target's card:</p>",

    // Action hints on cards
    'hint.guardHit':   (target: string) => `💥 Correct! ${target} eliminated`,
    'hint.guardGuess': (target: string, card: string) => `🎯 Guessed ${card} for ${target}`,

    // Game logs
    'log.drew':              (name: string) => `${name} drew a card.`,
    'log.played':            (name: string, card: string, val: string) => `${name} played ${card} (${val})`,
    'log.noNextPlayer':      'No next alive player found; turn stopped.',
    'log.noLegalTarget':     'No valid target — effect fizzles.',
    'log.handmaidProtected': (name: string) => `${name} is protected by the Handmaid.`,
    'log.guardGuess':        (actor: string, target: string, val: string, card: string) => `${actor} guesses ${target} holds ${val} (${card})`,
    'log.guardHit':          'Correct!',
    'log.guardMiss':         'Wrong.',
    'log.priestSaw':         (actor: string, target: string) => `${actor} peeked at ${target}'s hand.`,
    'log.baronCompare':      (actor: string, target: string) => `${actor} and ${target} compare hands!`,
    'log.baronNoHand':       'Cannot compare — one player has no card.',
    'log.baronTie':          (a: string, ac: string, av: string, b: string, bc: string, bv: string) =>
                                 `Showdown: ${a} reveals ${ac}(${av}), ${b} reveals ${bc}(${bv}).`,
    'log.baronTargetLoses':  (actor: string, target: string, tc: string, tv: string) =>
                                 `${actor} vs ${target}: ${target} has the lower card ${tc}(${tv}) — eliminated!`,
    'log.baronActorLoses':   (actor: string, target: string, ac: string, av: string) =>
                                 `${actor} vs ${target}: ${actor} has the lower card ${ac}(${av}) — eliminated!`,
    'log.princeForced':      (actor: string, target: string) => `${actor} forces ${target} to discard!`,
    'log.kingExchange':      (actor: string, target: string) => `${actor} and ${target} swap hands!`,
    'log.discarded':         (name: string, card: string) => `${name} discarded ${card}`,
    'log.redrew':            (name: string) => `${name} drew a new card.`,
    'log.redrewBurned':      (name: string) => `${name} drew the burned card.`,
    'log.eliminated':        (name: string, reason: string) => `${name} is eliminated (${reason})!`,
    'log.deckEmpty':         'Deck empty — survivors reveal their hands!',
    'log.gameOver':          (winner: string, reason: string) => `[Game Over] ${winner} wins and earns 1 token! (${reason})`,
    'log.onlineStart':       'Online game started. Host has synced the initial state.',
    'log.newRound':          (name: string) => `New round — ${name} goes first as the previous winner!`,
    'log.localStart':        'Game started — Player goes first!',

    // Elimination reasons
    'reason.princessPlayed':    'played/discarded the Princess',
    'reason.guardHit':          'Guard guess correct',
    'reason.baronLost':         'lost the Baron duel',
    'reason.princessDiscarded': 'discarded the Princess',
    'reason.lastSurvivor':      'last survivor',
    'reason.highestCard':       (val: string) => `highest card (${val})`,
    'reason.onlyPlayer':        'only player remaining',

    // Modal titles
    'modal.hint':            'Notice',
    'modal.selectTarget':    (card: string) => `Select a target for ${card}`,
    'modal.guardTarget':     (target: string) => `Guard: Guess ${target}'s card`,
    'modal.priestSees':      (target: string) => `Priest: Peek at ${target}'s hand`,
    'modal.gameResult':      'Round Result',
    'modal.champion':        'League Champion',
    'modal.battleLog':       'Battle Log',
    'modal.gameStarted':     'Game Started',
    'modal.waitNextRound':   'Waiting for Next Round',
    'modal.waitRestart':     'Waiting to Restart',
    'modal.baronDuel':       'Baron Duel',
    'modal.gameAborted':     'Game Aborted',
    'modal.connLost':        'Connection Lost',
    'modal.language':        'Language',

    // Game-started modal body
    'gameStarted.body': 'Room state synced. Loading the online battlefield…',

    // Rankings
    'ranking.title':   'League Standings',
    'ranking.desc':    'First to 4 tokens wins the league.',
    'ranking.rank':    (r: string) => `#${r}`,
    'ranking.noScore': 'No tokens yet',

    // Champion modal
    'champion.desc': 'Congratulations — League Champion with 4 tokens! 🎉',

    // End-game modal
    'endgame.wins': (name: string) => `${name} wins!`,

    // Wait modals
    'wait.nextRound.msg':      "You're ready for the next round. Waiting for others…",
    'wait.nextRound.waiting':  (name: string) => `Waiting for ${name}`,
    'wait.nextRound.allReady': 'All players ready — starting next round…',
    'wait.nextRound.stay':     'Stay & View Log',
    'wait.restart.msg':        'You confirmed a full restart (all tokens reset). Waiting for others…',
    'wait.restart.waiting':    (name: string) => `Waiting for ${name} to confirm`,
    'wait.restart.allReady':   'All confirmed — restarting…',

    // Abort / connection-lost modals
    'abort.body':      (name: string) => `${name} has left the game. The match is over.`,
    'abort.sub':       'Return to the main menu to start a new game.',
    'connLost.body':   'Lost connection to the server. This may be a network or backend issue.',
    'connLost.sub':    'Please try again later.',

    // Coins aria-label
    'coins.label': (n: string) => `${n} token${parseInt(n) !== 1 ? 's' : ''}`,

    // Language names / selector
    'lang.zh':      '繁體中文',
    'lang.en':      'English',
    'lang.current': (name: string) => `Current language: ${name}`,

    // Battle log
    'battleLog.noLog': 'No battle log entries yet.',

    // Lobby (dynamic content)
    'lobby.connFailed':   'Could not connect to the lobby',
    'lobby.noRoomsTitle': 'No rooms available',
    'lobby.noRoomsDesc':  'Create a new room and wait for others to join.',

    // Join room prompts
    'joinRoom.promptName': 'Enter your player name',
    'joinRoom.promptPwd':  'Enter room password',

    // Confirm dialog
    'confirm.backHome': 'Abandon the current game and return to the main menu?',

    // Abort reasons (dynamic)
    'abort.separator':     ', ',
    'abort.reasonNames':   (names: string) => `${names} disconnected. Not enough players to continue.`,
    'abort.reasonGeneral': 'Not enough players to continue.',
    'abort.goHome':        'Use the button below to return to the main menu.',

    // Player name fallback
    'player.fallback': (n: string) => `Player ${n}`,

    // Guard elimination modal
    'modal.guardEliminated':   'Caught by a Guard!',
    'guard.eliminated':        (actor: string, card: string) => `${actor} correctly guessed your ${card}. You are eliminated.`,

    // Prince + Princess warning
    'prince.princess.warning': 'Your card is the Princess — discarding it will eliminate you immediately!',

    // Deck-empty final showdown modal
    'modal.deckShowdown':      'Deck Empty — Final Showdown',
    'deckShowdown.intro':      'Survivors reveal their cards. Highest value wins:',
    'deckShowdown.winner':     '🏆 Winner',
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'love-letter-lang';

let _lang: LangCode = (() => {
    const stored = localStorage.getItem(STORAGE_KEY) as LangCode | null;
    return stored === 'zh' || stored === 'en' ? stored : 'zh';
})();

export function getLang(): LangCode { return _lang; }

export function setLang(lang: LangCode): void {
    _lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
}

/** Look up a translation key, optionally interpolating arguments. */
export function t(key: string, ...args: string[]): string {
    const map: TransMap = _lang === 'zh' ? zh : en;
    const val: TV = map[key] ?? zh[key];
    if (val === undefined) return key;
    if (typeof val === 'function') return val(...args);
    return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rules modal HTML (generated per language)
// ─────────────────────────────────────────────────────────────────────────────
function rowColor(i: number): string {
    const bg = ['#ff4d4d','#ff5a5f','#ef6f6c','#f28f3b','#ffb000','#49a078','#5f8dd3','#8f5fd3'];
    return bg[i] ?? '#888';
}

export function createRulesBodyHTML(): string {
    if (_lang === 'en') return createRulesBodyHTML_en();
    return createRulesBodyHTML_zh();
}

function createRulesBodyHTML_zh(): string {
    const cards = [
        { val: 1, name: '衛兵',    count: '5', effect: '選擇一名對手並猜測其手牌（不能猜衛兵），若猜中則對方直接出局。' },
        { val: 2, name: '神父',    count: '2', effect: '選擇一名對手並秘密查看他的手牌。' },
        { val: 3, name: '男爵',    count: '2', effect: '選擇一名對手秘密比大小，點數較小者直接出局。' },
        { val: 4, name: '侍女',    count: '2', effect: '直到你的下個回合開始前，你免疫所有卡牌效果指定。' },
        { val: 5, name: '王子',    count: '2', effect: '選擇任一玩家（可選自己）棄掉手牌，被迫棄牌者立刻補抽一張，且被棄掉的卡牌會立刻發動效果。' },
        { val: 6, name: '國王',    count: '1', effect: '選擇一名對手並與他秘密交換手牌。' },
        { val: 7, name: '伯爵夫人',count: '1', effect: '若手上另一張牌是[5]王子或[6]國王，則必須強制打出此牌。' },
        { val: 8, name: '公主',    count: '1', effect: '此卡不論因何種原因被主動打出或被迫棄掉，你都將立刻直接出局。' },
    ];
    const rows = cards.map((c, i) => `
        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
            <td style="padding: 0.7rem; font-weight: 700;"><span style="display:inline-flex;align-items:center;justify-content:center;width:1.7rem;height:1.7rem;margin-right:0.45rem;border-radius:50%;background:${rowColor(i)};color:white;">${c.val}</span>${c.name}</td>
            <td style="padding: 0.7rem; text-align:center; color:#ffb000; font-weight:700;">${c.count}張</td>
            <td style="padding: 0.7rem;">${c.effect}</td>
        </tr>`).join('');
    return `
        <div style="text-align:left;font-size:0.92rem;line-height:1.65;max-height:68vh;overflow-y:auto;padding-right:0.4rem;">
            <section style="margin-bottom:1.35rem;">
                <h3 style="margin:0 0 0.75rem;color:#ffb000;font-size:1.15rem;">1. 卡牌種類與效果（整副牌共 16 張）</h3>
                <table style="width:100%;border-collapse:collapse;overflow:hidden;border-radius:8px;background:rgba(255,255,255,0.04);">
                    <thead><tr style="background:rgba(255,176,0,0.16);color:#ffd36a;">
                        <th style="padding:0.65rem 0.7rem;text-align:left;white-space:nowrap;">點數 / 名稱</th>
                        <th style="padding:0.65rem 0.7rem;text-align:center;white-space:nowrap;">張數</th>
                        <th style="padding:0.65rem 0.7rem;text-align:left;">詳細效果描述</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </section>
            <section style="margin-bottom:1.1rem;">
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">2. 遊戲流程</h3>
                <p style="margin:0;">遊戲開始時，會先從 16 張卡牌中隨機移除一張（銷毀牌）。每位玩家先發一張手牌。每個回合「抽一張牌，選一張牌打出」，設法透過卡牌效果淘汰其他對手。</p>
            </section>
            <section style="margin-bottom:1.1rem;">
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">3. 勝負判定</h3>
                <p style="margin:0;">當牌堆沒有卡牌時，所有存活玩家攤牌比點數，點數最大者獲勝。若點數相同，則比較各自已打出牌堆的點數總和，大者獲勝。</p>
            </section>
            <section>
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">4. 次局規則</h3>
                <p style="margin:0;">每局遊戲結束後，由該局的勝出者擔任下一局遊戲的先攻（最先開始抽卡的人）。</p>
            </section>
        </div>`;
}

function createRulesBodyHTML_en(): string {
    const cards = [
        { val: 1, name: 'Guard',    count: '5', effect: "Choose an opponent and guess their card (not Guard). If correct, they are immediately eliminated." },
        { val: 2, name: 'Priest',   count: '2', effect: "Choose an opponent and secretly look at their hand." },
        { val: 3, name: 'Baron',    count: '2', effect: "Choose an opponent and secretly compare hands. The player with the lower card is eliminated." },
        { val: 4, name: 'Handmaid', count: '2', effect: "You are immune to all card effects until the start of your next turn." },
        { val: 5, name: 'Prince',   count: '2', effect: "Choose any player (including yourself) to discard their hand and draw a new card. The discarded card triggers its effect." },
        { val: 6, name: 'King',     count: '1', effect: "Choose an opponent and secretly swap hands with them." },
        { val: 7, name: 'Countess', count: '1', effect: "If your other card is the Prince [5] or King [6], you MUST play the Countess." },
        { val: 8, name: 'Princess', count: '1', effect: "If you ever play or discard this card for any reason, you are immediately eliminated." },
    ];
    const rows = cards.map((c, i) => `
        <tr style="border-top: 1px solid rgba(255,255,255,0.1);">
            <td style="padding:0.7rem;font-weight:700;"><span style="display:inline-flex;align-items:center;justify-content:center;width:1.7rem;height:1.7rem;margin-right:0.45rem;border-radius:50%;background:${rowColor(i)};color:white;">${c.val}</span>${c.name}</td>
            <td style="padding:0.7rem;text-align:center;color:#ffb000;font-weight:700;">×${c.count}</td>
            <td style="padding:0.7rem;">${c.effect}</td>
        </tr>`).join('');
    return `
        <div style="text-align:left;font-size:0.92rem;line-height:1.65;max-height:68vh;overflow-y:auto;padding-right:0.4rem;">
            <section style="margin-bottom:1.35rem;">
                <h3 style="margin:0 0 0.75rem;color:#ffb000;font-size:1.15rem;">1. Card Types (16 cards total)</h3>
                <table style="width:100%;border-collapse:collapse;overflow:hidden;border-radius:8px;background:rgba(255,255,255,0.04);">
                    <thead><tr style="background:rgba(255,176,0,0.16);color:#ffd36a;">
                        <th style="padding:0.65rem 0.7rem;text-align:left;white-space:nowrap;">Value / Name</th>
                        <th style="padding:0.65rem 0.7rem;text-align:center;white-space:nowrap;">Count</th>
                        <th style="padding:0.65rem 0.7rem;text-align:left;">Effect</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </section>
            <section style="margin-bottom:1.1rem;">
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">2. Game Flow</h3>
                <p style="margin:0;">At the start one card is burned face-down. Each player starts with 1 card. On your turn: draw 1 card, then play 1. Use card effects to eliminate opponents.</p>
            </section>
            <section style="margin-bottom:1.1rem;">
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">3. Winning a Round</h3>
                <p style="margin:0;">When the deck runs out, all survivors reveal their hands. The highest card wins. Ties are broken by the highest total value of discarded cards.</p>
            </section>
            <section>
                <h3 style="margin:0 0 0.45rem;color:#ffb000;font-size:1.08rem;">4. League Rules</h3>
                <p style="margin:0;">The round winner goes first in the next round. The first player to reach 4 tokens wins the league.</p>
            </section>
        </div>`;
}
