import { expect, mock, test } from 'claude-code/testing'

import { LIBRARY_TEXT } from './library.fixture'
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
  await desk.press({ key: 'run' })
  expect(await desk.find({ type: 'Text', text: /Zadnja analiza u/ })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: /nakon prvog odgovora/ })).toBeDefined()
})

test('pinovani artefakt se vidi na kartici Artefakti i u traci', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('session.cwd', () => ({ value: '/p/projekt' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
  await $.command.run({ command: 'kokpit-pin', args: 'https://claude.ai/artifact/abc-123 Plan projekta' })
  const desk = await $.ui.mount({ plugin: 'kokpit', surface: 'desktop', ...PANE })
  await desk.press({ key: 'tab-artefakti' })
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
  await desk.press({ key: 'tab-artefakti' })
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
  await desk.press({ key: 'tab-artefakti' })
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
  await desk.press({ key: 'tab-artefakti' })
  calls.length = 0
  await desk.press({ key: 'pin-open-0' })
  await desk.press({ key: 'pin-open-0' })
  expect(calls).toEqual(['panel', 'open'])
})
