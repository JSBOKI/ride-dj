import type { BpmResult } from "./types.ts"

const HOP = 128

/**
 * Onset-strength autocorrelation. The comb (lag + 2·lag + 3·lag) prefers the
 * beat over a strong offbeat or a half-time accent.
 */
export function detectBpm(
  samples: Float32Array,
  sampleRate: number,
  range: { minBpm?: number; maxBpm?: number } = {},
): BpmResult {
  const minBpm = range.minBpm ?? 70
  const maxBpm = range.maxBpm ?? 200
  if (samples.length < sampleRate || sampleRate <= 0) {
    return { bpm: 120, confidence: 0, beatOffset: 0 }
  }

  const frameCount = Math.floor(samples.length / HOP)
  const envelope = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0
    const base = frame * HOP
    for (let i = 0; i < HOP; i++) {
      const sample = samples[base + i]
      sum += sample * sample
    }
    envelope[frame] = Math.sqrt(sum / HOP)
  }

  const onset = new Float32Array(frameCount)
  for (let frame = 1; frame < frameCount; frame++) {
    const delta = envelope[frame] - envelope[frame - 1]
    onset[frame] = delta > 0 ? delta : 0
  }

  let mean = 0
  for (let i = 0; i < frameCount; i++) mean += onset[i]
  mean /= frameCount || 1
  let variance = 0
  for (let i = 0; i < frameCount; i++) {
    const delta = onset[i] - mean
    variance += delta * delta
  }
  const std = Math.sqrt(variance / (frameCount || 1)) || 1
  for (let i = 0; i < frameCount; i++) onset[i] = (onset[i] - mean) / std

  const frameRate = sampleRate / HOP
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * frameRate))
  const maxLag = Math.min(frameCount - 3, Math.ceil((60 / minBpm) * frameRate))
  if (maxLag <= minLag) return { bpm: 120, confidence: 0, beatOffset: 0 }

  const correlation = new Float32Array(maxLag + 3)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    const count = frameCount - lag
    for (let i = 0; i < count; i++) sum += onset[i] * onset[i + lag]
    correlation[lag] = sum / count
  }

  let bestLag = minLag
  let bestScore = Number.NEGATIVE_INFINITY
  for (let lag = minLag; lag <= maxLag; lag++) {
    const half = lag * 2 <= maxLag ? correlation[lag * 2] : 0
    const third = lag * 3 <= maxLag ? correlation[lag * 3] : 0
    const score = correlation[lag] + 0.75 * half + 0.45 * third
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }

  const previous = correlation[bestLag - 1] ?? correlation[bestLag]
  const current = correlation[bestLag]
  const next = correlation[bestLag + 1] ?? correlation[bestLag]
  const denominator = previous - 2 * current + next
  const shift = Math.abs(denominator) < 1e-9 ? 0 : (0.5 * (previous - next)) / denominator
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, shift))
  const bpm = (60 * frameRate) / refinedLag

  const period = Math.max(1, Math.round(refinedLag))
  let bestOffset = 0
  let bestOffsetScore = Number.NEGATIVE_INFINITY
  for (let offset = 0; offset < period; offset++) {
    let sum = 0
    let count = 0
    for (let frame = offset; frame < frameCount; frame += period) {
      sum += onset[frame]
      count++
    }
    const score = sum / (count || 1)
    if (score > bestOffsetScore) {
      bestOffsetScore = score
      bestOffset = offset
    }
  }

  return {
    bpm,
    confidence: Math.max(0, Math.min(1, bestScore / 4)),
    beatOffset: (bestOffset * HOP) / sampleRate,
  }
}
