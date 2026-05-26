/**
 * 聊天室功能驗證腳本
 * 模擬兩位玩家加入同一房間並測試聊天功能
 */
import { expect, type Browser, type Page, test } from '@playwright/test';

type Player = { name: string; page: Page; close: () => Promise<void> };

async function mkPlayer(browser: Browser, name: string): Promise<Player> {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', d => d.accept(name));
    return { name, page, close: () => ctx.close() };
}

async function goOnline(page: Page) {
    await page.goto('/');
    await page.evaluate(() => document.getElementById('splash-screen')?.remove());
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(page: Page, name: string) {
    await goOnline(page);
    await page.locator('#create-room-btn').click();
    await page.locator('#create-room-player-name').fill(name);
    await page.locator('#confirm-create-room-btn').click();
    await expect(page.locator('#room-wait-scene')).toBeVisible();
    const roomId = (await page.locator('#current-room-id').textContent())?.trim();
    return roomId!;
}

async function joinRoom(player: Player, roomId: string) {
    await goOnline(player.page);
    const btn = player.page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(btn).toBeVisible({ timeout: 5000 });
    await btn.click();
    await expect(player.page.locator('#room-wait-scene')).toBeVisible();
}

async function startGame(host: Player, guest: Player) {
    // Guest marks ready first
    await guest.page.locator('#ready-toggle-btn').click();
    // Wait for host's "Start Game" button to become enabled
    await expect(host.page.locator('#ready-toggle-btn')).toBeEnabled({ timeout: 5000 });
    // Host clicks "Start Game"
    await host.page.locator('#ready-toggle-btn').click();
    // Both should land in game-scene
    await expect(host.page.locator('#game-scene')).toBeVisible({ timeout: 8000 });
    await expect(guest.page.locator('#game-scene')).toBeVisible({ timeout: 8000 });
    // Dismiss "Game Started" modal if present
    for (const player of [host, guest]) {
        const okBtn = player.page.locator('#game-started-ok-btn');
        if (await okBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await okBtn.click();
        }
    }
}

// ── 測試 ────────────────────────────────────────────────────────────────────

test.describe('聊天室功能驗證', () => {
    test('訊息收發、未讀 badge、panel 開關', async ({ browser }) => {
        const alice = await mkPlayer(browser, 'Alice');
        const bob   = await mkPlayer(browser, 'Bob');

        // ① 建立房間並加入
        const roomId = await createRoom(alice.page, 'Alice');
        await joinRoom(bob, roomId);

        // ② 開始遊戲
        await startGame(alice, bob);

        // ③ 確認聊天按鈕存在（僅多人模式）
        await expect(alice.page.locator('#chat-btn')).toBeVisible();
        await expect(bob.page.locator('#chat-btn')).toBeVisible();

        // ④ Bob 的 chat panel 是關的，badge 不顯示
        await expect(bob.page.locator('#chat-panel')).not.toHaveClass(/open/);
        await expect(bob.page.locator('#chat-unread-badge')).not.toBeVisible();

        // ⑤ Alice 開啟 panel 並送出一條訊息
        await alice.page.locator('#chat-btn').click();
        await expect(alice.page.locator('#chat-panel')).toHaveClass(/open/);
        await alice.page.locator('#chat-input').fill('Hello Bob!');
        await alice.page.locator('#chat-send-btn').click();

        // ⑥ Alice 的 panel 裡要看到自己的訊息
        await expect(alice.page.locator('#chat-messages')).toContainText('Alice');
        await expect(alice.page.locator('#chat-messages')).toContainText('Hello Bob!');

        // ⑦ Bob 的 badge 應出現數字 1（panel 仍關著）
        await expect(bob.page.locator('#chat-unread-badge')).toBeVisible({ timeout: 3000 });
        await expect(bob.page.locator('#chat-unread-badge')).toHaveText('1');

        // ⑧ Bob 再送一條給 Alice（用 Enter 鍵）
        await alice.page.locator('#chat-input').fill('second');
        await alice.page.keyboard.press('Enter');
        await expect(bob.page.locator('#chat-unread-badge')).toHaveText('2', { timeout: 3000 });

        // ⑨ Bob 開啟 panel → badge 清零
        await bob.page.locator('#chat-btn').click();
        await expect(bob.page.locator('#chat-panel')).toHaveClass(/open/);
        await expect(bob.page.locator('#chat-unread-badge')).not.toBeVisible();

        // ⑩ Bob 的訊息列表包含 Alice 發的內容
        await expect(bob.page.locator('#chat-messages')).toContainText('Hello Bob!');
        await expect(bob.page.locator('#chat-messages')).toContainText('second');

        // ⑪ Bob 回一條給 Alice
        await bob.page.locator('#chat-input').fill('Hi Alice!');
        await bob.page.locator('#chat-send-btn').click();
        await expect(alice.page.locator('#chat-messages')).toContainText('Hi Alice!', { timeout: 3000 });

        // ⑫ Alice 的 badge 應增加（panel 已開，badge 不應增加）
        // Alice's panel is open so no badge increment expected
        await expect(alice.page.locator('#chat-unread-badge')).not.toBeVisible();

        // ⑬ 點遮罩關閉 Bob 的 panel（panel 佔畫面下半，點擊上方區域）
        await bob.page.locator('#chat-backdrop').click({ position: { x: 100, y: 50 } });
        await expect(bob.page.locator('#chat-panel')).not.toHaveClass(/open/);

        // ⑭ 點 ✕ 關閉 Alice 的 panel
        await alice.page.locator('#chat-close-btn').click();
        await expect(alice.page.locator('#chat-panel')).not.toHaveClass(/open/);

        await alice.close();
        await bob.close();
    });

    test('離線模式不顯示聊天按鈕', async ({ browser }) => {
        const ctx  = await browser.newContext();
        const page = await ctx.newPage();
        await page.goto('/');
        await page.evaluate(() => document.getElementById('splash-screen')?.remove());
        await page.locator('#start-game-btn').click();
        // 選本機模式
        await page.locator('#local-mode-btn').click();
        // 直接進入遊戲（選 1 個 bot）
        await page.locator('.count-btn').first().click();

        await expect(page.locator('#game-scene')).toBeVisible({ timeout: 5000 });
        // 聊天按鈕應為隱藏
        await expect(page.locator('#chat-btn')).not.toBeVisible();
        await ctx.close();
    });
});
