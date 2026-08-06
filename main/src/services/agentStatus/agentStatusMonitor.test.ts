import { describe, expect, it } from 'vitest';
import { AgentStatusMonitor } from './agentStatusMonitor';
import type { AgentDetectionResult } from '../../../../shared/types/agentStatus';

const detection = (partial: Partial<AgentDetectionResult>): AgentDetectionResult => ({
  state: 'idle',
  visibleBlocker: false,
  visibleWorking: false,
  visibleIdle: false,
  skipStateUpdate: false,
  matchedRuleId: null,
  ...partial,
});

const opts = {
  workingActivityWindowMs: 600,
  workingToIdleHoldMs: 700,
  startupGraceMs: 3000,
};

describe('AgentStatusMonitor', () => {
  it('publishes working while PTY bytes are flowing', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    m.noteActivity('p', 10);
    expect(m.update('p', detection({ state: 'idle' }), 20)).toBe('working');
    expect(m.getState('p')).toBe('working');
  });

  it('settles to idle after activity stops and the hold elapses (past startup grace)', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    m.noteActivity('p', 4000);
    expect(m.update('p', detection({ state: 'idle' }), 4010)).toBe('working');
    // Activity window lapses (no new bytes) -> idle candidate begins.
    expect(m.update('p', detection({ state: 'idle' }), 4800)).toBeNull(); // holding
    // Hold elapses -> idle published.
    expect(m.update('p', detection({ state: 'idle' }), 5600)).toBe('idle');
  });

  it('publishes blocked immediately, overriding recent activity', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    m.noteActivity('p', 4000);
    m.update('p', detection({ state: 'idle' }), 4010); // working
    const changed = m.update('p', detection({ state: 'blocked', visibleBlocker: true }), 4020);
    expect(changed).toBe('blocked');
  });

  it('holds the prior state on skipStateUpdate detections', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    m.noteActivity('p', 4000);
    m.update('p', detection({ state: 'idle' }), 4010); // working
    expect(m.update('p', detection({ state: 'unknown', skipStateUpdate: true }), 4020)).toBeNull();
    expect(m.getState('p')).toBe('working');
  });

  it('suppresses premature idle during the startup grace window', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    // No activity, idle detection, but still inside 3s grace -> not idle yet.
    expect(m.update('p', detection({ state: 'idle' }), 500)).toBe('working');
    expect(m.getState('p')).toBe('working');
  });

  it('emits only on change', () => {
    const m = new AgentStatusMonitor(opts);
    m.register('p', 0);
    m.noteActivity('p', 4000);
    expect(m.update('p', detection({ state: 'working' }), 4010)).toBe('working');
    expect(m.update('p', detection({ state: 'working' }), 4020)).toBeNull();
  });

  it('ignores unregistered panels', () => {
    const m = new AgentStatusMonitor(opts);
    expect(m.update('ghost', detection({ state: 'working' }), 0)).toBeNull();
    expect(m.getState('ghost')).toBeUndefined();
  });
});
