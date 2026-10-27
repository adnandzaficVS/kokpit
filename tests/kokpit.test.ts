import { expect, mock, test } from 'claude-code/testing'

import { LIBRARY_TEXT } from './library.fixture'
import { cacheState } from '../hooks/register'
import { analyze, byProject, forecast, mcpDuplicates, spent } from '../hooks/lib'

// Ulazi su izdvojeni jer TypeScript ne može izvesti tip preopterećenog $.tool.call za doslovne objekte.
const READ_A = { tool: 'Read', file_path: '/p/a.ts' } as never
const BASH_LS = { tool: 'Bash', command: 'ls' } as never

const PANE = {
  component: 'Pane' as const,
  requestId: 'kokpit',
  props: { title: 'Tokeni', isFocused: true, bodyColumns: 80, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

test('teški Read upozorava i pojavljuje se u kartici Alati', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  const big = { result: { ok: true }, text: 'x'.repeat(48_000) }
  on('tool.call', () => big)

  await $.tool.call(READ_A)
  await $.tool.call(READ_A)

  expect(toasts.length).toBe(2)
  expect(toasts[0]).toContain('12.0k')
  expect(toasts[0]).toContain('offset i limit')

  const term = await $.ui.mount({ plugin: 'kokpit', surface: 'terminal', ...PANE })
  await term.press({ key: 'tab-potrosnja' })
  expect(await term.find({ type: 'Text', text: /Rezultati alata|Read/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /\/p\/a\.ts/ })).toBeDefined()

  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.press({ key: 'tab-troskovi' })
  expect(await desk.find({ type: 'Text', text: /Sesije se bilježe po završetku/ })).toBeDefined()
  await desk.press({ key: 'tab-sesija' })
  expect(await desk.find({ key: 'act-compact' })).toBeDefined()
})

test('mali rezultat ne pravi upozorenje', async ($, on) => {
  mock.clock(on)
  const toasts: string[] = []
  on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }))
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  await $.tool.call(BASH_LS)
  expect(toasts).toEqual([])
})

test('analiza preporučuje kad je keš slab i kontekst pun', async () => {
  const step = (cacheRead: number) => ({ turnId: 't', index: 0, model: 'm', input: 50_000, cacheRead, cacheWrite: 10_000, output: 500, at: 0 })
  const r = analyze({
    steps: [step(1000), step(1000), step(1000), step(1000), step(1000)],
    tools: [{ tool: 'Read', calls: 10, chars: 400_000, maxChars: 80_000, errors: 0 }],
    heavy: [],
    repeats: [{ path: '/p/a.ts', count: 4, chars: 1 }],
    measure: { percent: 85, tokens: 170_000, window: 200_000, usd: 3.2, rateLimits: [], at: 0 },
    breakdown: null,
    turns: 5,
    compactions: 0,
    history: [],
    pragAlata: 8000,
  })
  expect(r.markdown).toContain('Nizak udio keša')
  expect(r.markdown).toContain('Kontekst je popunjen 85 %')
  expect(r.markdown).toContain('Čitanje fajlova')
  expect(r.markdown).toContain('a.ts (4×)')
})

test('traka ima Kokpit i nema dugme za smanjivanje', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } }
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, ...BAND })
    expect(await ui.find({ key: 'band-open' })).toBeDefined()
    expect(await ui.find({ key: 'band-collapse' })).toBeUndefined()
  }
})

test('prognoza limita prema tempu zadnjeg sata', async () => {
  const now = Date.parse('2026-10-27T12:00:00Z')
  const s = [{ kind: 'five_hour', at: now - 20 * 60_000, percent: 40 }]
  const reset = new Date(now + 4 * 3600_000).toISOString()
  const f = forecast(s, 'five_hour', 60, reset, now)
  expect(f.kind).toBe('puni')
  expect(f.text).toContain('40 min')
  expect(forecast(s, 'five_hour', 41, reset, now).kind).toBe('mirno')
  expect(forecast([], 'five_hour', 41, reset, now).kind).toBe('nepoznato')
})

test('budžet sabira završene sesije i ovu', async () => {
  const rec = (id: string, endedAt: number, usd: number) => ({ id, cwd: '/a/projekt', startedAt: endedAt - 1, endedAt, usd, turns: 1, steps: 1, toolCalls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, toolChars: 0 })
  const h = [rec('x', 100, 2), rec('y', 5, 7), rec('cur', 200, 99)]
  expect(spent(h, 'cur', 1.5, 50)).toBe(3.5)
  expect(byProject(h)[0]?.name).toBe('projekt')
})

test('duplikati MCP servera', async () => {
  const tools = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap(n => [
    { name: `mcp__shop__${n}`, serverName: 'shop' },
    { name: `mcp__plugin_shop__${n}`, serverName: 'plugin:shop' },
  ])
  expect(mcpDuplicates([...tools, { name: 'mcp__kicad__x', serverName: 'kicad' }])).toEqual([{ a: 'shop', b: 'plugin:shop', shared: 6 }])
})

test('analiza se prikazuje na kartici Pregled', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  expect(await desk.find({ type: 'Text', text: /Model pregleda potrošnju/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /Analiza modela je dostupna/ })).toBeUndefined()
  await desk.press({ key: 'run' })
  expect(await desk.find({ type: 'Text', text: /Zadnja analiza u/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /Analiza modela je dostupna/ })).toBeDefined()
})

test('pinovani artefakt se vidi na kartici Artefakti i u traci', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/p/projekt' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await $.command.run({ command: 'kokpit-pin', args: 'https://claude.ai/artifact/abc-123 Plan projekta' })
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-postavke' })
  expect(await desk.find({ type: 'Button', text: /Plan projekta/ })).toBeDefined()
  expect(await desk.find({ key: 'pin-open-0' })).toBeDefined()
  const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } }
  const band = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...BAND })
  expect(await band.find({ key: 'band-pins-0' })).toBeDefined()
  await band.select({ key: 'band-pins-0', value: 'https://claude.ai/artifact/abc-123' })
  expect(await band.find({ key: 'band-pins-1' })).toBeDefined()
})

test('biblioteka se čita i nudi za pinovanje', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/p/projekt' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', { tool: 'Artifact' }, () => ({
    result: {},
    text: 'Showing 2 of 2 published artifacts:\n- (mine) Plan A — https://claude.ai/artifact/AAA111 — updated 2026-10-27\n- (mine, pinned) Plan B — https://claude.ai/artifact/BBB222 — updated 2026-10-20',
  }))
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-postavke' })
  await desk.press({ key: 'add-lib' })
  expect(await desk.find({ key: 'lib-pin-1' })).toBeDefined()
  await desk.press({ key: 'lib-pin-1' })
  expect(await desk.find({ type: 'Button', text: /Plan B/ })).toBeDefined()
  expect(await desk.find({ key: 'pin-open-0' })).toBeDefined()
})

test('velika biblioteka se crta bez greške', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/p/projekt' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  on('tool.call', { tool: 'Artifact' }, () => ({ result: {}, text: LIBRARY_TEXT }))
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-postavke' })
  await desk.press({ key: 'add-lib' })
  expect(await desk.find({ type: 'Text', text: /Još 72/ })).toBeDefined()
  await desk.input({ key: 'lib-search', text: 'gripper' })
  expect(await desk.find({ type: 'Text', text: /Još 2/ })).toBeDefined()
})

test('drugo otvaranje istog artefakta ide u preglednik', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const calls: string[] = []
  on('tool.call', { tool: 'Artifact' }, () => (calls.push('panel'), { result: {}, text: 'Opened the Artifact at https://claude.ai/artifact/abc-123 for the user.' }))
  on('process.run', (_$, e) => (calls.push(String((e as { argv: string[] }).argv[0])), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('session.cwd', () => ({ value: '/p/projekt' }))
  await $.command.run({ command: 'kokpit-pin', args: 'https://claude.ai/artifact/abc-123 Plan' })
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-postavke' })
  calls.length = 0
  await desk.press({ key: 'pin-open-0' })
  await desk.press({ key: 'pin-open-0' })
  expect(calls).toEqual(['panel', 'open'])
})

test('pametno sažimanje koristi model iz postavki i ne siječe upute', { options: { sazimanjeModel: 'opus', sazimanjeNapor: 'medium' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const long = Array.from({ length: 60 }, (_, i) => `stavka ${i}`).join('; ')
  const asked: { model: string; effort?: string; maxTokens?: number }[] = []
  let filled = ''
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Radimo na Kokpitu' }] }) as never)
  on('model.complete', (_$, e) => (asked.push({ model: e.model, effort: e.effort, maxTokens: e.maxTokens }), { value: { isAnswered: true, text: long, usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.fill', (_$, e) => ((filled = (e as { text: string }).text), { isFilled: true }) as never)
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'act-compact-upute' })
  expect(asked[0]).toEqual({ model: 'opus', effort: 'medium', maxTokens: 8000 })
  expect(filled).toBe(`/compact Zadržati: ${long}`)
})

test('kartica Postavke mijenja model za Smart compact', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const asked: { model: string; effort?: string }[] = []
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Radimo na Kokpitu' }] }) as never)
  on('model.complete', (_$, e) => (asked.push({ model: e.model, effort: e.effort }), { value: { isAnswered: true, text: 'zadatak', usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('ui.toast', () => ({ value: undefined }))
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-postavke' })
  await desk.select({ key: 'set-compact-model', value: 'haiku' })
  await desk.select({ key: 'set-compact-effort', value: 'high' })
  await desk.press({ key: 'tab-sesija' })
  await desk.press({ key: 'act-compact-upute' })
  expect(asked[0]).toEqual({ model: 'haiku', effort: 'high' })
})

test('Prompt: prvo pitanja, pa prijedlog koji ide u polje za unos', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const prompts: string[] = []
  let filled = ''
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Radimo na izvještajima' }] }) as never)
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const text = prompts.length === 1 ? 'Evo: {"pitanja": ["Koji format datuma?"]}' : '{"prompt": "Dodaj izvoz izvještaja u PDF s datumom u formatu DD.MM.YYYY."}'
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('prompt.fill', (_$, e) => ((filled = (e as { text: string }).text), { isFilled: true }) as never)
  on('ui.toast', () => ({ value: undefined }))
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-prompt' })
  await desk.input({ key: 'prompt-draft', text: 'Izvoz u PDF', kind: 'change' })
  await desk.press({ key: 'prompt-run' })
  expect(prompts[0]).toContain('Dosadašnji razgovor')
  expect(await desk.find({ type: 'Text', text: /Koji format datuma/ })).toBeDefined()
  await desk.input({ key: 'prompt-a-0', text: 'DD.MM.YYYY', kind: 'change' })
  await desk.press({ key: 'prompt-continue' })
  expect(prompts[1]).toContain('Odgovor: DD.MM.YYYY')
  await desk.press({ key: 'prompt-use' })
  expect(filled).toContain('PDF')
})

test('Pregled: upozorenja skupljena, trošak se otvara klikom', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  expect(await desk.find({ type: 'Text', text: /^Poruke$/ })).toBeUndefined()
  await desk.press({ key: 'cost' })
  expect(await desk.find({ type: 'Text', text: /^Poruke$/ })).toBeDefined()
  await desk.press({ key: 'fold-state' })
  expect(await desk.find({ key: 'cost' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /^Poruke$/ })).toBeUndefined()
})

test('Prompt: analiza promptova iz ove sesije', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let sent = ''
  on('session.messages', () => ({ value: [{ role: 'user', text: 'popravi bug' }, { role: 'assistant', text: 'ok' }] }) as never)
  on('model.complete', (_$, e) => ((sent = e.prompt), { value: { isAnswered: true, text: '## Šta poboljšati\n- Navesti fajl.', usage: { input_tokens: 1, output_tokens: 1 } } }) as never)
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-prompt' })
  await desk.press({ key: 'review-run' })
  expect(sent).toContain('popravi bug')
  expect(sent).not.toContain('ok')
  expect(await desk.find({ type: 'Markdown', text: /Navesti fajl/ })).toBeDefined()
})

test('keš u traci: odbrojavanje i boje', async () => {
  const step = (at: number, agentId?: string) => ({ turnId: 't', index: 0, model: 'm', input: 1, cacheRead: 1, cacheWrite: 0, output: 1, at, agentId })
  expect(cacheState([], 60, 0)).toEqual({ value: '—', tone: 'muted' })
  expect(cacheState([step(0)], 60, 10 * 60_000)).toEqual({ value: '50 min', tone: 'ok' })
  expect(cacheState([step(0)], 60, 55 * 60_000)).toEqual({ value: '5 min', tone: 'warn' })
  expect(cacheState([step(0)], 5, 6 * 60_000)).toEqual({ value: 'istekao', tone: 'bad' })
  expect(cacheState([step(0), step(50 * 60_000, 'sub')], 60, 61 * 60_000).tone).toBe('bad')
})

test('uska traka i telefon: akcije u drugom redu', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const band = (bodyColumns: number) => ({ component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 4 }, view: {} } })
  for (const [surface, cols] of [['desktop', 70], ['mobile', 120], ['desktop', 120]] as const) {
    const ui = await $.ui.mount({ plugin: 'kokpit', surface, ...band(cols) })
    expect(await ui.find({ key: 'band-open' })).toBeDefined()
  }
})

test('traka bez podataka pokazuje jednu rečenicu umjesto crtica', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const BAND = { component: 'AbovePrompt' as const, props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 60, scroll: { offset: 0, bodyRows: 3 }, view: {} } }
  const ui = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...BAND })
  expect(await ui.find({ type: 'Text', text: /nakon prve poruke/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^—$/ })).toBeUndefined()
})
