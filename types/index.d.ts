export type StepUsage = {
  turnId: string
  index: number
  agentId?: string
  model: string
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  at: number
}

export type ToolStat = {
  tool: string
  calls: number
  chars: number
  maxChars: number
  errors: number
}

export type HeavyCall = {
  id: string
  tool: string
  label: string
  chars: number
  at: number
}

export type RepeatRead = { path: string; count: number; chars: number }

export type Measure = {
  percent: number | null
  tokens: number | null
  window: number
  usd: number | null
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  at: number
}

export type ContextRow = { name: string; tokens: number; kind: string }

export type Breakdown = {
  rows: ContextRow[]
  total: number
  max: number
  memoryFiles: { path: string; tokens: number }[]
  mcpServers: { server: string; tokens: number; count: number }[]
  mcpAll: { server: string; count: number }[]
  duplicates: { a: string; b: string; shared: number }[]
  detail: 'summary' | 'full'
  at: number
}

export type View = 'sesija' | 'potrosnja' | 'troskovi' | 'artefakti'

export type Pin = { url: string; title: string; at: number }

export type Report = { ai: string | null; aiNote: string | null; tips: string[]; at: number }

export type Warned = { context: number; cacheMissAt: number; limits: Record<string, number>; budget: number }

export type LimitSample = { kind: string; at: number; percent: number }

export type Budget = { daily: number | null; weekly: number | null }

export type SessionRecord = {
  id: string
  cwd: string
  startedAt: number
  endedAt: number
  usd: number | null
  turns: number
  steps: number
  toolCalls: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
  toolChars: number
  mcpUsed?: string[]
}

declare module 'claude-code' {
  interface PluginState {
    kokpit: {
      steps: StepUsage[]
      tools: ToolStat[]
      heavy: HeavyCall[]
      repeats: RepeatRead[]
      measure: Measure | null
      breakdown: Breakdown | null
      view: View
      warned: Warned
      report: Report | null
      busy: boolean
      band: 'full' | 'mini'
      confirm: string | null
      turns: number
      compactions: number
      samples: LimitSample[]
      budget: Budget
      expanded: string[]
      pins: Pin[]
      recent: Pin[]
      project: string | null
      library: Pin[] | null
      linking: boolean
      libQuery: string
      adding: 'lib' | 'link' | null
      pickNonce: number
      opened: string[]
    }
  }
}
