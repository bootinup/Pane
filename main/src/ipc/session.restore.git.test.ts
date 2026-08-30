import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaneCommandRegistry } from '../daemon/commandRegistry';
import { WorktreeManager } from '../services/worktreeManager';
import { CommandRunner } from '../utils/commandRunner';
import { PathResolver } from '../utils/pathResolver';
import type { AppServices } from './types';
import { registerSessionHandlers } from './session';

// Real-git proof of the archive → restore cycle. Uses a temp repo by default;
// set PANE_RESTORE_PROOF_REPO to an existing clone (e.g. of a throwaway
// GitHub repo) to run against it instead.
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function resolveRepo(): string {
  const external = process.env.PANE_RESTORE_PROOF_REPO;
  if (external) return external;
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pane-restore-git-'));
  tempDirs.push(parent);
  const repo = path.join(parent, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Pane Test');
  git(repo, 'config', 'user.email', 'pane-test@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), '# proof\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  return repo;
}

describe('sessions:restore against a real git repository', () => {
  it('recreates the worktree removed by archiving and the branch keeps its commits', async () => {
    const repoPath = resolveRepo();
    const worktreeName = `restore-proof-${Date.now()}`;
    const project = { id: 1, name: 'proof', path: repoPath, worktree_folder: null };
    const pathResolver = new PathResolver({ path: repoPath });
    const commandRunner = new CommandRunner({ path: repoPath });
    const worktreeManager = new WorktreeManager();

    // 1. Create the workspace the way session creation does.
    const created = await worktreeManager.createWorktree(repoPath, worktreeName, undefined, 'main', undefined, pathResolver, commandRunner);
    expect(fs.existsSync(created.worktreePath)).toBe(true);
    fs.writeFileSync(path.join(created.worktreePath, 'work.txt'), 'done in session\n');
    git(created.worktreePath, 'add', '-A');
    git(created.worktreePath, 'commit', '-qm', 'session work');
    const sessionCommit = git(created.worktreePath, 'rev-parse', 'HEAD');

    // 2. Archive: exactly what the archive cleanup callback does.
    await worktreeManager.removeWorktree(repoPath, worktreeName, undefined, new Date(), pathResolver, commandRunner);
    expect(fs.existsSync(created.worktreePath)).toBe(false);
    expect(git(repoPath, 'worktree', 'list')).not.toContain(created.worktreePath);

    // 3. Restore through the real IPC handler.
    const dbSession = {
      id: 'session-1',
      name: worktreeName,
      worktree_name: worktreeName,
      worktree_path: created.worktreePath,
      project_id: 1,
      archived: 1,
      is_main_repo: false,
      base_branch: 'main',
    };
    const databaseService = {
      getSession: vi.fn(() => dbSession),
      getProject: vi.fn(() => project),
      restoreSession: vi.fn(() => { dbSession.archived = 0; return true; }),
      updateSession: vi.fn(),
    };
    // SAFETY: This test fixture intentionally supplies the minimal structural substitute exercised by the unit.
    const services = {
      databaseService,
      sessionManager: {
        getProjectContextByProjectId: vi.fn(() => ({ project, pathResolver, commandRunner })),
        getAllSessions: vi.fn(() => []),
        emit: vi.fn(),
      },
      worktreeManager,
      gitStatusManager: { getCachedStatus: vi.fn() },
      taskQueue: {},
      claudeCodeManager: {},
      worktreeNameGenerator: {},
      archiveProgressManager: undefined,
      spotlightManager: {},
      runCommandManager: {},
    } as AppServices;
    const registry = new PaneCommandRegistry();
    // SAFETY: This test fixture intentionally supplies the minimal structural substitute exercised by the unit.
    registerSessionHandlers({ handle: vi.fn() } as never, services, registry);

    const result = await registry.invoke('sessions:restore', ['session-1']);
    expect(result).toEqual({ success: true });
    expect(dbSession.archived).toBe(0);

    // 4. The cwd a Claude Code panel would spawn in exists again, on the same branch, with the session's commit.
    expect(fs.existsSync(created.worktreePath)).toBe(true);
    expect(git(repoPath, 'worktree', 'list')).toContain(created.worktreePath);
    expect(git(created.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(worktreeName);
    expect(git(created.worktreePath, 'rev-parse', 'HEAD')).toBe(sessionCommit);
    expect(fs.readFileSync(path.join(created.worktreePath, 'work.txt'), 'utf8')).toBe('done in session\n');
    expect(databaseService.updateSession).not.toHaveBeenCalled();

    // Optional: when pointed at a GitHub clone, push the restored branch as external evidence.
    if (process.env.PANE_RESTORE_PROOF_REPO) {
      git(created.worktreePath, 'push', '-q', '-u', 'origin', worktreeName);
      expect(git(repoPath, 'ls-remote', '--heads', 'origin', worktreeName)).toContain(sessionCommit);
    } else {
      await worktreeManager.removeWorktree(repoPath, worktreeName, undefined, new Date(), pathResolver, commandRunner);
    }
  });
});
