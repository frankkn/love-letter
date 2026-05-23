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

        // The guest should detect the host's disconnect from the synced room state and
        // automatically show the abort modal.
        await expect(guestPage.locator('#modal-overlay')).toBeVisible();
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
