import { expect, test, type Page } from '@playwright/test';
import { installElectronApiMock } from './electronApiMock';

const inviteUrl = 'https://discord.gg/BdMyubeAZn';

async function openedExternalUrls(page: Page): Promise<string[]> {
  // SAFETY: installElectronApiMock defines this test-only API before navigation.
  return page.evaluate(() => (
    window as typeof window & {
      __paneTestElectronMock: { getOpenedExternalUrls: () => string[] };
    }
  ).__paneTestElectronMock.getOpenedExternalUrls());
}

test('sidebar Discord action opens the community invite', async ({ page }) => {
  await installElectronApiMock(page, {
    initialPreferences: { hide_discord: 'true', hide_welcome: 'true' },
  });
  await page.goto('/');

  const feedback = page.getByRole('button', { name: 'Feedback', exact: true });
  const discord = page.getByRole('button', { name: 'Discord', exact: true });
  await expect(feedback).toBeVisible();
  await expect(discord).toBeVisible();
  expect(await feedback.evaluate((element) => element.nextElementSibling?.textContent)).toContain('Discord');
  await discord.click();

  await expect.poll(() => openedExternalUrls(page)).toContain(inviteUrl);
});

test('home Discord banner persists dismissal', async ({ page }) => {
  await installElectronApiMock(page, {
    initialPreferences: {
      hide_discord: 'false',
      hide_welcome: 'true',
      welcome_shown: 'true',
    },
  });
  await page.goto('/');

  const banner = page.getByRole('region', { name: 'Pane Discord community' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Dismiss Discord invitation' }).click();
  await expect(banner).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => {
    // SAFETY: installElectronApiMock defines this test-only API before navigation.
    return (
    window as typeof window & {
      __paneTestElectronMock: { getPreferences: () => Record<string, string> };
    }
    ).__paneTestElectronMock.getPreferences().hide_discord;
  })).toBe('true');
});

test('home Discord join opens the invite and dismisses the banner', async ({ page }) => {
  await installElectronApiMock(page, {
    initialPreferences: {
      hide_discord: 'false',
      hide_welcome: 'true',
      welcome_shown: 'true',
    },
  });
  await page.goto('/');

  const banner = page.getByRole('region', { name: 'Pane Discord community' });
  await banner.getByRole('button', { name: 'Join', exact: true }).click();

  await expect(banner).toHaveCount(0);
  await expect.poll(() => openedExternalUrls(page)).toContain(inviteUrl);
});
