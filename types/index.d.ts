export type ActorKind = 'claude' | 'subagent' | 'codex'
export type ActorStatus = 'running' | 'waiting' | 'done' | 'failed'

export type Actor = {
  /** 'claude', the subagent's agentId, or 'codex:<tool_use_id>'. */
  id: string
  kind: ActorKind
  /** Short name shown beside the avatar. */
  label: string
  /** Subagent model alias or id; 'codex' for Codex runs. */
  model: string
  status: ActorStatus
  startedAt: number
  endedAt: number | null
  tools: number
  /** The last thing it did, short. */
  last: string
  /** Background shell id of a Codex run, to close it when its notice arrives. */
  taskId: string | null
}

export type TimelineEvent = { at: number; actorId: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'ekip-renkleri': {
      actors: Shaped<Actor[]>
      timeline: Shaped<TimelineEvent[]>
    }
  }
}
