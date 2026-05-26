/**
 * 驗證多電腦對戰不卡死
 * 1 人類玩家 + 2 電腦 / 1 人類玩家 + 3 電腦
 * 測試策略：自動操作人類回合（抽牌 → 打第一張可打的牌），等待遊戲自然結束。
 */
import { expect, type Page, test } from '@playwright/test';

const GAME_TIMEOUT = 90_000; // 遊戲最長允許 90 秒

/** 啟動本機模式並選擇電腦數量 */
async function startLocalGame(page: Page, botCount: 1 | 2 | 3) {
    await page.goto('/');
    await page.evaluate(() => document.getElementById('splash-screen')?.remove());
    await page.locator('#start-game-btn').click();
    await page.locator('#local-mode-btn').click();
    await page.locator(`.count-btn[data-count="${botCount}"]`).click();
    await expect(page.locator('#game-scene')).toBeVisible({ timeout: 5000 });
}

/**
 * 處理一次 modal — 依順序嘗試已知按鈕 ID / class。
 * 回傳 true 代表有 modal 並成功關閉。
 */
async function dismissModalIfVisible(page: Page): Promise<boolean> {
    const overlay = page.locator('#modal-overlay');
    if (!(await overlay.isVisible())) return false;

    // 優先順序：specific IDs → generic classes
    const candidates = [
        '#game-started-ok-btn',   // 遊戲開始提示
        '#modal-stats-confirm-btn', // Baron / King / Prince 確認
        '#modal-ok-btn',           // Priest 看牌確認
        '.target-btn >> nth=0',    // 選目標（第一個）
        '.guess-btn >> nth=0',     // Guard 猜牌（第一個猜值）
        '.modal-confirm-btn >> nth=0', // 其他所有 confirm 按鈕
    ];

    for (const sel of candidates) {
        const btn = overlay.locator(sel);
        if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
            await btn.click();
            return true;
        }
    }
    return false;
}

/**
 * 自動操作人類玩家，直到遊戲結束或逾時。
 * 每次迴圈：
 *   1. 若遊戲結束 → 回傳
 *   2. 若有 modal → 關閉
 *   3. 若抽牌按鈕可用 → 抽牌
 *   4. 若手牌有 2 張 → 點第 1 張選取，再點一次打出
 */
async function driveGameToEnd(page: Page) {
    const deadline = Date.now() + GAME_TIMEOUT;

    while (Date.now() < deadline) {
        // 遊戲結束？
        const resultBtn = page.locator('#show-result-btn');
        if (await resultBtn.isVisible({ timeout: 100 }).catch(() => false)) {
            return; // PASS — 遊戲正常結束
        }

        // 有 modal → 關閉後繼續
        if (await dismissModalIfVisible(page)) {
            await page.waitForTimeout(150);
            continue;
        }

        // 抽牌按鈕可用 → 點擊（人類回合的第一步）
        // 桌面版 CSS 強制隱藏 #draw-btn，實際顯示的是 #draw-btn-desktop
        const drawBtn = page.locator('#draw-btn-desktop');
        const canDraw = await drawBtn.isVisible({ timeout: 100 }).catch(() => false)
            && !(await drawBtn.isDisabled({ timeout: 100 }).catch(() => true));
        if (canDraw) {
            await drawBtn.click();
            await page.waitForTimeout(200);
            continue;
        }

        // 手牌有 2 張 → 選第 1 張再打出（click × 2）
        const cards = page.locator('#player-hand .card-wrapper');
        const cardCount = await cards.count();
        if (cardCount >= 2) {
            const first = cards.nth(0);
            if (await first.isVisible({ timeout: 100 }).catch(() => false)) {
                await first.click(); // 第一下：選取
                await page.waitForTimeout(100);
                await first.click(); // 第二下：打出
                await page.waitForTimeout(200);
                continue;
            }
        }

        // 等電腦思考
        await page.waitForTimeout(300);
    }

    // 逾時：抓一張截圖幫助診斷，然後 fail
    await page.screenshot({ path: `test-results/bot-turns-timeout.png` });
    throw new Error(`遊戲在 ${GAME_TIMEOUT / 1000} 秒內未結束 — 可能是電腦卡死`);
}

// ── 測試案例 ──────────────────────────────────────────────────────────────────

test.describe('電腦對戰不卡死', () => {
    test('1 人類 + 2 電腦 完整跑完', async ({ page }) => {
        test.setTimeout(GAME_TIMEOUT + 10_000);
        await startLocalGame(page, 2);
        await driveGameToEnd(page);

        // 確認「查看結果」按鈕確實出現（遊戲正常結束）
        await expect(page.locator('#show-result-btn')).toBeVisible({ timeout: 3000 });
    });

    test('1 人類 + 3 電腦 完整跑完', async ({ page }) => {
        test.setTimeout(GAME_TIMEOUT + 10_000);
        await startLocalGame(page, 3);
        await driveGameToEnd(page);

        await expect(page.locator('#show-result-btn')).toBeVisible({ timeout: 3000 });
    });
});
