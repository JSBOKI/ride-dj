export interface LyricLine {
  /** Source seconds (position in the original track). */
  time: number
  text: string
  /** Section header like "Chorus" that this line belongs to. */
  section?: string
}

export interface Lyrics {
  lines: LyricLine[]
  /** "lrc" has exact timings; "spread" is estimated from plain text. */
  timing: "lrc" | "spread"
}

const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

/** Parses LRC: "[mm:ss.xx] text", several time tags per line allowed, plus [offset:+/-ms]. */
export function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = []
  let offset = 0
  const offsetMatch = text.match(/\[offset:\s*([+-]?\d+)\s*\]/i)
  if (offsetMatch) offset = Number(offsetMatch[1]) / 1000
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC_TIME)]
    if (stamps.length === 0) continue
    const content = raw.replace(LRC_TIME, "").replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").trim()
    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2].replace(":", "."))
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue
      lines.push({ time: Math.max(0, minutes * 60 + seconds + offset), text: content })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

export function looksLikeLrc(text: string | undefined): boolean {
  if (!text) return false
  return (text.match(LRC_TIME)?.length ?? 0) >= 2
}

/**
 * Spreads untimed lyrics over the part of the song that has vocals, weighted
 * by line length. Section tags like [Chorus] become headers, not lines.
 */
export function spreadLyrics(text: string, vocal: { start: number; end: number }): LyricLine[] {
  const entries: { text: string; section?: string }[] = []
  let section: string | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const tag = line.match(/^\[([^\]]+)\]$/)
    if (tag) {
      section = tag[1]
      continue
    }
    entries.push({ text: line, ...(section ? { section } : {}) })
  }
  if (entries.length === 0) return []
  const weights = entries.map((entry) => 2 + Math.min(40, [...entry.text].length) / 4)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const span = Math.max(1, vocal.end - vocal.start)
  let cursor = vocal.start
  return entries.map((entry, index) => {
    const line = { time: cursor, ...entry }
    cursor += (weights[index] / total) * span
    return line
  })
}

/** Vocals usually start after an intro and stop before an outro. */
export function guessVocalSpan(duration: number, beatBar = 2): { start: number; end: number } {
  const start = Math.min(duration * 0.12, Math.max(beatBar * 4, 8))
  const end = Math.max(start + 10, duration - Math.min(duration * 0.12, 24))
  return { start, end }
}

export function buildLyrics(input: { lrc?: string; text?: string; duration: number; bar?: number }): Lyrics | null {
  if (input.lrc && looksLikeLrc(input.lrc)) {
    const lines = parseLrc(input.lrc)
    if (lines.length > 0) return { lines, timing: "lrc" }
  }
  if (input.text && looksLikeLrc(input.text)) {
    const lines = parseLrc(input.text)
    if (lines.length > 0) return { lines, timing: "lrc" }
  }
  if (input.text && input.text.trim()) {
    const lines = spreadLyrics(input.text, guessVocalSpan(input.duration, input.bar))
    if (lines.length > 0) return { lines, timing: "spread" }
  }
  return null
}

/** Index of the line being sung at a source time (-1 before the first line). */
export function lineAt(lines: LyricLine[], sourceTime: number): number {
  let low = 0
  let high = lines.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].time <= sourceTime + 1e-6) {
      found = mid
      low = mid + 1
    } else high = mid - 1
  }
  return found
}
