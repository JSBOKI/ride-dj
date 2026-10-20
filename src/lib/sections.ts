import type { Section } from "./types.ts"

/**
 * Bar-sized RMS windows, split where the level jumps, then merged so a
 * section is at least eight bars when the track is long enough.
 */
export function detectSections(
  samples: Float32Array,
  sampleRate: number,
  bpm: number,
  beatOffset: number,
): Section[] {
  const duration = samples.length / sampleRate
  if (duration <= 0 || !Number.isFinite(bpm) || bpm < 40) {
    return [{ start: 0, end: Math.max(duration, 0), energy: 0.5 }]
  }

  const bar = (60 / bpm) * 4
  const barSamples = Math.max(1, Math.round(bar * sampleRate))
  const origin = Math.min(samples.length, Math.max(0, Math.round(beatOffset * sampleRate)))
  const energies: number[] = []
  for (let cursor = origin; cursor + barSamples <= samples.length; cursor += barSamples) {
    let sum = 0
    let count = 0
    for (let i = 0; i < barSamples; i += 4) {
      const sample = samples[cursor + i]
      sum += sample * sample
      count++
    }
    energies.push(Math.sqrt(sum / Math.max(1, count)))
  }

  if (energies.length === 0) {
    return [{ start: 0, end: duration, energy: 0.5 }]
  }

  let peak = 0
  for (const energy of energies) peak = Math.max(peak, energy)
  const normal = energies.map((energy) => (peak > 1e-8 ? energy / peak : 0))

  const raw: { startBar: number; endBar: number; energy: number }[] = []
  let startBar = 0
  let total = normal[0]
  let count = 1
  const push = (endBar: number) => {
    raw.push({ startBar, endBar, energy: total / count })
  }
  for (let barIndex = 1; barIndex < normal.length; barIndex++) {
    const mean = total / count
    if (count >= 4 && Math.abs(normal[barIndex] - mean) > 0.16) {
      push(barIndex)
      startBar = barIndex
      total = normal[barIndex]
      count = 1
    } else {
      total += normal[barIndex]
      count++
    }
  }
  push(normal.length)

  const merged: Section[] = []
  for (const piece of raw) {
    const start = beatOffset + piece.startBar * bar
    const end = Math.min(duration, beatOffset + piece.endBar * bar)
    const bars = (end - start) / bar
    const previous = merged[merged.length - 1]
    if (previous && bars < 8) {
      const previousBars = (previous.end - previous.start) / bar
      const weight = previousBars + bars
      previous.energy = (previous.energy * previousBars + piece.energy * bars) / weight
      previous.end = end
    } else {
      merged.push({ start: Math.max(0, start), end, energy: piece.energy })
    }
  }

  if (merged.length === 0) return [{ start: 0, end: duration, energy: 0.5 }]
  if (merged[0].start > 0.05) merged[0].start = 0
  merged[merged.length - 1].end = duration
  return merged
}
