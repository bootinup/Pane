import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from './configManager';

describe('ConfigManager appearance persistence', () => {
  let paneDir: string;
  let configPath: string;

  beforeEach(async () => {
    paneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pane-appearance-'));
    process.env.PANE_DIR = paneDir;
    configPath = path.join(paneDir, 'config.json');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    delete process.env.PANE_DIR;
    await fs.rm(paneDir, { recursive: true, force: true });
  });

  it('writes new-install defaults', async () => {
    const manager = new ConfigManager();
    await manager.initialize();
    expect(manager.getConfig()).toMatchObject({
      appearanceMode: 'system', theme: 'light-rounded', systemLightTheme: 'light-rounded', systemDarkTheme: 'dark',
    });
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toMatchObject({
      appearanceMode: 'system', theme: 'light-rounded', systemLightTheme: 'light-rounded', systemDarkTheme: 'dark',
    });
  });

  it('migrates a legacy theme once', async () => {
    await fs.writeFile(configPath, JSON.stringify({ theme: 'forge' }));
    const manager = new ConfigManager();
    await manager.initialize();
    expect(manager.getConfig()).toMatchObject({ appearanceMode: 'fixed', theme: 'forge', systemLightTheme: 'light-rounded', systemDarkTheme: 'forge' });
    const first = await fs.stat(configPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.initialize();
    expect((await fs.stat(configPath)).mtimeMs).toBe(first.mtimeMs);
  });

  it('repairs corrupt slots, preserves valid fields, and logs a diagnostic', async () => {
    await fs.writeFile(configPath, JSON.stringify({ appearanceMode: 'system', theme: 'abyss', systemLightTheme: 'dark', systemDarkTheme: 'forge' }));
    const manager = new ConfigManager();
    await manager.initialize();
    expect(manager.getConfig()).toMatchObject({ theme: 'abyss', systemLightTheme: 'light-rounded', systemDarkTheme: 'forge' });
    expect(console.error).toHaveBeenCalledWith('[ConfigManager] appearance: invalid systemLightTheme; restored light-rounded');
    expect(JSON.parse(await fs.readFile(configPath, 'utf8')).systemLightTheme).toBe('light-rounded');
  });

  it('serializes concurrent updates without losing either change', async () => {
    const manager = new ConfigManager();
    await manager.initialize();
    await Promise.all([manager.updateConfig({ theme: 'forge' }), manager.updateConfig({ highContrast: true })]);
    expect(JSON.parse(await fs.readFile(configPath, 'utf8'))).toMatchObject({ theme: 'forge', highContrast: true });
  });

  it('serializes reloads behind in-flight updates', async () => {
    const manager = new ConfigManager();
    await manager.initialize();
    const realRename = fs.rename.bind(fs);
    let releaseRename: (() => void) | undefined;
    const renameBlocked = new Promise<void>((resolve) => { releaseRename = resolve; });
    let markRenameStarted: (() => void) | undefined;
    const renameStarted = new Promise<void>((resolve) => { markRenameStarted = resolve; });
    const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      markRenameStarted?.();
      await renameBlocked;
      await realRename(from, to);
    });

    const update = manager.updateConfig({ theme: 'forge' });
    await renameStarted;
    const reload = manager.reloadFromDisk();
    releaseRename?.();
    await Promise.all([update, reload]);

    expect(manager.getConfig().theme).toBe('forge');
    expect(JSON.parse(await fs.readFile(configPath, 'utf8')).theme).toBe('forge');
    rename.mockRestore();
  });

  it('rejects a mismatched slot without changing memory or disk', async () => {
    const manager = new ConfigManager();
    await manager.initialize();
    const before = await fs.readFile(configPath, 'utf8');
    // SAFETY: Deliberately bypasses the compile-time slot type to exercise the runtime persistence boundary.
    await expect(manager.updateConfig({ systemDarkTheme: 'folio' as never })).rejects.toThrow('systemDarkTheme must be a dark palette');
    expect(manager.getConfig().systemDarkTheme).toBe('dark');
    expect(await fs.readFile(configPath, 'utf8')).toBe(before);
  });

  it('keeps memory and disk unchanged when the atomic rename fails', async () => {
    const manager = new ConfigManager();
    await manager.initialize();
    const before = await fs.readFile(configPath, 'utf8');
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(manager.updateConfig({ theme: 'forge' })).rejects.toThrow('rename failed');
    expect(manager.getConfig().theme).toBe('light-rounded');
    expect(await fs.readFile(configPath, 'utf8')).toBe(before);
    rename.mockRestore();
  });
});
