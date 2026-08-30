import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaneCommandRegistry } from '../daemon/commandRegistry';
import type { AppServices } from './types';
import { registerSessionHandlers } from './session';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-restore-test-'));
  tempDirs.push(dir);
  return dir;
}

function createHarness(options: { worktreeExists: boolean; createWorktree?: ReturnType<typeof vi.fn> }) {
  const worktreeDir = path.join(makeTempDir(), 'issue-252');
  if (options.worktreeExists) {
    fs.mkdirSync(worktreeDir, { recursive: true });
  }
  const project = { id: 1, name: 'Pane', path: '/repo/pane', worktree_folder: null };
  const dbSession = {
    id: 'session-1',
    name: 'issue-252',
    worktree_name: 'issue-252',
    worktree_path: worktreeDir,
    project_id: 1,
    archived: 1,
    is_main_repo: false,
    base_branch: 'main',
  };
  const createWorktree = options.createWorktree ?? vi.fn(async () => ({ worktreePath: worktreeDir, baseCommit: 'abc', baseBranch: 'main' }));
  const databaseService = {
    getSession: vi.fn(() => dbSession),
    getProject: vi.fn(() => project),
    restoreSession: vi.fn(() => true),
    updateSession: vi.fn(),
  };
  const sessionManager = {
    getProjectContextByProjectId: vi.fn(() => ({ project, pathResolver: {}, commandRunner: {} })),
    getAllSessions: vi.fn(() => []),
    emit: vi.fn(),
  };
  // SAFETY: This test fixture intentionally supplies the minimal structural substitute exercised by the unit.
  const services = {
    databaseService,
    sessionManager,
    worktreeManager: { createWorktree },
    gitStatusManager: { getCachedStatus: vi.fn() },
    taskQueue: {},
    claudeCodeManager: {},
    worktreeNameGenerator: {},
    archiveProgressManager: undefined,
    spotlightManager: {},
    runCommandManager: {},
  } as AppServices;
  const registry = new PaneCommandRegistry();
  // SAFETY: test fixture supplies the minimal structural substitute exercised by the handler.
  registerSessionHandlers({ handle: vi.fn() } as never, services, registry);
  return { registry, databaseService, sessionManager, createWorktree, worktreeDir };
}

describe('sessions:restore', () => {
  it('recreates the worktree when archiving removed it, then un-archives', async () => {
    const h = createHarness({ worktreeExists: false });
    const result = await h.registry.invoke('sessions:restore', ['session-1']);
    expect(result).toEqual({ success: true });
    expect(h.createWorktree).toHaveBeenCalledWith('/repo/pane', 'issue-252', undefined, 'main', undefined, expect.anything(), expect.anything());
    expect(h.databaseService.restoreSession).toHaveBeenCalledWith('session-1');
    expect(h.sessionManager.emit).toHaveBeenCalledWith('sessions-loaded', []);
  });

  it('skips worktree creation when the directory still exists', async () => {
    const h = createHarness({ worktreeExists: true });
    const result = await h.registry.invoke('sessions:restore', ['session-1']);
    expect(result).toEqual({ success: true });
    expect(h.createWorktree).not.toHaveBeenCalled();
    expect(h.databaseService.restoreSession).toHaveBeenCalledWith('session-1');
  });

  it('leaves the session archived and reports the error when worktree creation fails', async () => {
    const h = createHarness({
      worktreeExists: false,
      createWorktree: vi.fn(async () => { throw new Error("Base branch 'main' does not exist"); }),
    });
    const result = await h.registry.invoke('sessions:restore', ['session-1']);
    expect(result).toEqual({ success: false, error: "Failed to recreate worktree for session: Base branch 'main' does not exist" });
    expect(h.databaseService.restoreSession).not.toHaveBeenCalled();
  });

  it('updates worktree_path when the recreated worktree lands elsewhere', async () => {
    const h = createHarness({
      worktreeExists: false,
      createWorktree: vi.fn(async () => ({ worktreePath: '/elsewhere/issue-252', baseCommit: 'abc', baseBranch: 'main' })),
    });
    await h.registry.invoke('sessions:restore', ['session-1']);
    expect(h.databaseService.updateSession).toHaveBeenCalledWith('session-1', { worktree_path: '/elsewhere/issue-252' });
  });
});
