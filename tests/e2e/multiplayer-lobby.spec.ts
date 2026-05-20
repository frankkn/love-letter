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
    } finally {
        await guestContext.close();
        await hostContext.close();
    }
});
