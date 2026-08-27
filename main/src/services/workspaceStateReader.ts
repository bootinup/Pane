import type { SessionManager } from './sessionManager';
import { panelManager } from './panelManager';
import { terminalPanelManager } from './terminalPanelManager';
import { boundary, decodeBoundary } from '../../../shared/validation/boundaryDecoder';
import type { AgentState } from '../../../shared/types/agentStatus';
import type {
  RunpaneWorkspaceEntry,
  RunpaneWorkspaceEntryKind,
  RunpaneWorkspaceStateResult,
} from '../../../shared/types/runpaneOrchestration';

export class WorkspaceStateReader {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly getEpoch: () => string,
    private readonly getGeneration: () => number,
  ) {}

  read(repoId?: number): RunpaneWorkspaceStateResult {
    const at = new Date().toISOString();
    const generation = this.getGeneration();
    const entries: RunpaneWorkspaceEntry[] = [];
    const sessions = repoId === undefined
      ? this.sessionManager.getAllSessions()
      : this.sessionManager.getSessionsForProject(repoId);

    for (const session of sessions) {
      if (session.archived || session.isHidden) continue;
      const project = this.sessionManager.getProjectForSession(session.id);
      const common = {
        gen: generation,
        at,
        paneId: session.id,
        paneName: session.name,
        repoId: project?.id,
        repoName: project?.name,
        worktreePath: session.worktreePath,
        baseline: true as const,
      };
      entries.push({ ...common, kind: 'pane.created', source: 'session' });

      for (const panel of panelManager.getPanelsForSession(session.id)) {
        const customState = decodeBoundary(panel.state.customState ?? {}, boundary.object({
          isCliPanel: boundary.optional(boundary.boolean),
          agentType: boundary.optional(boundary.string),
        }));
        if (panel.type !== 'terminal' || customState?.isCliPanel !== true) continue;
        const agentState = terminalPanelManager.getAgentStatus(panel.id) ?? 'unknown';
        entries.push({
          ...common,
          kind: entryKindForState(agentState),
          panelId: panel.id,
          agentType: customState.agentType,
          to: agentState,
          source: 'agent',
        });
      }
    }

    return { ok: true, epoch: this.getEpoch(), generation, entries };
  }
}

function entryKindForState(state: AgentState): RunpaneWorkspaceEntryKind {
  if (state === 'working') return 'agent.busy';
  if (state === 'blocked') return 'agent.blocked';
  if (state === 'idle') return 'agent.ready';
  return 'agent.unknown';
}
