import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, Register, RenderElement } from 'claude-code'

import type { Breakdown, Budget, Pin, Report, HeavyCall, LimitSample, Measure, RepeatRead, SessionRecord, StepUsage, ToolStat, View, Warned } from '../types'
import { analyze, byProject, byWeek, forecast, fmt, hitRate, limitName, mcpDuplicates, normServer, pct, periodStart, plural, resetText, serverLabel, serverOfTool, spent, tok, toolLabel, totals, usd } from './lib'
import type { Forecast } from './lib'
import { C, SERIES, TONE_TEXT, toneOf } from './charts'
import type { Tone } from './charts'
import { kids, kit } from './ui'
import type { Child } from './ui'

type LimitRow = { label: string; short?: string; kind?: string; hint: string; percent: number; reset: string; note?: string; noteColor?: string; value?: string }

const pctText = (p: number | null) => (p == null ? '—' : `${Math.round(p)} %`)
const toneFromHex = (c?: string): Tone => (c === C.red ? 'bad' : c === C.amber ? 'warn' : c === C.green ? 'ok' : 'muted')
const hhmm = (at: number) => new Date(at).toTimeString().slice(0, 5)

const P = 'kokpit'
const PANE = 'kokpit'
const TITLE = 'Kokpit'
const HISTORY = 'history'

const steps = atom({ plugin: 'kokpit', key: 'steps' } as const, [])
const tools = atom({ plugin: 'kokpit', key: 'tools' } as const, [])
const heavy = atom({ plugin: 'kokpit', key: 'heavy' } as const, [])
const repeats = atom({ plugin: 'kokpit', key: 'repeats' } as const, [])
const measure = atom({ plugin: 'kokpit', key: 'measure' } as const, null)
const breakdown = atom({ plugin: 'kokpit', key: 'breakdown' } as const, null)
const view = atom({ plugin: 'kokpit', key: 'view' } as const, 'sesija')
const warned = atom({ plugin: 'kokpit', key: 'warned' } as const, { context: 0, cacheMissAt: 0, limits: {}, budget: 0 })
const report = atom({ plugin: 'kokpit', key: 'report' } as const, null as Report | null)
const busy = atom({ plugin: 'kokpit', key: 'busy' } as const, false)
const confirm = atom({ plugin: 'kokpit', key: 'confirm' } as const, null as string | null)
const turns = atom({ plugin: 'kokpit', key: 'turns' } as const, 0)
const compactions = atom({ plugin: 'kokpit', key: 'compactions' } as const, 0)
const samples = atom({ plugin: 'kokpit', key: 'samples' } as const, [])
const budget = atom({ plugin: 'kokpit', key: 'budget' } as const, { daily: null, weekly: null })
const expanded = atom({ plugin: 'kokpit', key: 'expanded' } as const, [])
const pins = atom({ plugin: 'kokpit', key: 'pins' } as const, [] as Pin[])
const recent = atom({ plugin: 'kokpit', key: 'recent' } as const, [] as Pin[])
const project = atom({ plugin: 'kokpit', key: 'project' } as const, null as string | null)
const library = atom({ plugin: 'kokpit', key: 'library' } as const, null as Pin[] | null)
const linking = atom({ plugin: 'kokpit', key: 'linking' } as const, false)
const libQuery = atom({ plugin: 'kokpit', key: 'libQuery' } as const, '')
const adding = atom({ plugin: 'kokpit', key: 'adding' } as const, null as 'lib' | 'link' | null)
const pickNonce = atom({ plugin: 'kokpit', key: 'pickNonce' } as const, 0)
const opened = atom({ plugin: 'kokpit', key: 'opened' } as const, [] as string[])

// Select prima najviše 64 opcije; jedna ide na „Odaberi…“.
const MAX_OPTIONS = 60

const VIEWS: View[] = ['sesija', 'potrosnja', 'troskovi', 'artefakti']

const loadHistory = async ($: EngineInterface): Promise<SessionRecord[]> => {
  const v = await $.store.get(HISTORY)
  return Array.isArray(v) ? (v as SessionRecord[]) : []
}

const refreshBreakdown = async ($: EngineInterface, detail: 'summary' | 'full') => {
  const u = await $.session.usage({ breakdown: detail })
  const b = u.context.breakdown
  if (!b) return
  const servers = new Map<string, { tokens: number; count: number }>()
  for (const t of b.mcpTools.filter(x => x.isLoaded)) {
    const s = servers.get(t.serverName) ?? { tokens: 0, count: 0 }
    servers.set(t.serverName, { tokens: s.tokens + t.tokens, count: s.count + 1 })
  }
  const next: Breakdown = {
    rows: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
    total: b.totalTokens,
    max: b.rawMaxTokens,
    memoryFiles: b.memoryFiles.map(m => ({ path: m.path, tokens: m.tokens })),
    mcpServers: [...servers].map(([server, s]) => ({ server, ...s })).sort((a, z) => z.tokens - a.tokens),
    mcpAll: [...b.mcpTools.reduce((m, t) => m.set(t.serverName, (m.get(t.serverName) ?? 0) + 1), new Map<string, number>())].map(([server, count]) => ({ server, count })),
    duplicates: mcpDuplicates(b.mcpTools),
    detail,
    at: await $.clock.now(),
  }
  await update($, breakdown, () => next)
}

const runAnalysis = async ($: EngineInterface, ai: boolean, pragAlata: number) => {
  await update($, busy, () => true)
  try {
    return await analysisBody($, ai, pragAlata)
  } finally {
    await update($, busy, () => false)
  }
}

const analysisBody = async ($: EngineInterface, ai: boolean, pragAlata: number) => {
  await refreshBreakdown($, 'summary').catch(() => undefined)
  const data = {
    steps: await read($, steps),
    tools: await read($, tools),
    heavy: await read($, heavy),
    repeats: await read($, repeats),
    measure: await read($, measure),
    breakdown: await read($, breakdown),
    turns: await read($, turns),
    compactions: await read($, compactions),
    history: await loadHistory($),
    pragAlata,
  }
  const local = analyze(data)
  const text = local.markdown
  let aiText: string | null = null
  let aiNote: string | null = local.totals.steps > 0 ? null : 'Analiza modela je dostupna nakon prvog odgovora.'
  if (ai && local.totals.steps > 0) {
    const prompts = (await $.session.messages())
      .filter(m => m.role === 'user' && m.text.trim())
      .slice(-12)
      .map(m => `- (${fmt(tok(m.text.length))} tok) ${m.text.replace(/\s+/g, ' ').slice(0, 200)}`)
      .join('\n')
    const heavyList = data.heavy.slice(-8).map(x => `- ${x.tool} ~${fmt(tok(x.chars))} tok: ${x.label}`).join('\n')
    const r = await $.model.complete({
      model: analysisModel.model,
      effort: analysisModel.effort,
      maxTokens: 8000,
      system:
        'Pišeš stručni izvještaj o potrošnji tokena u Claude Code sesiji. Jezik: standardni bosanski, ijekavica. Ton: profesionalan, neutralan i sažet, kao tehnička dokumentacija. Koristi bezlične konstrukcije i ne pretpostavljaj rod korisnika. Ne komentariši ton, raspoloženje ni zadovoljstvo korisnika. Ne obraćaj se čitaocu uzvicima i ne ponavljaj tabelu iz ulaza. Markdown, bez naslova prvog nivoa.',
      prompt: `Statistika sesije:\n${local.markdown}\n\nNajveći pojedinačni rezultati alata:\n${heavyList || '- nema'}\n\nZadnje poruke korisnika:\n${prompts || '- nema'}\n\nNapiši tri kratka dijela s naslovima drugog nivoa: „Pregled“ (dvije do tri rečenice: tema sesije i glavni izvori potrošnje), „Preporuke“ (najviše četiri stavke, svaka konkretna i vezana za ovu sesiju) i „Naredni korak“ (jedna rečenica: nastaviti, kompaktirati ili otvoriti novu sesiju, uz razlog).`,
    })
    if (r.isAnswered) aiText = r.text.trim()
    else aiNote = `Procjena modela trenutno nije dostupna (${r.reason}).`
  } else if (!ai) aiNote = 'AI sažetak je isključen u postavkama moda.'
  const at = await $.clock.now()
  await update($, report, () => ({ ai: aiText, aiNote, tips: local.tips, at }))
  return aiText ? `${aiText}\n\n---\n\n${text}` : text
}

// Redoslijed je redoslijed prikaza; Novi zadatak je zadnji jer briše razgovor.
const ACTIONS = [
  { id: 'compact', key: 's', title: 'Compact', desc: 'Claude Code sam sažme razgovor (/compact) i oslobodi kontekst, bez posebnih uputa.', button: 'Compact' },
  { id: 'compact-upute', key: 'p', title: 'Smart compact', desc: 'Model prvo predloži šta sažetak mora zadržati i upiše /compact s tim uputama; provjeriti pa Enter.', button: 'Prepare' },
  { id: 'mcp', key: 'm', title: 'MCP serveri', desc: 'Uključivanje i isključivanje servera; isključeni ne opterećuju kontekst.', button: 'Otvori' },
  { id: 'model', key: 'o', title: 'Promjena modela', desc: 'Izbor modela; promjena usred zadatka poništava keš.', button: 'Promijeni' },
  { id: 'clear', key: 'n', title: 'New task', desc: 'Briše razgovor (/clear) i počinje ispočetka u istom folderu.', button: 'Clear' },
] as const

type ActionId = (typeof ACTIONS)[number]['id']

const runCommand = async ($: EngineInterface, command: string, args = '') => {
  try {
    await $.command.run({ command, args })
  } catch {
    await $.prompt.fill({ text: `/${command}${args ? ` ${args}` : ''}` })
    $.ui.toast(`Komanda /${command} je upisana u polje za unos. Pritisnite Enter za izvršenje.`)
  }
}

const runAction = async ($: EngineInterface, id: ActionId) => {
  if (id === 'compact') {
    await runCommand($, 'compact')
  } else if (id === 'compact-upute') {
    await smartCompact($)
  } else if (id === 'clear') {
    if ((await read($, confirm)) !== 'clear') {
      await update($, confirm, () => 'clear')
      return
    }
    await update($, confirm, () => null)
    await runCommand($, 'clear')
  } else if (id === 'mcp') {
    await runCommand($, 'mcp')
  } else if (id === 'model') {
    await runCommand($, 'model')
  }
}

// Iz zadnjih poruka i fajlova sesije model sastavlja upute za /compact; bez modela ostaje prazan predložak.
const EFFORTS: readonly ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
// Postavlja se iz userConfig pri učitavanju moda.
let compactModel: { model: string; effort: ModelEffort } = { model: 'opus', effort: 'medium' }
let analysisModel: { model: string; effort: ModelEffort } = { model: 'opus', effort: 'medium' }
const modelOf = (model: unknown, effort: unknown) => ({
  model: typeof model === 'string' && model ? model : 'opus',
  effort: EFFORTS.find(x => x === effort) ?? 'medium',
})

const smartCompact = async ($: EngineInterface) => {
  const cm = compactModel
  $.ui.toast(`Model ${cm.model} (${cm.effort}) priprema upute za sažimanje…`, { timeoutMs: 15000 })
  const prompts = (await $.session.messages())
    .filter(m => m.role === 'user' && m.text.trim())
    .slice(-8)
    .map(m => `- ${m.text.replace(/\s+/g, ' ').slice(0, 800)}`)
    .join('\n')
  const files = [...(await read($, repeats))].slice(-15).map(r => `- ${r.path}`).join('\n')
  let keep = ''
  if (prompts) {
    const r = await $.model.complete({
      model: cm.model,
      effort: cm.effort,
      maxTokens: 8000,
      system: 'Sastavljaš upute za sažimanje Claude Code razgovora. Odgovor je jedna linija na bosanskom, ijekavica, bez uvoda i navodnika: nabrajanje, odvojeno tačka-zarezom, onoga što sažetak mora zadržati: trenutni zadatak, donesene odluke, otvorena pitanja i ključne fajlove s putanjama.',
      prompt: `Zadnje poruke korisnika:\n${prompts}\n\nFajlovi korišteni u sesiji:\n${files || '- nema'}`,
    }).catch(() => null)
    if (r?.isAnswered) keep = r.text.replace(/\s+/g, ' ').trim()
  }
  await $.prompt.fill({ text: `/compact Zadržati: ${keep}` })
  $.ui.toast(keep ? 'Upute za sažimanje su upisane u polje za unos. Provjeriti pa pritisnuti Enter.' : 'Model nije dostupan. Upisati šta sažetak mora zadržati pa pritisnuti Enter.', { timeoutMs: 6000 })
}

const openPane = async ($: EngineInterface, v?: View) => {
  if (v) await update($, view, () => v)
  await refreshBreakdown($, 'summary').catch(() => undefined)
  await $.ui.open({ id: PANE, title: TITLE, focus: true })
}

const forecastColor = (f: Forecast) => (f.kind === 'puni' ? (f.etaMs < 60 * 60_000 ? C.red : C.amber) : f.kind === 'mirno' ? C.green : C.gray)

const limitRows = async ($: EngineInterface, now: number): Promise<LimitRow[]> => {
  const m = await read($, measure)
  const smp = await read($, samples)
  return (m?.rateLimits ?? []).map(r => {
    const f = forecast(smp, r.kind, r.percentUsed, r.resetsAt, now)
    const n = limitName(r.kind)
    return { label: n.label, short: n.short, kind: r.kind, hint: n.hint, percent: r.percentUsed, reset: resetText(r.resetsAt, now), note: f.text, noteColor: forecastColor(f) }
  })
}

const budgetRows = (bud: Budget, hist: readonly SessionRecord[], id: string | null, cur: number | null, now: number): LimitRow[] =>
  (['daily', 'weekly'] as const)
    .filter(k => bud[k] != null)
    .map(k => {
      const cap = bud[k] ?? 1
      const s = spent(hist, id, cur, periodStart(now, k))
      const left = cap - s
      return {
        label: k === 'daily' ? 'Dnevni budžet' : 'Sedmični budžet',
        hint: `${usd(s)} od ${usd(cap)}`,
        percent: Math.min(100, (s / cap) * 100),
        value: `${Math.round((s / cap) * 100)} %`,
        reset: left >= 0 ? `Preostalo ${usd(left)}` : `Prekoračeno za ${usd(-left)}`,
      }
    })

type Fix = { label: string; run: () => Promise<unknown> }
type Status = { title: string; advice: string; color: string; alerts: { title: string; text: string; tone: Tone; fix?: Fix }[] }

// Jedno stanje za zaglavlje (najhitnije) i spisak svih upozorenja za odjeljak Sesija.
const statusOf = async ($: EngineInterface, id: string | null, now: number): Promise<Status> => {
  const m = await read($, measure)
  const t = totals(await read($, steps))
  const hit = hitRate(t)
  const p = m?.percent ?? null
  const found: { rank: number; title: string; advice: string; text: string; color: string; fix?: Fix }[] = []
  const go = (v: View): Fix => ({ label: 'Detalji', run: () => update($, view, () => v) })
  if (p != null && p >= 80) found.push({ rank: 9, title: 'Kontekst skoro pun', advice: 'Sažeti razgovor ili početi novi zadatak.', text: `Kontekst je popunjen ${p} %. Svaki zahtjev ga šalje u cijelosti.`, color: C.red, fix: { label: 'Smart compact', run: () => smartCompact($) } })
  else if (p != null && p >= 60) found.push({ rank: 5, title: 'Kontekst se puni', advice: 'Uskoro sažeti razgovor (Smart compact).', text: `Kontekst je popunjen ${p} %.`, color: C.amber, fix: { label: 'Smart compact', run: () => smartCompact($) } })
  for (const r of budgetRows(await read($, budget), await loadHistory($), id, m?.usd ?? null, now)) {
    if (r.percent >= 80)
      found.push({ rank: r.percent >= 100 ? 7 : 3, title: r.percent >= 100 ? 'Budžet potrošen' : 'Budžet pri kraju', advice: `${r.label}: ${r.hint}.`, text: `${r.label}: potrošeno ${r.hint}.`, color: r.percent >= 100 ? C.red : C.amber, fix: go('troskovi') })
  }
  if (hit != null && t.steps > 3 && hit < 0.6) found.push({ rank: 2, title: 'Slab keš', advice: 'Izbjegavati duže pauze i promjenu modela usred zadatka.', text: `Samo ${pct(hit)} ulaza dolazi iz keša.`, color: C.amber })
  const hv = (await read($, heavy)).filter(x => now - x.at < 10 * 60_000)
  if (hv.length) found.push({ rank: 1, title: 'Veliki rezultati alata', advice: 'Detalji su u odjeljku Potrošnja.', text: `${hv.length} ${plural(hv.length, 'veliki rezultat', 'velika rezultata', 'velikih rezultata')} alata u zadnjih 10 minuta, najveći ${fmt(tok(Math.max(...hv.map(x => x.chars))))} tokena.`, color: C.amber, fix: go('potrosnja') })
  const dup = (await read($, breakdown))?.duplicates ?? []
  if (dup.length) found.push({ rank: 0, title: 'Duplikat MCP servera', advice: 'Detalji su u odjeljku Potrošnja.', text: `${dup.length} ${plural(dup.length, 'par', 'para', 'parova')} MCP servera s istim alatima. Jedan iz para se može isključiti.`, color: C.amber, fix: { label: 'MCP serveri', run: () => runCommand($, 'mcp') } })
  found.sort((a, z) => z.rank - a.rank)
  const top = found[0]
  return top
    ? { title: top.title, advice: top.advice, color: top.color, alerts: found.map(x => ({ title: x.title, text: x.text, tone: toneFromHex(x.color), fix: x.fix })) }
    : { title: 'Sve je uredu', advice: t.steps ? 'Kontekst, keš i limiti su u granicama.' : 'Brojke se pojavljuju nakon prvog odgovora.', color: C.green, alerts: [] }
}

const mcpReport = (b: Breakdown | null, used: readonly ToolStat[], hist: readonly SessionRecord[]) => {
  const tracked = hist.filter(r => Array.isArray(r.mcpUsed)).slice(-10)
  const seen = new Set([...used.map(x => serverOfTool(x.tool)), ...tracked.flatMap(r => r.mcpUsed ?? [])].filter(Boolean))
  const unused = tracked.length >= 3 ? (b?.mcpAll ?? []).map(x => x.server).filter(s => !seen.has(normServer(s))) : []
  const duplicates = b?.duplicates ?? []
  const loaded = (b?.mcpServers ?? []).slice(0, 6).map(s => ({ label: serverLabel(s.server), value: s.tokens, note: `${fmt(s.tokens)} · ${s.count} ${plural(s.count, 'alat', 'alata', 'alata')}` }))
  return { unused, duplicates, loaded, sessions: tracked.length, issues: duplicates.length + (unused.length ? 1 : 0) }
}

// Pinovi artefakata žive u $.store pod ključem projekta: korijen git repozitorija, inače folder sesije.
const PINS = 'pins'
const projectOf = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const git = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: 5000 }).catch(() => null)
  return git && git.exitCode === 0 && git.stdout.trim() ? git.stdout.trim() : cwd
}
const projectName = (key: string | null) => (key == null ? '' : key.includes('scratch-workspaces') ? 'sesija bez foldera' : (key.split('/').pop() ?? key))

const allPins = async ($: EngineInterface): Promise<Record<string, Pin[]>> => {
  const v = await $.store.get(PINS)
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Pin[]>) : {}
}

const savePins = async ($: EngineInterface, fn: (list: Pin[]) => Pin[]) => {
  const key = (await read($, project)) ?? (await projectOf($))
  await update($, project, () => key)
  const all = await allPins($)
  const next = fn(all[key] ?? []).slice(0, 30)
  await $.store.set(PINS, { ...all, [key]: next })
  await update($, pins, () => next)
}

const ARTIFACT_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9-]+/

const pinUrl = async ($: EngineInterface, url: string, title?: string) => {
  const u = url.trim().match(ARTIFACT_URL)?.[0] ?? (url.trim().startsWith('https://') ? url.trim() : null)
  if (!u) {
    $.ui.toast('Pinovati se može link artefakta (https://claude.ai/…).')
    return
  }
  const known = (await read($, recent)).find(x => x.url === u)
  const at = await $.clock.now()
  const lib = (await read($, library)) ?? []
  await setHidden($, u, false)
  await savePins($, list => [...list.filter(x => x.url !== u), { url: u, title: title ?? known?.title ?? lib.find(x => x.url === u)?.title ?? 'Artefakt', at }])
}

const HIDDEN = 'pinsHidden'
const hiddenOf = async ($: EngineInterface, key: string) => {
  const v = (await $.store.get(HIDDEN)) as Record<string, string[]> | undefined
  return v && typeof v === 'object' ? (v[key] ?? []) : []
}
const setHidden = async ($: EngineInterface, url: string, isHidden: boolean) => {
  const key = (await read($, project)) ?? (await projectOf($))
  const v = ((await $.store.get(HIDDEN)) as Record<string, string[]> | undefined) ?? {}
  const cur = (v[key] ?? []).filter(x => x !== url)
  await $.store.set(HIDDEN, { ...v, [key]: isHidden ? [...cur, url].slice(-200) : cur })
}

// Biblioteka: „- (mine, pinned) Naziv — https://claude.ai/artifact/… — updated 2026-10-27“.
const LIB_LINE = /^- \(([^)]*)\) (.+?) — (https:\/\/claude\.ai\/\S+) — /
const loadLibrary = async ($: EngineInterface) => {
  const r = (await $.tool.call({ tool: 'Artifact', action: 'list', limit: 200 } as never)) as unknown as { text?: string }
  const at = await $.clock.now()
  const list = (r.text ?? '')
    .split('\n')
    .map(l => l.match(LIB_LINE))
    .filter((x): x is RegExpMatchArray => !!x)
    .map(x => ({ url: x[3] ?? '', title: (x[2] ?? 'Artefakt').trim(), at }))
  await update($, library, () => list)
  return list
}

// Artefakti spomenuti u ranijim razgovorima ovog projekta (i njegovih podfoldera i worktree-a),
// upareni s bibliotekom; pin koji je korisnik uklonio ne vraća se.
const linkProject = async ($: EngineInterface) => {
  await update($, linking, () => true)
  try {
    const key = (await read($, project)) ?? (await projectOf($))
    if (key.includes('scratch-workspaces')) return 0
    const enc = key.replace(/[^A-Za-z0-9]/g, '-')
    const found = await $.process.run(
      ['/bin/sh', '-c', 'cd "$HOME/.claude/projects" 2>/dev/null && grep -rhoE "https://claude\\.ai/(code/)?artifact/[A-Za-z0-9-]+" -- ./"$1"*/ 2>/dev/null | sort | uniq -c | sort -rn | head -60', 'sh', enc],
      { timeoutMs: 20000 },
    )
    const urls = found.stdout.split('\n').map(l => l.trim().split(/\s+/)[1]).filter((x): x is string => !!x)
    if (!urls.length) return 0
    const lib = (await read($, library)) ?? (await loadLibrary($))
    const hidden = new Set(await hiddenOf($, key))
    const have = new Set((await read($, pins)).map(x => x.url))
    const add = urls.map(u => lib.find(x => x.url === u)).filter((x): x is Pin => !!x && !hidden.has(x.url) && !have.has(x.url)).slice(0, Math.max(0, 12 - have.size))
    if (add.length) {
      await savePins($, l => [...l, ...add])
      $.ui.toast(`Kokpit je povezao ${add.length} ${plural(add.length, 'artefakt', 'artefakta', 'artefakata')} iz ovog projekta.`, { timeoutMs: 5000 })
    }
    return add.length
  } finally {
    await update($, linking, () => false)
  }
}

// Aplikacija artefakt koji je u ovoj sesiji već bio otvoren ne otvara ponovo nakon zatvaranja panela,
// iako javi da jeste; takav se zato otvara u pregledniku.
const openArtifact = async ($: EngineInterface, url: string) => {
  const inBrowser = () => $.process.run(['open', url]).catch(() => $.ui.toast(`Artefakt nije otvoren: ${url}`))
  if ((await read($, opened)).includes(url)) {
    await inBrowser()
    return
  }
  const r = (await $.tool.call({ tool: 'Artifact', action: 'open', url } as never).catch(() => null)) as { isError?: boolean; deny?: string } | null
  if (!r || r.isError || r.deny !== undefined) await inBrowser()
  else await update($, opened, l => (l.includes(url) ? l : [...l, url]))
}

const togglePane = async ($: EngineInterface) => {
  if ((await $.ui.panes()).some(x => x.id === PANE)) await $.ui.close({ id: PANE })
  else await openPane($, 'sesija')
}

export const register: Register = (on, options) => {
  const pragAlata = typeof options.pragAlata === 'number' ? options.pragAlata : 8000
  const ai = options.ai !== false
  compactModel = modelOf(options.sazimanjeModel, options.sazimanjeNapor)
  analysisModel = modelOf(options.analizaModel, options.analizaNapor)
  let sessionStart = 0
  let sessionId: string | null = null

  on('session.start', async ($, e, next) => {
    sessionStart = await $.clock.now()
    sessionId = await $.session.id()
    const sv = await $.store.get('samples')
    if (Array.isArray(sv)) await update($, samples, () => (sv as LimitSample[]).filter(x => sessionStart - x.at < 3 * 3600_000))
    const bv = (await $.store.get('budget')) as Budget | undefined
    if (bv && typeof bv === 'object') await update($, budget, () => ({ daily: bv.daily ?? null, weekly: bv.weekly ?? null }))
    await $.command.register({ name: 'kokpit', description: 'Otvara Kokpit: stanje sesije, akcije i analiza' })
    await $.command.register({ name: 'kokpit-analiza', description: 'Analizira potrošnju u ovoj sesiji i daje preporuke' })
    await $.command.register({ name: 'kokpit-historija', description: 'Prikazuje trošak prethodnih sesija' })
    const key = await projectOf($)
    await update($, project, () => key)
    await update($, pins, () => [])
    const own = (await allPins($))[key]
    if (own?.length) await update($, pins, () => own)
    await $.command.register({ name: 'kokpit-pin', description: 'Pinuje artefakt za ovaj projekat: /kokpit-pin <link> [naziv]' })
    void linkProject($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'kokpit' }, async $ => {
    await refreshBreakdown($, 'summary').catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'Panel je otvoren.' }
  })

  on('command.run', { command: 'kokpit-analiza' }, async $ => {
    await update($, view, () => 'sesija' as View)
    await $.ui.open({ id: PANE, title: TITLE })
    const text = await runAnalysis($, ai, pragAlata)
    return { text }
  })

  on('command.run', { command: 'kokpit-historija' }, async $ => {
    const hist = await loadHistory($)
    if (!hist.length) return { text: 'Još nema zabilježenih sesija. Sesije se bilježe po završetku.' }
    const rows = hist
      .slice(-15)
      .reverse()
      .map(r => {
        const hit = hitRate({ ...r, steps: r.steps, subSteps: 0 })
        const d = new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' ')
        return `| ${d} | ${r.cwd.split('/').pop()} | ${usd(r.usd)} | ${r.turns} | ${fmt(r.cacheRead + r.cacheWrite + r.input)} | ${fmt(r.output)} | ${pct(hit)} |`
      })
    const sum = hist.reduce((a, r) => a + (r.usd ?? 0), 0)
    return {
      text: ['| Početak | Projekat | Trošak | Poruke | Ulaz | Izlaz | Keš |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, '', `Ukupno: ${hist.length} ${plural(hist.length, 'sesija', 'sesije', 'sesija')}, ${usd(sum)}`].join('\n'),
    }
  })

  on('command.run', { command: 'kokpit-pin' }, async ($, e) => {
    const [url, ...rest] = e.args.trim().split(/\s+/)
    if (!url) {
      const list = await read($, pins)
      return { text: list.length ? list.map((x, i) => `${i + 1}. [${x.title}](${x.url})`).join('\n') : 'Ovaj projekat nema pinovanih artefakata.' }
    }
    await pinUrl($, url, rest.join(' ') || undefined)
    return { text: `Pinovano za projekat ${projectName(await read($, project))}.` }
  })

  // Svaki artefakt objavljen ili otvoren u sesiji ulazi u listu „Iz ove sesije“ na kartici Artefakti.
  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const ran = await next(e)
    const args = e as unknown as Record<string, unknown>
    const text = typeof ran.text === 'string' ? ran.text : ''
    const url = (typeof args.url === 'string' ? args.url : text).match(ARTIFACT_URL)?.[0]
    if (url && (args.action === 'open' || args.action === undefined || args.action === 'publish')) await update($, opened, l => (l.includes(url) ? l : [...l, url]))
    if (url && args.action !== 'delete') {
      const fromText = text.match(/<title>([^<]+)<\/title>/)?.[1] ?? text.match(/[Tt]itle:?\s*"?([^"\n]{2,60})"?/)?.[1]
      const file = typeof args.file_path === 'string' ? args.file_path.split('/').pop()?.replace(/\.(html|md)$/, '') : undefined
      const title = (typeof args.title === 'string' && args.title) || fromText?.trim() || file || 'Artefakt'
      const at = await $.clock.now()
      const isNew = !(await read($, recent)).some(x => x.url === url)
      await update($, recent, list => [{ url, title, at }, ...list.filter(x => x.url !== url)].slice(0, 10))
      if (isNew && !(await read($, pins)).some(x => x.url === url)) $.ui.toast(`Artefakt „${title}“ se može pinovati u Kokpitu, kartica Artefakti.`, { timeoutMs: 6000 })
    }
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, turns, n => n + 1)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r?.usage
    if (u) {
      const now = await $.clock.now()
      const s: StepUsage = {
        turnId: e.turnId,
        index: e.index,
        agentId: e.agentId,
        model: u.model,
        input: u.input_tokens,
        cacheRead: u.cache_read_input_tokens,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        output: u.output_tokens,
        at: now,
      }
      await update($, steps, list => [...list, s].slice(-2000))
      const all = s.input + s.cacheRead + s.cacheWrite
      const w = await read($, warned)
      const n = await read($, turns)
      if (!s.agentId && n > 1 && all > 30000 && s.cacheRead < 0.3 * all && now - w.cacheMissAt > 10 * 60_000) {
        await update($, warned, x => ({ ...x, cacheMissAt: now }))
        $.ui.toast(`Keš nije iskorišten: ${fmt(all - s.cacheRead)} tokena obračunato po punoj cijeni. Najčešći uzrok je duža pauza ili promjena modela.`, { timeoutMs: 8000 })
      }
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const chars = typeof ran.text === 'string' ? ran.text.length : 0
    const isErr = ran.deny !== undefined || ran.isError === true
    const tool = String(e.tool)
    await update($, tools, list => {
      const i = list.findIndex(x => x.tool === tool)
      const cur: ToolStat = list[i] ?? { tool, calls: 0, chars: 0, maxChars: 0, errors: 0 }
      const nx: ToolStat = { tool, calls: cur.calls + 1, chars: cur.chars + chars, maxChars: Math.max(cur.maxChars, chars), errors: cur.errors + (isErr ? 1 : 0) }
      return i >= 0 ? list.map((x, j) => (j === i ? nx : x)) : [...list, nx]
    })
    const args = e as unknown as Record<string, unknown>
    if (tool === 'Read' && typeof args.file_path === 'string') {
      const path = args.file_path
      await update($, repeats, list => {
        const i = list.findIndex(x => x.path === path)
        const old = list[i]
        const nx: RepeatRead = old ? { path, count: old.count + 1, chars: old.chars + chars } : { path, count: 1, chars }
        return (i >= 0 ? list.map((x, j) => (j === i ? nx : x)) : [...list, nx]).slice(-300)
      })
      const again = (await read($, repeats)).find(x => x.path === path)
      if (again?.count === 3 && typeof args.offset !== 'number')
        $.ui.toast(`${path.split('/').pop()} je pročitan treći put, ukupno ${fmt(tok(again.chars))} tokena. Sadržaj je već u kontekstu; ponovno čitanje treba samo nakon izmjene, i to samo izmijenjeni raspon.`, { timeoutMs: 8000 })
    }
    if (tok(chars) > pragAlata) {
      const hc: HeavyCall = { id: e.tool_use_id ?? `${tool}-${chars}`, tool, label: toolLabel(args), chars, at: await $.clock.now() }
      await update($, heavy, list => [...list, hc].slice(-50))
      const ctx = (await read($, measure))?.window
      const share = ctx ? ` (${Math.round((tok(chars) / ctx) * 100)} % konteksta)` : ''
      const tip =
        tool === 'Read' ? 'Za velike fajlove čitati samo potreban raspon linija (offset i limit) ili prvo pretražiti s Grep.'
        : tool === 'Bash' ? 'Ograničiti izlaz komande, npr. | tail -n 40, --quiet ili | grep.'
        : tool === 'Grep' ? 'Suziti pretragu: glob, type ili head_limit, ili samo nazive fajlova.'
        : tool.startsWith('mcp__') ? 'Suziti upit ili tražiti manje polja.'
        : tool === 'WebFetch' ? 'Tražiti samo potreban dio stranice.'
        : 'Suziti upit.'
      $.ui.toast(`${tool} ${hc.label ? `(${hc.label.slice(0, 60)}) ` : ''}je dodao ${fmt(tok(chars))} tokena${share}. ${tip}`, { timeoutMs: 9000 })
    }
    return ran
  })

  on('session.measure', async ($, e, next) => {
    const m: Measure = {
      percent: e.context.percent ?? null,
      tokens: e.context.tokens ?? null,
      window: e.context.window,
      usd: e.cost?.usd ?? null,
      rateLimits: e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt })),
      at: await $.clock.now(),
    }
    await update($, measure, () => m)
    const now = m.at
    if (m.rateLimits.length) {
      const prev = await read($, samples)
      const add = m.rateLimits
        .filter(r => {
          const last = [...prev].reverse().find(x => x.kind === r.kind)
          return !last || last.percent !== r.percentUsed || now - last.at > 2 * 60_000
        })
        .map(r => ({ kind: r.kind, at: now, percent: r.percentUsed }))
      if (add.length) {
        const nx = [...prev, ...add].filter(x => now - x.at < 3 * 3600_000).slice(-400)
        await update($, samples, () => nx)
        await $.store.set('samples', nx)
      }
      const w0 = await read($, warned)
      for (const r of m.rateLimits) {
        const f = forecast(await read($, samples), r.kind, r.percentUsed, r.resetsAt, now)
        if (f.kind === 'puni' && f.etaMs < 30 * 60_000 && now - (w0.limits?.[r.kind] ?? 0) > 60 * 60_000) {
          await update($, warned, x => ({ ...x, limits: { ...(x.limits ?? {}), [r.kind]: now } }))
          $.ui.toast(`${limitName(r.kind).label}: ${f.text.toLowerCase()}. Za lakše zadatke pomaže manji model (/model).`, { timeoutMs: 9000 })
        }
      }
    }
    const bud = await read($, budget)
    const hist = await loadHistory($)
    const ratios = [
      bud.daily ? spent(hist, sessionId, m.usd, periodStart(now, 'daily')) / bud.daily : 0,
      bud.weekly ? spent(hist, sessionId, m.usd, periodStart(now, 'weekly')) / bud.weekly : 0,
    ]
    const blevel = Math.max(...ratios) >= 1 ? 100 : Math.max(...ratios) >= 0.8 ? 80 : 0
    const wb = (await read($, warned)).budget ?? 0
    if (blevel > wb) {
      await update($, warned, x => ({ ...x, budget: blevel }))
      $.ui.toast(blevel === 100 ? 'Budžet je potrošen. Pregled je u Kokpitu, odjeljak Troškovi.' : 'Potrošeno je 80 % budžeta. Pregled je u Kokpitu, odjeljak Troškovi.', { timeoutMs: 9000 })
    } else if (blevel < wb) await update($, warned, x => ({ ...x, budget: blevel }))
    const hit = hitRate(totals(await read($, steps)))
    const parts = [m.percent != null ? `ctx ${m.percent}%` : null, m.usd != null ? usd(m.usd) : null, hit != null ? `keš ${pct(hit)}` : null]
    if (m.percent != null) {
      const w: Warned = await read($, warned)
      const level = m.percent >= 80 ? 80 : m.percent >= 60 ? 60 : 0
      if (level > w.context) {
        await update($, warned, x => ({ ...x, context: level }))
        $.ui.toast(`Kontekst je popunjen ${m.percent} %. Svaki naredni zahtjev šalje ga u cijelosti. Preporučuje se /compact ili nova sesija.`, { timeoutMs: 8000 })
      } else if (level < w.context) {
        await update($, warned, x => ({ ...x, context: level }))
      }
    }
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!('skip' in r) && !e.agentId) await update($, compactions, n => n + 1)
    return r
  })

  on('session.end', async ($, e, next) => {
    const t = totals(await read($, steps))
    if (t.steps > 0) {
      const m = await read($, measure)
      const toolChars = (await read($, tools)).reduce((a, x) => a + x.chars, 0)
      const rec: SessionRecord = {
        id: await $.session.id(),
        cwd: await $.session.cwd(),
        startedAt: sessionStart,
        endedAt: await $.clock.now(),
        usd: m?.usd ?? null,
        turns: await read($, turns),
        steps: t.steps,
        toolCalls: (await read($, tools)).reduce((a, x) => a + x.calls, 0),
        input: t.input,
        cacheRead: t.cacheRead,
        cacheWrite: t.cacheWrite,
        output: t.output,
        toolChars,
        mcpUsed: [...new Set((await read($, tools)).map(x => serverOfTool(x.tool)).filter((x): x is string => !!x))],
      }
      const prevH = (await loadHistory($)).filter(x => x.id !== rec.id)
      await $.store.set(HISTORY, [...prevH, rec].slice(-500))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Select = 'Select' in els ? els.Select : null
    const m = await read($, measure)
    const p = m?.percent ?? null
    const pinned = await read($, pins)
    const nonce = await read($, pickNonce)

    // Traka pokazuje ono što ograničava rad: 5 h i 7 d uvijek, ostale limite i budžet tek kad pređu 80 %.
    const limits = (m?.rateLimits ?? [])
      .filter(r => r.kind === 'five_hour' || r.kind === 'seven_day' || r.percentUsed >= 80)
      .map(r => ({ label: limitName(r.kind).short.replace(/^Limit /, ''), percent: r.percentUsed }))
    const bTop = budgetRows(await read($, budget), await loadHistory($), sessionId, m?.usd ?? null, await $.clock.now()).sort((x, z) => z.percent - x.percent)[0]
    if (bTop && bTop.percent >= 80) limits.push({ label: 'Budžet', percent: Math.round(bTop.percent) })
    const item = (label: string, value: string, tone: Tone) => (
      <Box flexDirection="column" flexShrink={0}>
        <Text size="footnote" dimColor>{label}</Text>
        <Text weight="semibold" tabular color={tone === 'muted' ? undefined : TONE_TEXT[tone]}>{value}</Text>
      </Box>
    )
    // Uska traka: brojke se skupljaju, dugmad nikad; ako ni tad nema mjesta, dugmad prelaze u novi red.
    const isNarrow = e.props.bodyColumns < 90
    return (
      <Box justifyContent="space-between" alignItems="center" columnGap="md" rowGap="xs" flexWrap="wrap">
        <Box alignItems="center" gap="md" flexShrink={1}>
          {item('Kontekst', pctText(p), toneOf(p))}
          {limits.map(l => item(l.label, pctText(l.percent), toneOf(l.percent)))}
          {!isNarrow && item('Trošak', usd(m?.usd), 'muted')}
        </Box>
        <Box alignItems="center" gap="sm" flexShrink={0}>
          {Select && pinned.length > 0 && (
            <Select
              key={`band-pins-${nonce}`}
              value=""
              options={[{ value: '', label: 'Artefakti' }, ...pinned.slice(0, MAX_OPTIONS).map(x => ({ value: x.url, label: x.title }))]}
              onSelect={url => {
                // Nova instanca menija vraća ga na „Artefakti“, pa se isti artefakt može ponovo odabrati.
                void update($, pickNonce, n => n + 1)
                if (url) void openArtifact($, url)
              }}
            />
          )}
          {p != null && p >= 60 && <Button key="band-compact" label="Compact" variant="primary" onPress={() => runCommand($, 'compact')} />}
          <Button key="band-open" label="◔ Kokpit" variant="secondary" onPress={() => togglePane($)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const k = kit($.ui.resolve(e), Math.max(20, e.props.bodyColumns))
    const { Box, Text, Button, Markdown, Input } = k
    const els = $.ui.resolve(e)
    const Select = 'Select' in els ? els.Select : null
    const v0 = await read($, view)
    const v: View = VIEWS.includes(v0) ? v0 : 'sesija'
    const now = await $.clock.now()
    const m = await read($, measure)
    const t = totals(await read($, steps))
    const hit = hitRate(t)
    const NAV = [
      ['sesija', '1', 'Pregled'],
      ['potrosnja', '2', 'Potrošnja'],
      ['troskovi', '3', 'Troškovi'],
      ['artefakti', '4', 'Artefakti'],
    ] as const
    const page = (...body: Child[]) => (
      <Box flexDirection="column">
        {k.tabs(NAV, v, id => void update($, view, () => id))}
        {kids(body)}
      </Box>
    )
    const md = (text: string) => (Markdown ? <Markdown text={text} /> : <Text wrap="wrap">{text}</Text>)
    const figure = (label: string, value: string, tone?: Tone) => (
      <Box flexDirection="column" flexShrink={0}>
        {k.label(label)}
        <Text weight="semibold" tabular color={tone ? TONE_TEXT[tone] : undefined}>{value}</Text>
      </Box>
    )

    if (v === 'sesija') {
      const st = await statusOf($, sessionId, now)
      const lim = (await limitRows($, now)).filter(r => r.kind === 'five_hour' || r.kind === 'seven_day' || r.percent >= 80).slice(0, 3)
      const p = m?.percent ?? null
      const r = await read($, report)
      const isBusy = await read($, busy)
      const pending = await read($, confirm)
      const rec: ActionId | null = p != null && p >= 80 ? 'compact' : p != null && p >= 60 ? 'compact-upute' : null
      return page(
        st.alerts.length > 0 &&
          k.card(
            { title: 'Upozorenja', tone: st.alerts.some(x => x.tone === 'bad') ? 'bad' : 'warn' },
            ...st.alerts.map((a, i) =>
              k.row({
                title: <Text wrap="wrap"><Text color={TONE_TEXT[a.tone]}>● </Text>{a.text}</Text>,
                right: a.fix && k.btn({ key: `alert-${i}`, text: a.fix.label, onPress: () => void a.fix?.run() }),
              }),
            ),
          ),
        k.card(
          { title: 'Stanje' },
          k.gauge({ title: 'Kontekst', value: pctText(p), tone: toneOf(p), percent: p, sub: m?.tokens == null ? 'Brojke nakon prvog odgovora' : `${fmt(m.tokens)} od ${fmt(m.window)} tokena` }),
          ...lim.map(x => k.gauge({ title: x.short ?? x.label, value: pctText(x.percent), tone: toneOf(x.percent), percent: x.percent, sub: x.reset, hint: x.noteColor === C.gray ? undefined : x.note, hintTone: toneFromHex(x.noteColor) })),
        ),
        k.card(
          { title: 'Ova sesija' },
          <Box gap="lg" flexWrap="wrap">
            {figure('Trošak', usd(m?.usd))}
            {figure('Keš', pct(hit), hit != null && t.steps > 3 && hit < 0.6 ? 'warn' : undefined)}
            {figure('Zahtjevi', `${t.steps}`)}
            {figure('Poruke', `${await read($, turns)}`)}
          </Box>,
        ),
        k.card(
          {
            title: 'Analiza sesije',
            description: isBusy ? `Model ${analysisModel.model} (${analysisModel.effort}) čita statistiku i zadnje poruke…` : r ? `Zadnja analiza u ${hhmm(r.at)}` : 'Model pregleda potrošnju i predloži šta promijeniti.',
            action: k.btn({ key: 'run', text: isBusy ? 'Analiza u toku…' : r ? 'Ponovi' : 'Analiziraj', hotkey: 'a', variant: r ? 'secondary' : 'primary', onPress: () => (isBusy ? undefined : void runAnalysis($, ai, pragAlata)) }),
          },
          r?.ai && md(r.ai),
          r?.aiNote && k.note(r.aiNote, 'warn'),
          r && r.tips.length > 0 && (
            <Box flexDirection="column" gap="xs">
              {k.label('Uočeno u statistici')}
              {md(r.tips.map(x => `- ${x}`).join('\n'))}
            </Box>
          ),
          r && !r.ai && r.tips.length === 0 && k.note('Nema uočenih odstupanja. Potrošnja je u očekivanim granicama.'),
        ),
        k.card(
          { title: 'Akcije' },
          ...ACTIONS.map(x => {
            const armed = x.id === 'clear' && pending === 'clear'
            return k.row({
              title: <Text weight="medium" color={x.id === 'clear' ? 'error' : undefined}>{x.title}</Text>,
              sub: armed ? 'Drugi klik briše razgovor.' : x.desc,
              right: k.btn({ key: `act-${x.id}`, text: armed ? 'Confirm' : x.button, hotkey: x.key, variant: x.id === rec || armed ? 'primary' : 'secondary', onPress: () => void runAction($, x.id) }),
            })
          }),
        ),
        k.note('Taster u kućici na dugmetu ga pokreće dok je Kokpit u fokusu.'),
      )
    }

    if (v === 'potrosnja') {
      const b = await read($, breakdown)
      const used = (b?.rows ?? []).filter(x => x.kind === 'used').sort((a, z) => z.tokens - a.tokens).slice(0, 8)
      const parts = used.map((x, i) => ({ label: x.name, value: x.tokens, color: SERIES[i % SERIES.length] ?? C.gray }))
      const list = [...(await read($, tools))].sort((a, z) => z.chars - a.chars).slice(0, 8)
      const sum = list.reduce((a, x) => a + x.chars, 0)
      const hv = await read($, heavy)
      const reps = (await read($, repeats)).filter(x => x.count > 1).sort((a, z) => z.count - a.count)
      const mcp = mcpReport(b, await read($, tools), await loadHistory($))
      return page(
        k.card(
          {
            title: 'Sastav konteksta',
            description: b ? `${fmt(b.total)} od ${fmt(b.max)} tokena · ${b.detail === 'full' ? 'precizno' : 'procjena'}` : 'Prikazuje se nakon prvog zahtjeva ili klika na Osvježi.',
            action: (
              <Box gap="xs">
                <Button key="refresh" label="Osvježi" variant="secondary" onPress={() => refreshBreakdown($, 'summary')} />
                <Button key="full" label="Precizno" plain dimColor onPress={() => refreshBreakdown($, 'full')} />
              </Box>
            ),
          },
          parts.length > 0 && k.stack(parts, b?.total ?? 0),
          ...parts.map(x => k.row({ title: k.dot(x.color, x.label), right: k.value(fmt(x.value)) })),
        ),
        k.card(
          { title: 'Rezultati alata', description: list.length ? `Ukupno približno ${fmt(tok(sum))} tokena` : 'U ovoj sesiji još nije bilo poziva alata.' },
          ...list.map(x => k.barRow({ title: x.tool.replace(/^mcp__/, ''), percent: (x.chars / Math.max(1, list[0]?.chars ?? 1)) * 100, tone: 'accent', value: `${fmt(tok(x.chars))} · ${x.calls}×` })),
        ),
        hv.length > 0 &&
          k.card(
            { title: 'Najveći pojedinačni rezultati', description: `Rezultati iznad ${fmt(pragAlata)} tokena` },
            ...hv.slice(-8).reverse().map(x => k.row({ title: x.tool, sub: x.label || undefined, right: k.value(fmt(tok(x.chars)), 'bad') })),
          ),
        reps.length > 0 &&
          k.card(
            { title: 'Ponovljena čitanja', description: 'Isti fajl pročitan više puta' },
            ...reps.slice(0, 8).map(x => k.row({ title: x.path.split('/').pop() ?? x.path, sub: x.path, right: k.value(`${x.count}×`, 'warn') })),
          ),
        k.card(
          {
            title: 'MCP serveri',
            description: mcp.issues ? `${mcp.issues} ${plural(mcp.issues, 'napomena', 'napomene', 'napomena')}` : 'Učitani u kontekst',
            action: <Button key="act-mcp-open" label="Upravljaj" variant="secondary" onPress={() => runCommand($, 'mcp')} />,
          },
          ...mcp.duplicates.map(d => k.note(`Duplikat: ${serverLabel(d.a)} i ${serverLabel(d.b)} dijele ${d.shared} alata. Jedan se može isključiti.`, 'warn')),
          mcp.unused.length > 0 && k.note(`Nekorišteni u zadnjih ${mcp.sessions} sesija: ${mcp.unused.map(serverLabel).join(', ')}`, 'warn'),
          ...mcp.loaded.map(x => k.row({ title: x.label, right: k.value(x.note) })),
          mcp.loaded.length === 0 && k.note('Brojke se pojavljuju nakon klika na Osvježi.'),
        ),
      )
    }

    if (v === 'artefakti') {
      const list = await read($, pins)
      const name = projectName(await read($, project))
      const lib = await read($, library)
      const mode = await read($, adding)
      const isLinking = await read($, linking)
      const q = (await read($, libQuery)).trim().toLowerCase()
      const pinned = new Set(list.map(x => x.url))
      const suggested = (await read($, recent)).filter(x => !pinned.has(x.url)).slice(0, 3)
      const free = (lib ?? []).filter(x => !pinned.has(x.url))
      const matching = q ? free.filter(x => x.title.toLowerCase().includes(q)) : free
      const SHOWN = 8
      const remove = (url: string) => void setHidden($, url, true).then(() => savePins($, l => l.filter(y => y.url !== url)))
      const startAdding = (m: 'lib' | 'link') => {
        void update($, adding, () => (mode === m ? null : m))
        if (m === 'lib' && lib == null) void loadLibrary($)
      }

      // Jedan pin je jedan red: klik na naziv otvara artefakt, × ga uklanja.
      const pinRow = (x: Pin, i: number) => (
        <Box justifyContent="space-between" alignItems="center" gap="sm">
          <Button key={`pin-open-${i}`} hotkey={i < 9 ? String(i + 1) : undefined} plain onPress={() => void openArtifact($, x.url)}>
            {x.title}
          </Button>
          <Box gap="xs" flexShrink={0}>
            {i > 0 && <Button key={`pin-up-${i}`} label="↑" plain dimColor onPress={() => void savePins($, l => [...l.slice(0, i - 1), l[i]!, l[i - 1]!, ...l.slice(i + 1)])} />}
            <Button key={`pin-del-${i}`} label="×" plain dimColor onPress={() => remove(x.url)} />
          </Box>
        </Box>
      )
      const addRow = (x: Pin, key: string) =>
        k.row({ title: x.title, right: k.btn({ key, text: '+ Pinuj', onPress: () => void pinUrl($, x.url, x.title) }) })

      return page(
        k.card(
          { title: name === 'sesija bez foldera' ? 'Artefakti ove sesije' : `Artefakti · ${name}`, description: list.length ? 'Klik na naziv otvara artefakt; lista je ista u svakoj sesiji ovog projekta.' : undefined },
          list.length === 0 && k.note(isLinking ? 'Tražim artefakte iz ranijih razgovora ovog projekta…' : 'Još nema artefakata. Oni iz ranijih razgovora ovog projekta dodaju se sami, a ostale dodaj ispod.'),
          ...list.map(pinRow),
        ),
        suggested.length > 0 &&
          k.card({ title: 'Iz ove sesije', description: 'Artefakti koje je Claude objavio ili otvorio u ovom razgovoru.' }, ...suggested.map((x, i) => addRow(x, `recent-pin-${i}`))),
        <Box gap="xs" marginBottom="sm" flexWrap="wrap">
          {k.btn({ key: 'add-lib', text: '+ Iz biblioteke', variant: mode === 'lib' ? 'primary' : 'secondary', onPress: () => startAdding('lib') })}
          {k.btn({ key: 'add-link', text: '+ Link', variant: mode === 'link' ? 'primary' : 'secondary', onPress: () => startAdding('link') })}
          <Button key="link-project" label={isLinking ? 'Povezujem…' : 'Ponovo poveži iz projekta'} plain dimColor onPress={() => (isLinking ? undefined : void linkProject($).then(n => (n ? undefined : $.ui.toast('Nema novih artefakata iz ovog projekta.'))))} />
        </Box>,
        mode === 'lib' &&
          k.card(
            { title: 'Biblioteka' },
            lib == null
              ? k.note('Učitavam tvoje artefakte…')
              : Input
                ? <Input key="lib-search" placeholder="Traži po nazivu" value={q} submitLabel="Traži" onInput={x => void update($, libQuery, () => x)} onSubmit={x => void update($, libQuery, () => x)} />
                : null,
            ...matching.slice(0, SHOWN).map((x, i) => addRow(x, `lib-pin-${i}`)),
            lib != null && matching.length === 0 && k.note(free.length ? 'Nijedan artefakt ne odgovara pretrazi.' : 'Svi artefakti iz biblioteke su već pinovani.'),
            matching.length > SHOWN && k.note(`Još ${matching.length - SHOWN}; upiši dio naziva da suziš listu.`),
          ),
        mode === 'link' &&
          k.card(
            { title: 'Dodaj link' },
            Input ? (
              <Input key="pin-add" placeholder="https://claude.ai/artifact/…" value="" submitLabel="Pinuj" autoFocus onSubmit={x => void pinUrl($, x).then(() => update($, adding, () => null))} />
            ) : (
              k.note('U terminalu: /kokpit-pin <link> [naziv]')
            ),
          ),
      )
    }

    const hist = await loadHistory($)
    const bud = await read($, budget)
    const bRows = budgetRows(bud, hist, sessionId, m?.usd ?? null, now)
    const weeks = byWeek(hist, now, 8)
    const maxW = Math.max(0.01, ...weeks.map(w => w.usd))
    const projects = byProject(hist).slice(0, 8)
    const total = hist.reduce((a, r) => a + (r.usd ?? 0), 0)
    const setBudget = async (key: keyof Budget, value: string) => {
      const n = Number(value.replace(',', '.').replace(/[^0-9.]/g, ''))
      const nx = { ...bud, [key]: Number.isFinite(n) && n > 0 ? n : null }
      await update($, budget, () => nx)
      await update($, warned, x => ({ ...x, budget: 0 }))
      await $.store.set('budget', nx)
    }
    const sessions = (n: number) => `${n} ${plural(n, 'sesija', 'sesije', 'sesija')}`
    return page(
      k.grid(
        k.stat({ title: 'Ova sesija', value: usd(m?.usd) }),
        k.stat({ title: 'Ukupno', value: usd(total), sub: sessions(hist.length) }),
        k.stat({ title: 'Prosjek', value: hist.length ? usd(total / hist.length) : '—', sub: 'po sesiji' }),
      ),
      k.card(
        { title: 'Budžet', description: bRows.length ? 'Traka požuti na 80 % i pocrveni kad se budžet potroši.' : 'Budžet nije postavljen. Upisati iznos u dolarima.' },
        ...bRows.map(r => (
          <Box flexDirection="column" gap="xs">
            {k.row({ title: r.label, right: k.value(r.hint, toneOf(r.percent)) })}
            {k.bar(r.percent, toneOf(r.percent))}
            {k.note(r.reset)}
          </Box>
        )),
        Input ? (
          <Input key="budget-daily" label="Dnevni budžet ($)" placeholder="npr. 10, prazno za bez budžeta" value={bud.daily != null ? String(bud.daily) : ''} submitLabel="Spremi" onSubmit={x => void setBudget('daily', x)} />
        ) : (
          k.note('Budžet se postavlja u aplikaciji na računaru ili u terminalu.')
        ),
        Input && <Input key="budget-weekly" label="Sedmični budžet ($)" placeholder="npr. 50, prazno za bez budžeta" value={bud.weekly != null ? String(bud.weekly) : ''} submitLabel="Spremi" onSubmit={x => void setBudget('weekly', x)} />,
      ),
      ...(hist.length === 0
        ? [k.card({ title: 'Historija', description: 'Sesije se bilježe po završetku. Prva stavka pojavit će se nakon što se ova sesija zatvori.' })]
        : [
            k.card({ title: 'Po sedmicama' }, ...weeks.map(w => k.barRow({ title: w.label, percent: (w.usd / maxW) * 100, tone: 'accent', value: usd(w.usd) }))),
            k.card({ title: 'Po projektima' }, ...projects.map(x => k.barRow({ title: x.name, percent: (x.usd / Math.max(0.01, projects[0]?.usd ?? 0)) * 100, tone: 'accent', value: usd(x.usd) }))),
            k.card(
              { title: 'Zadnje sesije' },
              ...hist
                .slice(-10)
                .reverse()
                .map(r =>
                  k.row({
                    title: r.cwd.includes('scratch-workspaces') ? 'bez foldera' : (r.cwd.split('/').pop() ?? r.cwd),
                    sub: new Date(r.startedAt).toISOString().slice(0, 16).replace('T', ' '),
                    right: k.value(usd(r.usd)),
                  }),
                ),
            ),
          ]),
    )
  })
}
