import { expect, type Browser, type Page, test } from '@playwright/test';

type TestPlayer = {
    name: string;
    page: Page;
    close: () => Promise<void>;
};

async function createIsolatedPlayer(browser: Browser, name: string): Promise<TestPlayer> {
    const context = await browser.newContext();
    const page = await context.newPage();

    // The app still uses native prompt()/alert() in a few lobby paths.
    // Keep the handler installed before any click that may open a dialog.
    page.on('dialog', async dialog => {
        if (dialog.type() === 'prompt') {
            await dialog.accept(name);
            return;
        }

        await dialog.accept();
    });

    return {
        name,
        page,
        close: () => context.close()
    };
}

async function openOnlineLobby(page: Page) {
    await page.goto('/');
    await page.locator('#start-game-btn').click();
    await page.locator('#online-mode-btn').click();
    await expect(page.locator('#lobby-scene')).toBeVisible();
}

async function createRoom(hostPage: Page, hostName: string): Promise<string> {
    await openOnlineLobby(hostPage);
    await hostPage.locator('#create-room-btn').click();
    await hostPage.locator('#create-room-player-name').fill(hostName);
    await hostPage.locator('#confirm-create-room-btn').click();

    await expect(hostPage.locator('#room-wait-scene')).toBeVisible();
    await expect(hostPage.locator('#room-player-count')).toHaveText('1/4');
    await expect(hostPage.locator('#room-player-list')).toContainText(hostName);

    const roomId = (await hostPage.locator('#current-room-id').textContent())?.trim();
    expect(roomId, 'room id should be rendered after room creation').toBeTruthy();
    return roomId!;
}

async function joinRoom(player: TestPlayer, roomId: string) {
    await openOnlineLobby(player.page);

    // Prefer the actual lobby list button so this test exercises Colyseus LobbyRoom sync.
    const joinButton = player.page.locator(`.join-room-btn[data-room-id="${roomId}"]`);
    await expect(joinButton).toBeVisible();
    await joinButton.click();

    await expect(player.page.locator('#room-wait-scene')).toBeVisible();
    await expect(player.page.locator('#room-player-list')).toContainText(player.name);
}

async function readyPlayer(player: TestPlayer) {
    await player.page.locator('#ready-toggle-btn').click();
    await expect(
        player.page.locator('.room-player-row', { hasText: player.name }).locator('.player-status')
    ).toHaveClass(/ready/);
}

async function expectGameSceneReady(player: TestPlayer, allNames: string[]) {
    await expect(player.page.locator('#room-wait-scene')).toHaveAttribute('data-game-started', 'true');
    await expect(player.page.locator('#game-scene')).toBeVisible();
    await expect(player.page.locator('#turn-indicator')).not.toHaveText('');
    await expect(player.page.locator('#player-area')).toContainText(player.name);

    for (const name of allNames.filter(candidate => candidate !== player.name)) {
        await expect(player.page.locator('#opponents-container')).toContainText(name);
    }
}

test('four players can create, join, ready, and enter the online battlefield', async ({ browser }) => {
    const players = await Promise.all([
        createIsolatedPlayer(browser, '房主爸爸'),
        createIsolatedPlayer(browser, '玩家B'),
        createIsolatedPlayer(browser, '玩家C'),
        createIsolatedPlayer(browser, '玩家D')
    ]);

    const [host, playerB, playerC, playerD] = players;

    try {
        const roomId = await createRoom(host.page, host.name);
        await expect(host.page.locator('#ready-toggle-btn')).toBeDisabled();

        // Join sequentially to keep lobby list updates deterministic and easy to diagnose.
        for (const player of [playerB, playerC, playerD]) {
            await joinRoom(player, roomId);
        }

        for (const page of players.map(player => player.page)) {
            await expect(page.locator('#room-player-count')).toHaveText('4/4');
            for (const name of players.map(player => player.name)) {
                await expect(page.locator('#room-player-list')).toContainText(name);
            }
        }

        // Guests must ready up before the host can start the room.
        await readyPlayer(playerB);
        await readyPlayer(playerC);
        await readyPlayer(playerD);
        await expect(host.page.locator('#ready-toggle-btn')).toBeEnabled();
        await expect(host.page.locator('#ready-toggle-btn')).toContainText('開始遊戲');

        await host.page.locator('#ready-toggle-btn').click();

        for (const player of players) {
            await expectGameSceneReady(player, players.map(candidate => candidate.name));
        }
    } finally {
        await Promise.all(players.map(player => player.close()));
    }
});
