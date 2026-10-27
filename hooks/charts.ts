// Grafika bez teksta: svaki natpis crta nativni Text, pa su fontovi isti u cijelom Kokpitu.

export const C = {
  orange: '#d97757',
  blue: '#4f8fd8',
  green: '#4caf7d',
  amber: '#e0a83a',
  red: '#d9534f',
  violet: '#8b6fd6',
  teal: '#3aa6a0',
  gray: '#9a9a9a',
  track: 'rgba(128,128,128,0.22)',
}
export const SERIES = [C.orange, C.blue, C.green, C.violet, C.teal, C.amber, C.red, C.gray]

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent'

// Ista boja za tekst (tema) i za traku (hex).
export const TONE_TEXT: Record<Tone, string> = { ok: 'success', warn: 'warning', bad: 'error', muted: 'subtle', accent: 'claude' }
export const TONE_HEX: Record<Tone, string> = { ok: C.green, warn: C.amber, bad: C.red, muted: C.gray, accent: C.orange }

export const toneOf = (p: number | null) => (p == null ? 'muted' : p >= 80 ? 'bad' : p >= 60 ? 'warn' : 'ok') as Tone
export const levelColor = (p: number | null) => TONE_HEX[toneOf(p)]

export const barSvg = (percent: number | null, color: string) => {
  const f = Math.max(0, Math.min(1, (percent ?? 0) / 100))
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 4" preserveAspectRatio="none" width="100%" height="6">` +
    `<rect x="0" y="0" width="100" height="4" rx="2" fill="${C.track}"/>` +
    (f > 0 ? `<rect x="0" y="0" width="${Math.max(2, f * 100).toFixed(2)}" height="4" rx="2" fill="${color}"/>` : '') +
    `</svg>`
}

export const stackSvg = (parts: readonly { value: number; color: string }[], total: number) => {
  const sum = Math.max(1, total)
  let x = 0
  const segs = parts
    .map(p => {
      const w = (p.value / sum) * 100
      const s = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0, w - 0.4).toFixed(2)}" height="4" fill="${p.color}"/>`
      x += w
      return s
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 4" preserveAspectRatio="none" width="100%" height="10">` +
    `<rect x="0" y="0" width="100" height="4" fill="${C.track}"/>${segs}</svg>`
}
