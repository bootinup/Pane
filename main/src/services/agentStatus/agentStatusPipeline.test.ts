import { describe, expect, it } from 'vitest';
import { TerminalStateEmulator } from '../terminalStateEmulator';
import { AgentStatusMonitor } from './agentStatusMonitor';
import { detectAgentState } from './manifestEngine';
import { CLAUDE_MANIFEST } from './manifests';

/**
 * End-to-end pipeline: raw PTY bytes -> TerminalStateEmulator screen/OSC ->
 * manifest detection -> monitor arbitration. Proves the pieces compose on real
 * ANSI/OSC sequences, not just synthetic inputs.
 */
async function classify(emulator: TerminalStateEmulator, monitor: AgentStatusMonitor, now: number) {
  await emulator.waitForIdle();
  const detection = detectAgentState(CLAUDE_MANIFEST, {
    screen: emulator.getScreenText(),
    oscTitle: emulator.getOscTitle(),
    oscProgress: emulator.getOscProgress(),
  });
  return monitor.update('p', detection, now);
}

describe('agent status pipeline (emulator -> detect -> monitor)', () => {
  it('goes working (spinner title) -> blocked (permission prompt) on real sequences', async () => {
    const emulator = new TerminalStateEmulator(60, 12);
    const monitor = new AgentStatusMonitor({
      workingActivityWindowMs: 600,
      workingToIdleHoldMs: 700,
      startupGraceMs: 3000,
    });
    monitor.register('p', 0);

    // Agent starts working: OSC title carries a braille spinner + PTY bytes flow.
    emulator.write('\x1b]2;⠹ Claude\x07Thinking...');
    monitor.noteActivity('p', 4000);
    expect(await classify(emulator, monitor, 4010)).toBe('working');

    // Agent pauses for approval: title clears, a permission prompt is drawn.
    emulator.write('\x1b[2J\x1b[H');
    emulator.write('\x1b]2;\x07'); // clear title
    emulator.write('Bash command\r\n  rm -rf build\r\n\r\n');
    emulator.write('Do you want to proceed?\r\n');
    emulator.write('❯ 1. Yes\r\n  2. No, tell Claude what to do differently (esc)\r\n');
    // Bytes stopped flowing; blocker should win regardless of prior activity.
    expect(await classify(emulator, monitor, 5000)).toBe('blocked');
  });
});
