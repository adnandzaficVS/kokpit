import type { Breakdown, HeavyCall, LimitSample, Measure, RepeatRead, SessionRecord, StepUsage, ToolStat } from '../types'

export const tok = (chars: number) => Math.round(chars / 4)

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`

export const usd = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`)

export type Totals = { input: number; cacheRead: number; cacheWrite: number; output: number; steps: number; subSteps: number }

export const totals = (steps: readonly StepUsage[]): Totals =>
  steps.reduce<Totals>(
    (t, s) => ({
      input: t.input + s.input,
      cacheRead: t.cacheRead + s.cacheRead,
      cacheWrite: t.cacheWrite + s.cacheWrite,
      output: t.output + s.output,
      steps: t.steps + 1,
      subSteps: t.subSteps + (s.agentId ? 1 : 0),
    }),
    { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, steps: 0, subSteps: 0 },
  )

export const hitRate = (t: Totals) => {
  const all = t.input + t.cacheRead + t.cacheWrite
  return all === 0 ? null : t.cacheRead / all
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10
  const dd = n % 100
  return d === 1 && dd !== 11 ? one : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many
}

export const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)

export const toolLabel = (args: Record<string, unknown>) => {
  for (const k of ['file_path', 'command', 'pattern', 'url', 'path', 'query', 'description']) {
    const v = args[k]
    if (typeof v === 'string' && v) return v.replace(/\s+/g, ' ').slice(0, 80)
  }
  return ''
}

export type Input = {
  steps: readonly StepUsage[]
  tools: readonly ToolStat[]
  heavy: readonly HeavyCall[]
  repeats: readonly RepeatRead[]
  measure: Measure | null
  breakdown: Breakdown | null
  turns: number
  compactions: number
  history: readonly SessionRecord[]
  pragAlata: number
}

export const analyze = (d: Input) => {
  const t = totals(d.steps)
  const hit = hitRate(t)
  const tips: string[] = []
  const toolChars = d.tools.reduce((a, x) => a + x.chars, 0)
  const sorted = [...d.tools].sort((a, b) => b.chars - a.chars)

  if (hit != null && t.steps > 3 && hit < 0.7)
    tips.push(`**Nizak udio keša (${pct(hit)}).** Pauze duže od trajanja keša i promjena modela ili nivoa razmišljanja usred sesije poništavaju keš, pa se cijeli kontekst ponovo plaća punom cijenom.`)
  const ctx = d.measure?.percent ?? null
  if (ctx != null && ctx >= 60)
    tips.push(`**Kontekst je popunjen ${ctx} %.** Svaki naredni zahtjev ponovo šalje cijeli kontekst. Preporučuje se /compact s naznakom šta zadržati, ili nova sesija za nepovezan zadatak.`)
  const read = d.tools.find(x => x.tool === 'Read')
  if (read && read.chars > 0.3 * toolChars && tok(read.chars) > 20000)
    tips.push(`**Čitanje fajlova nosi ${pct(read.chars / Math.max(1, toolChars))} rezultata alata** (približno ${fmt(tok(read.chars))} tokena). Ciljana pretraga i čitanje određenog raspona linija znatno smanjuju unos.`)
  const bash = d.tools.find(x => x.tool === 'Bash')
  if (bash && bash.maxChars / 4 > d.pragAlata)
    tips.push(`**Najveći izlaz komande ima približno ${fmt(tok(bash.maxChars))} tokena.** Izlaz je potrebno ograničiti filtrima poput tail, head ili opcijom --quiet.`)
  const reps = d.repeats.filter(r => r.count >= 3)
  if (reps.length)
    tips.push(`**Ponovljeno čitanje istih fajlova:** ${reps.slice(0, 3).map(r => `${r.path.split('/').pop()} (${r.count}×)`).join(', ')}. Sadržaj koji je već u kontekstu nije potrebno ponovo učitavati.`)
  const mcp = d.breakdown?.mcpServers ?? []
  const mcpTok = mcp.reduce((a, m) => a + m.tokens, 0)
  if (mcpTok > 10000)
    tips.push(`**MCP alati zauzimaju približno ${fmt(mcpTok)} tokena u svakom zahtjevu.** Najveći udio imaju ${mcp.slice(0, 3).map(m => m.server).join(', ')}. Servere koji se ne koriste u ovom projektu treba isključiti.`)
  const mem = d.breakdown?.memoryFiles ?? []
  const memTok = mem.reduce((a, m) => a + m.tokens, 0)
  if (memTok > 5000)
    tips.push(`**Memorijski fajlovi zauzimaju približno ${fmt(memTok)} tokena.** CLAUDE.md treba sadržavati samo pravila potrebna u svakoj sesiji.`)
  if (t.output > 0 && t.output > 0.25 * (t.input + t.cacheWrite + t.output))
    tips.push(`**Izlazni tokeni čine značajan udio troška (${fmt(t.output)}).** Izlazni tokeni su višestruko skuplji od ulaznih. Kraći odgovori i izmjene u obliku razlika umjesto cijelih fajlova smanjuju trošak.`)
  if (t.subSteps > 0.5 * t.steps && t.steps > 10)
    tips.push(`**Subagenti čine ${pct(t.subSteps / t.steps)} zahtjeva.** Za jednostavne pretrage direktan poziv alata je jeftiniji od pokretanja agenta.`)
  if (d.compactions > 0)
    tips.push(`**Sesija je kompaktirana ${d.compactions} ${plural(d.compactions, 'put', 'puta', 'puta')}.** Nepovezane zadatke je isplativije raditi u zasebnim sesijama.`)

  const prev = d.history.filter(h => h.usd != null)
  const avg = prev.length ? prev.reduce((a, h) => a + (h.usd ?? 0), 0) / prev.length : null

  const lines = [
    '## Sažetak',
    '',
    '| Mjera | Vrijednost |',
    '| --- | --- |',
    `| Trošak | ${usd(d.measure?.usd)}${avg != null ? ` (prosjek zadnjih ${prev.length}: ${usd(avg)})` : ''} |`,
    `| Kontekst | ${ctx == null ? '—' : `${ctx} %`} od ${fmt(d.measure?.window ?? 0)} |`,
    `| Poruke / zahtjevi prema modelu | ${d.turns} / ${t.steps} |`,
    `| Ulaz iz keša / upis u keš / bez keša | ${fmt(t.cacheRead)} / ${fmt(t.cacheWrite)} / ${fmt(t.input)} |`,
    `| Izlaz | ${fmt(t.output)} |`,
    `| Pogodak keša | ${pct(hit)} |`,
    `| Rezultati alata (procjena) | ${fmt(tok(toolChars))} |`,
    '',
    '## Alati po potrošnji',
    '',
    ...(sorted.length
      ? sorted.slice(0, 6).map(x => `- **${x.tool}**: ${x.calls} ${plural(x.calls, 'poziv', 'poziva', 'poziva')}, ${fmt(tok(x.chars))} tokena, najveći rezultat ${fmt(tok(x.maxChars))}${x.errors ? `, ${x.errors} ${plural(x.errors, 'greška', 'greške', 'grešaka')}` : ''}`)
      : ['- U ovoj sesiji nije bilo poziva alata.']),
    '',
    '## Preporuke',
    '',
    ...(tips.length ? tips.map(x => `- ${x}`) : ['- Nema uočenih odstupanja. Potrošnja je u očekivanim granicama.']),
  ]
  return { markdown: lines.join('\n'), tips, totals: t, hit }
}

const LIMIT_NAMES: Record<string, { label: string; short: string; hint: string }> = {
  five_hour: { label: 'Petosatni prozor', short: 'Limit 5 h', hint: 'kratkoročna kvota' },
  seven_day: { label: 'Sedmični limit', short: 'Limit 7 d', hint: 'svi modeli' },
  seven_day_opus: { label: 'Sedmični limit, Opus', short: 'Opus 7 d', hint: 'samo Opus' },
  seven_day_sonnet: { label: 'Sedmični limit, Sonnet', short: 'Sonnet 7 d', hint: 'samo Sonnet' },
  spend_limit: { label: 'Limit potrošnje', short: 'Potrošnja', hint: 'postavljen u organizaciji' },
}

export const limitName = (kind: string) => LIMIT_NAMES[kind] ?? { label: kind.replace(/_/g, ' '), short: kind.replace(/_/g, ' '), hint: '' }

export const resetText = (iso: string | undefined, now: number) => {
  if (!iso) return 'Vrijeme obnove nije poznato'
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return 'Vrijeme obnove nije poznato'
  if (ms <= 0) return 'Obnavlja se upravo sada'
  const min = Math.round(ms / 60000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const parts = d > 0 ? [`${d} d`, `${h} h`] : h > 0 ? [`${h} h`, `${m} min`] : [`${m} min`]
  return `Obnavlja se za ${parts.join(' ')}`
}

export const dur = (ms: number) => {
  const min = Math.max(1, Math.round(ms / 60000))
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  return (d > 0 ? [`${d} d`, `${h} h`] : h > 0 ? [`${h} h`, `${m} min`] : [`${m} min`]).join(' ')
}

export type Forecast =
  | { kind: 'nepoznato'; text: string }
  | { kind: 'mirno'; text: string; atReset: number | null }
  | { kind: 'puni'; text: string; etaMs: number }

// Tempo se računa iz uzoraka zadnjeg sata; potrebno je barem 5 minuta podataka i rast.
export const forecast = (samples: readonly LimitSample[], kind: string, percent: number, resetsAt: string | undefined, now: number): Forecast => {
  const own = samples.filter(s => s.kind === kind && now - s.at <= 60 * 60_000)
  const first = own[0]
  const reset = resetsAt ? Date.parse(resetsAt) : NaN
  const toReset = Number.isFinite(reset) ? reset - now : null
  if (!first || now - first.at < 5 * 60_000) return { kind: 'nepoznato', text: 'Prognoza nakon nekoliko minuta rada' }
  const rate = (percent - first.percent) / (now - first.at)
  if (rate <= 0) return { kind: 'mirno', text: 'Ovim tempom limit se ne troši', atReset: null }
  const etaMs = (100 - percent) / rate
  if (toReset != null && etaMs >= toReset) {
    const atReset = Math.min(100, Math.round(percent + rate * toReset))
    return { kind: 'mirno', text: `Ovim tempom do obnove oko ${atReset} %`, atReset }
  }
  return { kind: 'puni', text: `Ovim tempom pun za oko ${dur(etaMs)}`, etaMs }
}

export const periodStart = (now: number, period: 'daily' | 'weekly') => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

export const spent = (history: readonly SessionRecord[], currentId: string | null, currentUsd: number | null, since: number) =>
  history.filter(r => r.id !== currentId && r.endedAt >= since).reduce((a, r) => a + (r.usd ?? 0), 0) + (currentUsd ?? 0)

export const normServer = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_')

export const serverOfTool = (tool: string) => (tool.startsWith('mcp__') ? normServer(tool.split('__')[1] ?? '') : null)

export const serverLabel = (s: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) ? `konektor ${s.slice(0, 8)}` : s.replace(/^plugin:/, ''))

// Dva servera su duplikati kad dijele barem 5 alata istog imena i to je barem 80 % manjeg od njih.
export const mcpDuplicates = (list: readonly { name: string; serverName: string }[]) => {
  const sets = new Map<string, Set<string>>()
  for (const t of list) {
    const set = sets.get(t.serverName) ?? new Set<string>()
    set.add(t.name.slice(t.name.lastIndexOf('__') + 2))
    sets.set(t.serverName, set)
  }
  const names = [...sets.keys()]
  const out: { a: string; b: string; shared: number }[] = []
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = sets.get(names[i]!)!
      const b = sets.get(names[j]!)!
      const shared = [...a].filter(x => b.has(x)).length
      if (shared >= 5 && shared >= 0.8 * Math.min(a.size, b.size)) out.push({ a: names[i]!, b: names[j]!, shared })
    }
  return out
}

export const byWeek = (history: readonly SessionRecord[], now: number, weeks: number) => {
  const start = periodStart(now, 'weekly')
  return Array.from({ length: weeks }, (_, i) => {
    const from = start - (weeks - 1 - i) * 7 * 86_400_000
    const to = from + 7 * 86_400_000
    const rows = history.filter(r => r.endedAt >= from && r.endedAt < to)
    const d = new Date(from)
    return { label: `${d.getDate()}.${d.getMonth() + 1}.`, usd: rows.reduce((a, r) => a + (r.usd ?? 0), 0), sessions: rows.length }
  })
}

export const byProject = (history: readonly SessionRecord[]) => {
  const m = new Map<string, { usd: number; sessions: number }>()
  for (const r of history) {
    const name = r.cwd.includes('scratch-workspaces') ? 'bez foldera' : r.cwd.split('/').pop() || r.cwd
    const cur = m.get(name) ?? { usd: 0, sessions: 0 }
    m.set(name, { usd: cur.usd + (r.usd ?? 0), sessions: cur.sessions + 1 })
  }
  return [...m].map(([name, v]) => ({ name, ...v })).sort((a, z) => z.usd - a.usd)
}
