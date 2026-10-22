import type { BpmResult } from "./types.ts"

const HOP = 128

/**
 * Onset-strength autocorrelation. The comb (lag + 2·lag + 3·lag) prefers the
 * beat over a strong offbeat or a half-time accent.
 */
export function detectBpm(
  samples: Float32Array,
  sampleRate: number,
  range: { minBpm?: number; maxBpm?: number; hintBpm?: number } = {},
): BpmResult {
  const minBpm = range.minBpm ?? 70
  const maxBpm = range.maxBpm ?? 200
  if (samples.length < sampleRate || sampleRate <= 0) {
    return { bpm: 120, confidence: 0, beatOffset: 0 }
  }

  const frameCount = Math.floor(samples.length / HOP)
  const onset = onsetStrength(samples, sampleRate)
  const flux = Float32Array.from(onset)

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
  let coarse = (60 * frameRate) / refinedLag

  // Fold half/double-time errors toward the ride-friendly 85–175 range, and toward a tag hint.
  const hint = range.hintBpm
  if (hint && hint >= 50 && hint <= 220) {
    const options = [coarse / 2, coarse, coarse * 2, (coarse * 2) / 3, (coarse * 3) / 2]
    const best = options.reduce((a, b) => (Math.abs(Math.log(b / hint)) < Math.abs(Math.log(a / hint)) ? b : a))
    coarse = Math.abs(best - hint) / hint <= 0.04 ? best : coarse
  }
  while (coarse < 85 && coarse * 2 <= maxBpm) coarse *= 2
  while (coarse > 175 && coarse / 2 >= minBpm) coarse /= 2

  const grid = refineGrid(flux, frameRate, coarse, hint)
  const downbeat = findDownbeat(samples, sampleRate, grid.bpm, grid.offset)
  return {
    bpm: grid.bpm,
    confidence: Math.max(0, Math.min(1, bestScore / 4)),
    beatOffset: downbeat,
  }
}

function sampleAt(values: Float32Array, position: number): number {
  const index = Math.floor(position)
  if (index < 0 || index + 1 >= values.length) return 0
  const frac = position - index
  return values[index] * (1 - frac) + values[index + 1] * frac
}

/**
 * The autocorrelation peak is only accurate to about 1%, which drifts by
 * seconds over a five minute song. Search tempo and phase finely so the beat
 * grid still sits on the beat at the end of the track.
 */
export function refineGrid(
  onset: Float32Array,
  frameRate: number,
  bpm: number,
  hint?: number,
): { bpm: number; offset: number } {
  const evaluate = (candidate: number, phaseSteps: number) => {
    const period = (60 / candidate) * frameRate
    let best = -Infinity
    let bestPhase = 0
    for (let step = 0; step < phaseSteps; step++) {
      const phase = (step / phaseSteps) * period
      let sum = 0
      let count = 0
      for (let position = phase; position < onset.length - 1; position += period) {
        sum += sampleAt(onset, position)
        count++
      }
      const score = sum / Math.max(1, count)
      if (score > best) {
        best = score
        bestPhase = phase
      }
    }
    return { score: best, phase: bestPhase }
  }
  let bestBpm = bpm
  let bestScore = -Infinity
  let bestPhase = 0
  const consider = (candidate: number, phaseSteps: number) => {
    const result = evaluate(candidate, phaseSteps)
    if (result.score > bestScore) {
      bestScore = result.score
      bestBpm = candidate
      bestPhase = result.phase
    }
  }
  // The comb peak on a whole song is only ~0.03 BPM wide, so scan in 0.01 BPM steps.
  const centres = [bpm]
  if (hint && Math.abs(Math.log(hint / bpm)) > 0.02 && Math.abs(Math.log(hint / bpm)) < 0.06) centres.push(hint)
  const seen = new Set<number>()
  for (const centre of centres) {
    for (let candidate = centre * 0.965; candidate <= centre * 1.035; candidate += 0.01) {
      const key = Math.round(candidate * 100)
      if (seen.has(key)) continue
      seen.add(key)
      consider(key / 100, 24)
    }
  }
  const centre = bestBpm
  for (let candidate = centre - 0.012; candidate <= centre + 0.012 + 1e-9; candidate += 0.002) consider(candidate, 64)
  // Snap to an integer tempo when it scores practically the same.
  const rounded = Math.round(bestBpm)
  if (Math.abs(rounded - bestBpm) < 0.05) {
    const integer = evaluate(rounded, 64)
    if (integer.score >= bestScore * 0.99) {
      bestBpm = rounded
      bestPhase = integer.phase
    }
  }
  return { bpm: bestBpm, offset: bestPhase / frameRate }
}

/** Multi-band log-energy flux: kick (<150 Hz), hats (>4 kHz) and full band. */
export function onsetStrength(samples: Float32Array, sampleRate: number): Float32Array {
  const frameCount = Math.floor(samples.length / HOP)
  const onset = new Float32Array(frameCount)
  const bands = [biquad(samples, "lowpass", 150, sampleRate), biquad(samples, "highpass", 4000, sampleRate), samples]
  for (const band of bands) {
    let previous = 0
    for (let frame = 0; frame < frameCount; frame++) {
      let sum = 0
      const base = frame * HOP
      for (let i = 0; i < HOP; i++) {
        const value = band[base + i]
        sum += value * value
      }
      const level = Math.log(1 + 1000 * Math.sqrt(sum / HOP))
      if (frame > 0) onset[frame] += Math.max(0, level - previous)
      previous = level
    }
  }
  return onset
}

function biquad(input: Float32Array, type: "lowpass" | "highpass", frequency: number, sampleRate: number): Float32Array {
  const w = (2 * Math.PI * frequency) / sampleRate
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const cos = Math.cos(w)
  const b0 = type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2
  const b1 = type === "lowpass" ? 1 - cos : -(1 + cos)
  const b2 = b0
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  const output = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i]
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    output[i] = y0
  }
  return output
}

/**
 * Picks which of the four beats starts the bar: the one with the strongest low
 * end (kick plus bass) and the biggest level changes, since sections start on downbeats.
 */
export function findDownbeat(samples: Float32Array, sampleRate: number, bpm: number, beatPhase: number): number {
  const beat = 60 / bpm
  const bar = beat * 4
  const alpha = Math.exp((-2 * Math.PI * 150) / sampleRate)
  const window = Math.max(1, Math.round(0.07 * sampleRate))
  let low = 0
  const lowEnv = new Float32Array(Math.ceil(samples.length / window))
  for (let i = 0; i < samples.length; i++) {
    low = alpha * low + (1 - alpha) * samples[i]
    lowEnv[Math.floor(i / window)] += Math.abs(low)
  }
  const scores = [0, 0, 0, 0]
  const total = samples.length / sampleRate
  for (let candidate = 0; candidate < 4; candidate++) {
    const origin = beatPhase + candidate * beat
    let sum = 0
    let count = 0
    let previousBar = -1
    for (let time = origin; time < total - beat; time += bar) {
      const index = Math.floor((time * sampleRate) / window)
      const level = lowEnv[index] ?? 0
      sum += level
      if (previousBar >= 0) sum += 0.5 * Math.abs(level - previousBar)
      previousBar = level
      count++
    }
    scores[candidate] = sum / Math.max(1, count)
  }
  let best = 0
  for (let candidate = 1; candidate < 4; candidate++) if (scores[candidate] > scores[best] * 1.02) best = candidate
  const offset = beatPhase + best * beat
  return offset % bar
}
