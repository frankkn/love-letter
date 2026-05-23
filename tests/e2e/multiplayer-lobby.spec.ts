import { expect, type Page, test } from '@playwright/test';

async function openOnlineLobby(page: Page) {
    await page.goto('/');
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(page: Page, playerName: string) {
    await page.locator('#create-room-btn').click();
    await page.locator('#create-room-player-name').fill(playerName);
    await page.locator('#confirm-create-room-btn').click();
    await expect(page.locator('#room-wait-scene')).toBeVisible();
    await expect(page.locator('#room-player-count')).toHaveText('1/4');
    await expect(page.locator('#room-player-list')).toContainText(playerName);
    return page.locator('#current-room-id').innerText();
}

async function joinRoom(page: Page, roomId: string, playerName: string) {
    const joinButton = page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(joinButton).toBeVisible();

    page.once('dialog', async dialog => {
        await dialog.accept(playerName);
    });

    await joinButton.click();
    await expect(page.locator('#room-wait-scene')).toBeVisible();
}

test('two players can create, join, ready, and start through Colyseus state sync', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');

        await expect(guestPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(guestPage.locator('#room-player-list')).toContainText('Alice');
        await expect(guestPage.locator('#room-player-list')).toContainText('Bob');

        await expect(hostPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        await guestPage.locator('#ready-toggle-btn').click();

        await expect(guestPage.locator('.room-player-row', { hasText: 'Bob' }).locator('.player-status')).toHaveClass(/ready/);
        await expect(hostPage.locator('.room-player-row', { hasText: 'Bob' }).locator('.player-status')).toHaveClass(/ready/);
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();

        await hostPage.locator('#ready-toggle-btn').click();

        await expect(hostPage.locator('#room-wait-scene')).toHaveAttribute('data-game-started', 'true');
        await expect(guestPage.locator('#room-wait-scene')).toHaveAttribute('data-game-started', 'true');
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();
        await expect(hostPage.locator('#player-area')).toContainText('Alice');
        await expect(guestPage.locator('#player-area')).toContainText('Bob');
        await expect(hostPage.locator('#opponents-container')).toContainText('Bob');
        await expect(guestPage.locator('#opponents-container')).toContainText('Alice');

        await hostPage.locator('#draw-btn').click();
        await expect(guestPage.locator('#game-log')).toContainText('Alice');
        await expect(guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.hand-container .card')).toHaveCount(2);
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('when a player leaves mid-game, the other player sees the abort modal and can return home', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        // Set up a 2-player game and get into the battlefield.
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');
        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');
        await guestPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();

        // Force-close any auto-shown "遊戲開始" modal so subsequent clicks reach the buttons.
        await guestPage.evaluate(() => {
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.style.display = 'none';
        });

        // Simulate the host clicking "回主選單" by directly invoking the click. Bypassing the
        // native confirm() dialog this way avoids brittle Playwright dialog ordering on slow
        // headless runs while still exercising the same back-home code path on the host.
        await hostPage.evaluate(() => {
            window.confirm = () => true;
            (document.getElementById('back-home-btn') as HTMLButtonElement).click();
        });
        await expect(hostPage.locator('#main-menu')).toBeVisible();

        // The guest should detect the host's disconnect from the synced room state and
        // automatically show the abort modal after the reconnect grace period.
        await expect(guestPage.locator('#modal-overlay')).toBeVisible({ timeout: 13_000 });
        await expect(guestPage.locator('#modal-title')).toHaveText('遊戲中斷');
        await expect(guestPage.locator('#modal-body')).toContainText('Alice');

        // Clicking the modal button should reset the guest cleanly back to the main menu.
        await guestPage.locator('#game-aborted-ok-btn').click();
        await expect(guestPage.locator('#main-menu')).toBeVisible();
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('cancelling target selection does not leak the played card to the opponent', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');
        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');
        await guestPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();
        await expect(hostPage.locator('#game-scene')).toBeVisible();
        await expect(guestPage.locator('#game-scene')).toBeVisible();

        // Dismiss the auto-shown "遊戲開始" modals on both clients.
        for (const page of [hostPage, guestPage]) {
            await page.evaluate(() => {
                const overlay = document.getElementById('modal-overlay');
                if (overlay) overlay.style.display = 'none';
            });
        }

        // Alice (host) draws her second card so she has 2 in hand.
        await hostPage.locator('#draw-btn').click();
        await expect(hostPage.locator('#player-hand .card-wrapper')).toHaveCount(2);

        const cardNames = await hostPage.locator('#player-hand .card-wrapper .card-name').allTextContents();
        const targetCardNames = ['衛兵', '神父', '男爵', '王子', '國王'];
        const targetCardIndex = cardNames.findIndex(name => targetCardNames.includes(name));

        // ~95% of the deck-shuffles deal Alice at least one target-selecting card. If this run
        // happens to deal her only Handmaid/Countess/Princess, we can't exercise the cancel flow.
        if (targetCardIndex === -1) {
            console.log(`[test] Alice's hand: ${cardNames.join(', ')} — no target-selecting card to exercise this flow; skipping verification.`);
            return;
        }

        // Bob's view of Alice before the play: 2 hidden cards in hand, empty discard pile.
        const aliceDiscardOnGuest = guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.discard-container');
        const aliceHandOnGuest = guestPage.locator('.opponent-area', { hasText: 'Alice' }).locator('.hand-container');
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);

        const aliceHandCards = hostPage.locator('#player-hand .card-wrapper');
        // First click selects the card, second click attempts to play it.
        await aliceHandCards.nth(targetCardIndex).click();
        await aliceHandCards.nth(targetCardIndex).click();

        // The target-selection modal should appear on Alice's screen.
        await expect(hostPage.locator('#modal-title')).toContainText('請選擇');

        // CRITICAL: while Alice is choosing a target, Bob must not see the card in her discard pile.
        // Wait a moment to let any out-of-order sync settle, then verify nothing leaked.
        await guestPage.waitForTimeout(500);
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);

        // Alice changes her mind and clicks 返回.
        await hostPage.locator('#modal-cancel-btn').click();

        // After cancel, Bob's view must remain unchanged — no ghost play.
        await guestPage.waitForTimeout(800);
        await expect(aliceDiscardOnGuest.locator('.card')).toHaveCount(0);
        await expect(aliceHandOnGuest.locator('.card')).toHaveCount(2);
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});

test('host can add/remove bots and start a 1-real-player + 1-bot game', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const hostPage = await hostContext.newPage();

    try {
        await openOnlineLobby(hostPage);

        // Create a room (Alice is host, 1 real player).
        await hostPage.locator('#create-room-btn').click();
        await hostPage.locator('#create-room-player-name').fill('Alice');
        await hostPage.locator('#confirm-create-room-btn').click();
        await expect(hostPage.locator('#room-wait-scene')).toBeVisible();

        // Initially 1 player, start button disabled (need >= 2 total).
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        // Host adds a bot — player count becomes 2/4.
        await hostPage.locator('.add-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('2/4');
        await expect(hostPage.locator('#room-player-list')).toContainText('電腦 A');
        // Now host can start (1 real + 1 bot >= 2).
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();

        // Host removes the bot — back to 1/4, start disabled again.
        await hostPage.locator('.remove-bot-btn').click();
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
        await expect(hostPage.locator('#ready-toggle-btn')).toBeDisabled();

        // Add the bot back and start the game.
        await hostPage.locator('.add-bot-btn').click();
        await expect(hostPage.locator('#ready-toggle-btn')).toBeEnabled();
        await hostPage.locator('#ready-toggle-btn').click();

        // Game should start — game-scene visible, bot opponent rendered.
        await expect(hostPage.locator('#game-scene')).toBeVisible({ timeout: 5000 });
        await expect(hostPage.locator('#player-area')).toContainText('Alice');
        await expect(hostPage.locator('#opponents-container')).toContainText('電腦 A');

        // Alice draws her card so the game advances normally.
        await hostPage.evaluate(() => {
            const overlay = document.getElementById('modal-overlay');
            if (overlay) overlay.style.display = 'none';
        });
        await hostPage.locator('#draw-btn').click();
        // Alice should now have 2 cards in hand.
        await expect(hostPage.locator('#player-hand .card-wrapper')).toHaveCount(2);
    } finally {
        await hostContext.close();
    }
});

test('host can kick a real player who then returns to the lobby', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    try {
        await openOnlineLobby(hostPage);
        const roomId = await createRoom(hostPage, 'Alice');

        await openOnlineLobby(guestPage);
        await joinRoom(guestPage, roomId, 'Bob');

        // Bob should be visible in both views.
        await expect(hostPage.locator('#room-player-list')).toContainText('Bob');
        await expect(guestPage.locator('#room-player-list')).toContainText('Bob');

        // Alice (host) kicks Bob.
        const kickBtn = hostPage.locator('.kick-player-btn');
        await expect(kickBtn).toBeVisible();
        await kickBtn.click();

        // Bob sees a kicked notification modal, then the lobby.
        await expect(guestPage.locator('#modal-overlay')).toBeVisible({ timeout: 5000 });
        await guestPage.locator('#kicked-ok-btn').click();
        await expect(guestPage.locator('#lobby-scene')).toBeVisible();

        // Host room now shows 1 player again.
        await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});
