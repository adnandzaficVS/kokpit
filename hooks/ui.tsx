import type { ElementTable, RenderElement } from 'claude-code'

import { barSvg, stackSvg, TONE_HEX, TONE_TEXT } from './charts'
import type { Tone } from './charts'

// Mali dizajn-sistem Kokpita: kartice, statistike, redovi i trake, svi s istom tipografskom skalom.
//   naslov kartice  body / semibold
//   opis, natpis    footnote / dim
//   tekst           body
//   velika brojka   title / semibold / tabular

export type Child = RenderElement | string | false | null | undefined
export const kids = (c: readonly Child[]) => c.filter((x): x is RenderElement | string => x !== false && x != null && x !== '')

export const kit = (els: ElementTable, columns: number) => {
  const { Box, Text, Button } = els
  const Svg = 'Svg' in els ? els.Svg : null
  const Markdown = 'Markdown' in els ? els.Markdown : null
  const Input = 'Input' in els ? els.Input : null

  const label = (text: string) => <Text size="footnote" dimColor>{text}</Text>
  const note = (text: string, tone?: Tone) =>
    tone ? <Text size="footnote" color={TONE_TEXT[tone]} wrap="wrap">{text}</Text> : <Text size="footnote" dimColor wrap="wrap">{text}</Text>

  const bar = (percent: number | null, tone: Tone, cells = Math.max(8, Math.min(28, columns - 30))) => {
    if (Svg) return <Svg source={barSvg(percent, TONE_HEX[tone])} alt={`${Math.round(percent ?? 0)} %`} height={6} />
    const n = Math.round((Math.max(0, Math.min(100, percent ?? 0)) / 100) * cells)
    return (
      <Text>
        <Text color={TONE_TEXT[tone]}>{'█'.repeat(n)}</Text>
        <Text dimColor>{'░'.repeat(cells - n)}</Text>
      </Text>
    )
  }

  const stack = (parts: readonly { value: number; color: string }[], total: number) =>
    Svg ? <Svg source={stackSvg(parts, total)} alt="Sastav konteksta" height={10} /> : null

  const card = (o: { title: string; description?: string; action?: Child; tone?: Tone }, ...body: Child[]) => (
    <Box flexDirection="column" borderStyle="round" borderDimColor={!o.tone} borderColor={o.tone ? TONE_TEXT[o.tone] : undefined} paddingX="md" paddingY="sm" gap="xs" marginBottom="sm">
      <Box justifyContent="space-between" alignItems="center" gap="sm">
        <Box flexDirection="column" flexShrink={1}>
          <Text weight="semibold" color={o.tone ? TONE_TEXT[o.tone] : undefined}>{o.title}</Text>
          {o.description ? note(o.description) : null}
        </Box>
        {o.action || null}
      </Box>
      {kids(body)}
    </Box>
  )

  // Mjerač u jednom redu: natpis lijevo, vrijednost desno, traka i jedan red objašnjenja ispod.
  const gauge = (o: { title: string; value: string; tone: Tone; percent: number | null; sub?: string; hint?: string; hintTone?: Tone }) => (
    <Box flexDirection="column">
      <Box justifyContent="space-between" alignItems="center" gap="sm">
        <Text>{o.title}</Text>
        <Text weight="semibold" tabular color={o.tone === 'muted' ? undefined : TONE_TEXT[o.tone]}>{o.value}</Text>
      </Box>
      {bar(o.percent, o.tone)}
      {o.sub || o.hint ? (
        <Text size="footnote" wrap="wrap">
          {o.sub ? <Text dimColor>{o.sub}</Text> : null}
          {o.sub && o.hint ? <Text dimColor> · </Text> : null}
          {o.hint ? <Text color={o.hintTone ? TONE_TEXT[o.hintTone] : undefined}>{o.hint}</Text> : null}
        </Text>
      ) : null}
    </Box>
  )

  // Statistika za red kartica (Troškovi): natpis i brojka.
  const stat = (o: { title: string; value: string; sub?: string }) => (
    <Box flexDirection="column" flexGrow={1} minWidth={12} borderStyle="round" borderDimColor paddingX="md" paddingY="sm">
      {label(o.title)}
      <Text size="heading" weight="semibold" tabular>{o.value}</Text>
      {o.sub ? note(o.sub) : null}
    </Box>
  )

  // Dugme s prečicom; aplikacija sama crta značku s tasterom.
  const btn = (o: { key: string; text: string; hotkey?: string; variant?: 'primary' | 'secondary'; plain?: boolean; onPress: () => void }) =>
    o.plain ? (
      <Button key={o.key} hotkey={o.hotkey} plain dimColor onPress={o.onPress}>
        {o.text}
      </Button>
    ) : (
      <Button key={o.key} hotkey={o.hotkey} variant={o.variant ?? 'secondary'} onPress={o.onPress}>
        {o.text}
      </Button>
    )

  const grid = (...items: Child[]) => (
    <Box flexDirection="row" flexWrap="wrap" gap="sm" marginBottom="sm">
      {kids(items)}
    </Box>
  )

  // Red liste: naslov i opis lijevo, vrijednost ili dugme desno.
  const row = (o: { title: Child; sub?: string; right?: Child; key?: string }) => (
    <Box justifyContent="space-between" alignItems="center" gap="md">
      <Box flexDirection="column" flexShrink={1}>
        {typeof o.title === 'string' ? <Text wrap="truncate-end">{o.title}</Text> : o.title}
        {o.sub ? note(o.sub) : null}
      </Box>
      {o.right ?? null}
    </Box>
  )

  // Red s trakom: natpis, traka koja se širi i vrijednost.
  const barRow = (o: { title: string; percent: number; tone: Tone; value: string }) => (
    <Box alignItems="center" gap="md">
      <Box width={14} flexShrink={0}>
        <Text wrap="truncate-end">{o.title}</Text>
      </Box>
      <Box flexGrow={1}>{bar(o.percent, o.tone)}</Box>
      <Box width={12} flexShrink={0} justifyContent="flex-end">
        <Text tabular dimColor>{o.value}</Text>
      </Box>
    </Box>
  )

  const value = (text: string, tone?: Tone) => <Text tabular color={tone ? TONE_TEXT[tone] : undefined}>{text}</Text>

  const dot = (color: string, text: string) => (
    <Text wrap="truncate-end">
      <Text color={color}>● </Text>
      {text}
    </Text>
  )

  const tabs = <T extends string>(items: readonly (readonly [T, string, string])[], active: T, go: (id: T) => void) => (
    <Box gap="xs" marginBottom="sm" flexWrap="wrap">
      {items.map(([id, key, text]) =>
        btn({ key: `tab-${id}`, text, hotkey: key, plain: id !== active, onPress: () => (id === active ? undefined : go(id)) }),
      )}
    </Box>
  )

  return { Box, Text, Button, Svg, Markdown, Input, label, note, bar, stack, card, gauge, stat, btn, grid, row, barRow, value, dot, tabs }
}
