import { describe, expect, it, vi } from 'vitest';
import { WorkspaceJournal } from './workspaceJournal';

describe('WorkspaceJournal', () => {
  it('appends gapless entries and filters reads', () => {
    let now = 1000;
    const journal = new WorkspaceJournal({ now: () => now });
    journal.append({ kind: 'pane.created', paneId: 'one', paneName: 'One', source: 'session' });
    now += 1;
    journal.append({ kind: 'agent.busy', paneId: 'one', paneName: 'One', panelId: 'p1', source: 'agent' });
    journal.append({ kind: 'pane.created', paneId: 'two', paneName: 'Two', source: 'session' });

    expect(journal.readAfter(0, { paneIds: ['one'] }).entries.map(entry => entry.gen)).toEqual([1, 2]);
    expect(journal.generation).toBe(3);
  });

  it('parks a wait and resolves it on a matching append', async () => {
    const journal = new WorkspaceJournal();
    const waiting = journal.waitAfter(0, { kinds: ['agent.ready'] }, 1000);
    journal.append({ kind: 'agent.busy', paneId: 'one', paneName: 'One', source: 'agent' });
    journal.append({ kind: 'agent.ready', paneId: 'one', paneName: 'One', source: 'agent' });

    await expect(waiting).resolves.toMatchObject({
      timedOut: false,
      entries: [{ kind: 'agent.ready', gen: 2 }],
    });
  });

  it('reports ring eviction instead of silently losing entries', () => {
    const journal = new WorkspaceJournal({ capacity: 2 });
    for (const paneId of ['one', 'two', 'three']) {
      journal.append({ kind: 'pane.created', paneId, paneName: paneId, source: 'session' });
    }

    expect(journal.readAfter(0)).toMatchObject({
      dropped: 1,
      entries: [{ gen: 2 }, { gen: 3 }],
    });
  });

  it('returns a resumable generation when a burst exceeds the read limit', () => {
    const journal = new WorkspaceJournal();
    for (const paneId of ['one', 'two', 'three']) {
      journal.append({ kind: 'pane.created', paneId, paneName: paneId, source: 'session' });
    }

    const first = journal.readAfter(0, {}, 2);
    expect(first).toMatchObject({ generation: 2, entries: [{ gen: 1 }, { gen: 2 }] });
    expect(journal.readAfter(first.generation)).toMatchObject({
      generation: 3,
      entries: [{ gen: 3 }],
    });
  });

  it('turns event fanout transitions into named journal entries', () => {
    let now = Date.parse('2026-08-26T10:00:10.000Z');
    const journal = new WorkspaceJournal({
      now: () => now,
      resolvePanel: panelId => ({
        panelId,
        paneId: 'pane-1',
        agentType: 'codex',
        lastActivityAt: '2026-08-26T10:00:00.000Z',
        heldInput: 'ship it',
      }),
    });
    journal.send('session:created', { id: 'pane-1', name: 'Monitor', worktreePath: '/repo/monitor' });
    journal.send('panel:agentStatus', { panelId: 'panel-1', sessionId: 'pane-1', state: 'working', reason: 'spinner' });
    now += 10_000;
    journal.send('panel:agentStatus', { panelId: 'panel-1', sessionId: 'pane-1', state: 'idle', reason: 'prompt' });
    journal.send('session:deleted', { id: 'pane-1' });

    const entries = journal.readAfter(0, { includeHeldInput: true }).entries;
    expect(entries.map(entry => entry.kind)).toEqual(['pane.created', 'agent.busy', 'agent.ready', 'pane.gone']);
    expect(entries[2]).toMatchObject({ paneName: 'Monitor', settledMs: 20_000, heldInput: 'ship it' });
  });

  it('times out without inventing an entry', async () => {
    vi.useFakeTimers();
    const journal = new WorkspaceJournal();
    const waiting = journal.waitAfter(0, {}, 50);
    await vi.advanceTimersByTimeAsync(50);
    await expect(waiting).resolves.toMatchObject({ timedOut: true, entries: [] });
    vi.useRealTimers();
  });
});
