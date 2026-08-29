import { expect, test, type Page } from '@playwright/test';
import { installElectronApiMock } from './electronApiMock';

const now = new Date(0).toISOString();
const project = {
  id: 941,
  name: 'Adaptive layout fixture',
  path: '/tmp/adaptive-layout-fixture',
  active: true,
  created_at: now,
  updated_at: now,
};

const worktreeSession = {
  id: 'adaptive-session',
  name: 'Adaptive pane',
  worktreePath: '/tmp/adaptive-layout-fixture/adaptive-session',
  prompt: '',
  status: 'stopped',
  createdAt: now,
  lastActivity: now,
  output: [],
  jsonMessages: [],
  isRunning: false,
  permissionMode: 'ignore',
  projectId: project.id,
  displayOrder: 0,
  isFavorite: false,
  toolType: 'none',
  archived: false,
  gitStatus: { state: 'clean', ahead: 0, behind: 0, hasUncommittedChanges: false, hasUntrackedFiles: false, filesChanged: 0 },
};

const mainRepoSession = {
  ...worktreeSession,
  id: 'adaptive-main-session',
  name: 'Adaptive layout fixture',
  worktreePath: project.path,
  isMainRepo: true,
  baseBranch: 'main',
};

function panel(sessionId: string, id: string, type: string, position: number, permanent = false) {
  return {
    id,
    sessionId,
    type,
    title: type === 'terminal' ? 'Terminal' : type === 'explorer' ? 'Explorer' : 'Logs',
    state: { isActive: type === 'logs', hasBeenViewed: true, customState: type === 'terminal' ? { isInitialized: false } : undefined },
    metadata: { createdAt: now, lastActiveAt: now, position, permanent },
  };
}

const panels = [
  panel(worktreeSession.id, 'adaptive-dock', 'terminal', 0, true),
  panel(worktreeSession.id, 'adaptive-logs', 'logs', 1),
  panel(worktreeSession.id, 'adaptive-files', 'explorer', 2, true),
  panel(mainRepoSession.id, 'adaptive-main-logs', 'logs', 0),
  panel(mainRepoSession.id, 'adaptive-main-files', 'explorer', 1, true),
];

async function installFixture(page: Page, storage: Record<string, string> = {}): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript((values: Record<string, string>) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, storage);
  await installElectronApiMock(page, {
    initialProjects: [project],
    initialSessions: [worktreeSession, mainRepoSession],
    initialPanels: panels,
    activeProjectId: project.id,
  });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
}

async function openWorktree(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Expand repository Adaptive layout fixture$/ }).click();
  await page.getByRole('button', { name: 'Adaptive pane', exact: true }).click();
  await expect(page.locator('.pane-session-content')).toBeVisible();
}

test('all worktree surfaces use container bounds, accessible resizing, and durable intent', async ({ page }, testInfo) => {
  await installFixture(page);
  await openWorktree(page);

  const inspector = page.locator('.pane-detail-panel-vertical');
  const inspectorSeparator = page.getByRole('separator', { name: 'Resize inspector' });
  await expect(inspectorSeparator).toBeVisible();
  await expect(inspectorSeparator).toHaveAttribute('aria-orientation', 'vertical');
  await expect(inspector).toHaveCSS('width', '360px');

  await inspectorSeparator.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(inspector).toHaveCSS('width', '410px');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2')))
    .toBe('{"version":2,"preferredPx":410}');

  const pointerStart = await inspectorSeparator.boundingBox();
  await page.mouse.move(pointerStart!.x + pointerStart!.width / 2, pointerStart!.y + 100);
  await page.mouse.down();
  await page.mouse.move(pointerStart!.x - 30, 2);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const stored = localStorage.getItem('pane-detail-panel-width:v2');
    return stored ? Number(JSON.parse(stored).preferredPx) : 0;
  })).toBeGreaterThan(410);
  const resizedInspectorWidth = Number.parseInt(await inspector.evaluate(element => getComputedStyle(element).width), 10);
  expect(resizedInspectorWidth).toBeGreaterThan(410);

  const committedInspector = await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'));
  const noOpStart = await inspectorSeparator.boundingBox();
  await page.mouse.click(noOpStart!.x + noOpStart!.width / 2, noOpStart!.y + 120);
  expect(await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'))).toBe(committedInspector);

  await page.mouse.move(noOpStart!.x + noOpStart!.width / 2, noOpStart!.y + 140);
  await page.mouse.down();
  await page.mouse.move(noOpStart!.x - 40, noOpStart!.y + 140);
  await inspectorSeparator.dispatchEvent('pointercancel', { pointerId: 1, clientX: noOpStart!.x - 40, clientY: noOpStart!.y + 140 });
  await page.mouse.up();
  await expect(inspector).toHaveCSS('width', `${resizedInspectorWidth}px`);
  expect(await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'))).toBe(committedInspector);

  const lostCaptureStart = await inspectorSeparator.boundingBox();
  await page.mouse.move(lostCaptureStart!.x + lostCaptureStart!.width / 2, lostCaptureStart!.y + 160);
  await page.mouse.down();
  await page.mouse.move(lostCaptureStart!.x - 25, lostCaptureStart!.y + 160);
  await inspectorSeparator.evaluate(element => {
    if (element.hasPointerCapture(1)) element.releasePointerCapture(1);
  });
  await page.mouse.up();
  await expect(inspector).toHaveCSS('width', `${resizedInspectorWidth}px`);
  expect(await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'))).toBe(committedInspector);

  const center = page.locator('.pane-center-column');
  const centerHeight = (await center.boundingBox())!.height;
  await page.getByRole('button', { name: 'Expand terminal', exact: true }).click();
  const terminalDock = page.locator('.pane-terminal-dock');
  const terminalBox = await terminalDock.boundingBox();
  expect(terminalBox).not.toBeNull();
  expect(terminalBox!.height).toBeCloseTo(Math.round(centerHeight * 0.32), -1);

  const terminalSeparator = page.getByRole('separator', { name: 'Resize terminal' });
  await expect(terminalSeparator).toBeVisible();
  await expect(terminalSeparator).toHaveAttribute('aria-valuemin', '100');
  const separatorBox = await terminalSeparator.boundingBox();
  expect(separatorBox!.height).toBeGreaterThanOrEqual(8);
  expect(separatorBox!.width).toBeGreaterThanOrEqual((await terminalDock.boundingBox())!.width - 1);

  await terminalSeparator.focus();
  await page.keyboard.press('ArrowUp');
  const committedTerminal = await page.evaluate(() => localStorage.getItem('pane-bottom-terminal-height:v2'));
  expect(committedTerminal).toMatch(/^\{"version":2,"preferredPx":\d+\}$/);
  const expandedHeight = (await terminalDock.boundingBox())!.height;
  await page.getByRole('button', { name: 'Collapse terminal', exact: true }).click();
  await expect(terminalSeparator).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand terminal', exact: true }).click();
  await expect.poll(async () => (await terminalDock.boundingBox())!.height).toBe(expandedHeight);

  const preferredBeforeConstraint = await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'));
  await page.locator('.pane-session-content').evaluate(element => {
    element.setAttribute('style', 'flex: 0 0 400px; width: 400px');
  });
  await expect(inspector).toHaveCSS('width', '0px');
  await expect(inspector.locator('.pane-detail-panel-inner')).toHaveAttribute('inert', '');
  await expect(inspectorSeparator).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'))).toBe(preferredBeforeConstraint);
  await page.locator('.pane-session-content').evaluate(element => element.removeAttribute('style'));
  await expect(inspector).toHaveCSS('width', `${resizedInspectorWidth}px`);

  await page.getByRole('button', { name: 'Swap terminal and detail panel positions', exact: true }).click();
  const rightTerminalSeparator = page.getByRole('separator', { name: 'Resize terminal' });
  const bottomDetailSeparator = page.getByRole('separator', { name: 'Resize detail panel' });
  await expect(rightTerminalSeparator).toHaveAttribute('aria-orientation', 'vertical');
  await expect(bottomDetailSeparator).toHaveAttribute('aria-orientation', 'horizontal');
  await bottomDetailSeparator.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pane-bottom-detail-height:v2')))
    .toMatch(/^\{"version":2,"preferredPx":\d+\}$/);
  const committedBottomDetail = await page.evaluate(() => localStorage.getItem('pane-bottom-detail-height:v2'));
  const horizontalDetail = page.locator('.pane-detail-panel-horizontal');
  await center.evaluate(element => element.setAttribute('style', 'flex: 0 0 220px; height: 220px'));
  await expect(horizontalDetail).toHaveCSS('height', '32px');
  await expect(bottomDetailSeparator).toHaveCount(0);
  await expect(horizontalDetail.getByRole('region', { name: 'Commit history' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pane-bottom-detail-height:v2'))).toBe(committedBottomDetail);
  await center.evaluate(element => element.removeAttribute('style'));
  await expect(bottomDetailSeparator).toBeVisible();

  const shot = testInfo.outputPath('adaptive-panel-separators.png');
  await page.screenshot({ path: shot });
  await testInfo.attach('adaptive-panel-separators.png', { path: shot, contentType: 'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('an observed active terminal resize debounces through the existing xterm refit path', async ({ page }) => {
  await installFixture(page);
  await openWorktree(page);

  await page.evaluate(() => {
    // SAFETY: This test exclusively owns the optional recorder property for this page.
    const testWindow = window as typeof window & {
      __terminalResizeCalls?: Array<{ panelId: string; cols: number; rows: number }>;
    };
    const originalInvoke = window.electronAPI.invoke.bind(window.electronAPI);
    testWindow.__terminalResizeCalls = [];
    // SAFETY: The wrapper preserves invoke's arguments and return value and only records one channel.
    window.electronAPI.invoke = ((channel: string, ...args: unknown[]) => {
      if (channel === 'terminal:resize') {
        testWindow.__terminalResizeCalls?.push({
          panelId: String(args[0]),
          cols: Number(args[1]),
          rows: Number(args[2]),
        });
      }
      return originalInvoke(channel, ...args);
    }) as typeof window.electronAPI.invoke;
  });

  await page.getByRole('button', { name: 'Expand terminal', exact: true }).click();
  const terminalDock = page.locator('.pane-terminal-dock');
  await expect(terminalDock.locator('.xterm')).toBeVisible();
  await expect(terminalDock.locator('.pane-terminal-shell-body')).not.toHaveAttribute('inert', '');

  // Let mount and activation fitting settle so only the observed container change is recorded.
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    // SAFETY: The recorder was installed by this test earlier in the same page lifetime.
    const testWindow = window as typeof window & { __terminalResizeCalls?: unknown[] };
    testWindow.__terminalResizeCalls = [];
  });

  const initialHeight = (await terminalDock.boundingBox())!.height;
  const terminalSeparator = page.getByRole('separator', { name: 'Resize terminal' });
  await terminalSeparator.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await terminalDock.boundingBox())!.height).toBe(initialHeight + 20);

  await expect.poll(() => page.evaluate(() => {
    // SAFETY: The recorder was installed by this test earlier in the same page lifetime.
    const testWindow = window as typeof window & {
      __terminalResizeCalls?: Array<{ panelId: string; cols: number; rows: number }>;
    };
    return testWindow.__terminalResizeCalls?.length ?? 0;
  })).toBe(1);
  await page.waitForTimeout(200);
  const resizeCalls = await page.evaluate(() => {
    // SAFETY: The recorder was installed by this test earlier in the same page lifetime.
    const testWindow = window as typeof window & {
      __terminalResizeCalls?: Array<{ panelId: string; cols: number; rows: number }>;
    };
    return testWindow.__terminalResizeCalls ?? [];
  });
  expect(resizeCalls).toHaveLength(1);
  expect(resizeCalls[0]).toMatchObject({ panelId: 'adaptive-dock' });
  expect(resizeCalls[0].cols).toBeGreaterThanOrEqual(2);
  expect(resizeCalls[0].rows).toBeGreaterThanOrEqual(1);
});

test('worktree and main-repository inspectors restore separate v2 preferences', async ({ page }) => {
  await installFixture(page, {
    'pane-detail-panel-width:v2': '{"version":2,"preferredPx":440}',
    'pane-project-detail-panel-width:v2': '{"version":2,"preferredPx":520}',
  });
  await openWorktree(page);
  await expect(page.locator('.pane-detail-panel-vertical')).toHaveCSS('width', '440px');

  await page.getByRole('button', { name: `Repository actions for ${project.name}`, exact: true }).click();
  await page.getByText('Open session on main', { exact: true }).click();
  const projectInspector = page.locator('.pane-detail-panel-vertical');
  await expect(projectInspector).toHaveCSS('width', '520px');
  await expect(page.getByRole('separator', { name: 'Resize main repository inspector' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pane-detail-panel-width:v2'))).toBe('{"version":2,"preferredPx":440}');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: `Repository actions for ${project.name}`, exact: true }).click();
  await page.getByText('Open session on main', { exact: true }).click();
  await expect(page.locator('.pane-detail-panel-vertical')).toHaveCSS('width', '520px');
});
