/**
 * Continuous agent-status state machine.
 *
 * Owns per-panel status trackers and arbitrates a published {@link AgentState}
 * from three signals: the screen/OSC {@link AgentDetectionResult}, recent PTY
 * byte-activity (the "working" authority), and elapsed time. It is deliberately
 * timer-free and clock-injectable — the caller re-evaluates on PTY output and on
 * a short poll, so debounce/grace windows resolve purely from timestamps, which
 * keeps the machine fully unit-testable.
 *
 * Arbitration precedence: a visible blocker wins immediately; otherwise recent
 * activity (or a working detection) means working; otherwise idle — but idle is
 * held briefly after working (to ride out spinner gaps) and suppressed during a
 * short startup grace so a booting agent doesn't flash "done".
 */

import type { AgentDetectionResult, AgentState } from '../../../../shared/types/agentStatus';

export interface AgentStatusMonitorOptions {
  /** Bytes seen within this window count as "working". */
  workingActivityWindowMs?: number;
  /** How long to hold `working` after activity stops before going idle. */
  workingToIdleHoldMs?: number;
  /** Idle is suppressed for this long after a panel registers. */
  startupGraceMs?: number;
}

interface PanelTracker {
  startedAt: number;
  lastActivityAt: number | undefined;
  idleSince: number | undefined;
  published: AgentState | undefined;
}

const DEFAULTS: Required<AgentStatusMonitorOptions> = {
  workingActivityWindowMs: 600,
  workingToIdleHoldMs: 700,
  startupGraceMs: 3000,
};

export class AgentStatusMonitor {
  private readonly trackers = new Map<string, PanelTracker>();
  private readonly options: Required<AgentStatusMonitorOptions>;

  constructor(options: AgentStatusMonitorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Begin tracking an agent panel. Only registered panels ever emit. */
  register(panelId: string, now: number): void {
    this.trackers.set(panelId, {
      startedAt: now,
      lastActivityAt: undefined,
      idleSince: undefined,
      published: undefined,
    });
  }

  unregister(panelId: string): void {
    this.trackers.delete(panelId);
  }

  isTracked(panelId: string): boolean {
    return this.trackers.has(panelId);
  }

  /** Number of panels currently tracked. */
  get size(): number {
    return this.trackers.size;
  }

  /** Record that PTY bytes were produced for a panel at `now`. */
  noteActivity(panelId: string, now: number): void {
    const tracker = this.trackers.get(panelId);
    if (tracker) tracker.lastActivityAt = now;
  }

  getState(panelId: string): AgentState | undefined {
    return this.trackers.get(panelId)?.published;
  }

  /**
   * Re-evaluate a panel. Returns the newly published state when it changed, or
   * null when unchanged / still debouncing / not tracked.
   */
  update(panelId: string, detection: AgentDetectionResult, now: number): AgentState | null {
    const tracker = this.trackers.get(panelId);
    if (!tracker) return null;

    // Agent-owned viewer (transcript/model picker): hold the known state.
    if (detection.skipStateUpdate) return null;

    const { workingActivityWindowMs, workingToIdleHoldMs, startupGraceMs } = this.options;
    const recentlyActive =
      tracker.lastActivityAt !== undefined && now - tracker.lastActivityAt < workingActivityWindowMs;

    let candidate: AgentState;
    if (detection.state === 'blocked') {
      candidate = 'blocked';
    } else if (detection.state === 'working' || recentlyActive) {
      candidate = 'working';
    } else {
      candidate = 'idle';
    }

    // Startup grace: a freshly launched agent shouldn't flash idle before it boots.
    if (candidate === 'idle' && now - tracker.startedAt < startupGraceMs) {
      candidate = tracker.published ?? 'working';
    }

    // Working -> idle debounce: ride out spinner gaps before declaring done.
    let holding = false;
    if (candidate === 'idle' && tracker.published === 'working') {
      if (tracker.idleSince === undefined) {
        tracker.idleSince = now;
        holding = true;
      } else if (now - tracker.idleSince < workingToIdleHoldMs) {
        holding = true;
      }
    } else {
      tracker.idleSince = undefined;
    }
    if (holding) return null;

    if (tracker.published === candidate) return null;
    tracker.published = candidate;
    return candidate;
  }
}
