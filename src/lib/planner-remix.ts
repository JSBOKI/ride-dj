import { clamp } from "./format.ts"
import type { IntensityShape, MixPlan, MixSegment, PhaseName, TrackAnalysis } from "./types.ts"

const RATE_MIN = 0.94
const RATE_MAX = 1.06
const MIN_TARGET = 30

interface PhaseSpec {
  phase: PhaseName
  ratio: number
  energy: number
}

export const RIDE_SHAPES: Record<IntensityShape, PhaseSpec[]> = {
  "full-ride": [
    { phase: "warm-up", ratio: 0.15, energy: 0.3 },
    { phase: "build", ratio: 0.25, energy: 0.55 },
    { phase: "peak", ratio: 0.45, energy: 0.9 },
    { phase: "cool-down", ratio: 0.15, energy: 0.32 },
  ],
  "warm-up": [{ phase: "warm-up", ratio: 1, energy: 0.32 }],
  build: [
    { phase: "warm-up", ratio: 0.2, energy: 0.35 },
    { phase: "build", ratio: 0.8, energy: 0.7 },
  ],
  peak: [{ phase: "peak", ratio: 1, energy: 0.92 }],
  "cool-down": [{ phase: "cool-down", ratio: 1, energy: 0.3 }],
}

interface Phrase {
  trackId: string
  trackName: string
  start: number
  end: number
  bars: number
  energy: number
  playbackRate: number
  bpm: number
  sourceLimit: number
}

interface Draft {
  trackId: string
  trackName: string
  phase: PhaseName
  loopStart: number
  loopEnd: number
  repeats: number
  playbackRate: number
  bpm: number
  energy: number
  bars: number
  sourceLimit: number
}

export interface PlanOptions {
  /** Keep the current song at the front when replanning mid-ride. */
  anchorTrackId?: string
}

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return 120
  return bpm
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5
  return clamp(value, 0, 1)
}

function median(values: number[]): number {
  if (values.length === 0) return 120
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function barSeconds(bpm: number): number {
  return 240 / bpm
}

function snapUp(time: number, offset: number, bar: number): number {
  const steps = Math.ceil((time - offset) / bar - 1e-6)
  return offset + Math.max(0, steps) * bar
}

function snapDown(time: number, offset: number, bar: number): number {
  const steps = Math.floor((time - offset) / bar + 1e-6)
  return offset + Math.max(0, steps) * bar
}

/** 8-bar blend for mid tempos, 16-bar blend once that lands closer to an 18s mix. */
function crossfadeBarCount(bpm: number): 8 | 16 {
  const bar = barSeconds(bpm > 0 ? bpm : 120)
  const eight = 8 * bar
  const sixteen = 16 * bar
  return Math.abs(sixteen - 18) <= Math.abs(eight - 18) ? 16 : 8
}

function phrasesFor(track: TrackAnalysis, rate: number): Phrase[] {
  const bpm = safeBpm(track.bpm)
  const bar = barSeconds(bpm)
  const offset = Number.isFinite(track.beatOffset) ? Math.max(0, track.beatOffset) : 0
  const phrases: Phrase[] = []
  const usable = track.sections.filter((section) => section.end - section.start >= bar * 8)
  const sections = usable.length
    ? usable
    : [{ start: 0, end: track.duration, energy: clamp01(track.energy) }]

  for (const section of sections) {
    const energy = clamp01(section.energy)
    let cursor = snapUp(Math.max(section.start, 0), offset, bar)
    const alignedEnd = snapDown(Math.min(section.end, track.duration), offset, bar)
    while (cursor + 8 * bar <= alignedEnd + 1e-3) {
      let bars: 8 | 16 | 32 = 8
      if (cursor + 32 * bar <= alignedEnd + 1e-3) bars = 32
      else if (cursor + 16 * bar <= alignedEnd + 1e-3) bars = 16
      const end = Math.min(track.duration, cursor + bars * bar)
      if (end - cursor < bar * 4) break
      phrases.push({
        trackId: track.id,
        trackName: track.name,
        start: cursor,
        end,
        bars,
        energy,
        playbackRate: rate,
        bpm: bpm * rate,
        sourceLimit: track.duration,
      })
      cursor = end
    }
  }

  if (phrases.length === 0 && track.duration > 0.4) {
    phrases.push({
      trackId: track.id,
      trackName: track.name,
      start: 0,
      end: track.duration,
      bars: Math.max(1, Math.round(track.duration / bar)),
      energy: clamp01(track.energy || 0.5),
      playbackRate: rate,
      bpm: bpm * rate,
      sourceLimit: track.duration,
    })
  }
  return phrases
}

function energyScore(phrase: Phrase, phase: PhaseName): number {
  if (phase === "peak") return -phrase.energy
  if (phase === "warm-up" || phase === "cool-down") return phrase.energy
  return Math.abs(phrase.energy - 0.55)
}

function poolFor(phrases: Phrase[], phase: PhaseName): Phrase[] {
  if (phrases.length === 0) return []
  const ranked = [...phrases].sort(
    (a, b) => energyScore(a, phase) - energyScore(b, phase) || b.bars - a.bars || a.start - b.start,
  )
  if (phase === "peak") {
    const best = ranked[0].energy
    const high = ranked.filter((phrase) => phrase.energy >= best - 0.15)
    return high.length > 0 ? high : ranked.slice(0, 1)
  }
  if (phase === "warm-up" || phase === "cool-down") {
    const best = ranked[0].energy
    const low = ranked.filter((phrase) => phrase.energy <= best + 0.18)
    return low.length > 0 ? low : ranked.slice(0, 1)
  }
  return ranked.slice(0, Math.max(1, Math.ceil(ranked.length * 0.7)))
}

function tracksForPhase(tracks: TrackAnalysis[], phase: PhaseName, shape: IntensityShape): TrackAnalysis[] {
  const sorted = [...tracks].sort((a, b) => a.energy - b.energy || a.id.localeCompare(b.id))
  if (sorted.length <= 1) return sorted
  if (shape === "peak") return [...sorted].reverse()
  if (shape === "warm-up") return sorted
  if (shape === "cool-down") return [...sorted].reverse()
  if (shape === "build") {
    if (phase === "warm-up") return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)))
    return sorted.slice(Math.floor(sorted.length / 3))
  }
  if (phase === "warm-up") return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.34)))
  if (phase === "build") {
    const start = Math.floor(sorted.length * 0.2)
    return sorted.slice(start, Math.max(start + 1, Math.ceil(sorted.length * 0.75)))
  }
  if (phase === "peak") return [...sorted].reverse().slice(0, Math.max(1, Math.ceil(sorted.length * 0.5)))
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.4)))
}

function played(draft: Pick<Draft, "loopStart" | "loopEnd" | "repeats" | "playbackRate">): number {
  return ((draft.loopEnd - draft.loopStart) * draft.repeats) / draft.playbackRate
}

function draftFrom(phrase: Phrase, phase: PhaseName, repeats: number): Draft {
  return {
    trackId: phrase.trackId,
    trackName: phrase.trackName,
    phase,
    loopStart: phrase.start,
    loopEnd: phrase.end,
    repeats,
    playbackRate: phrase.playbackRate,
    bpm: phrase.bpm,
    energy: phrase.energy,
    bars: phrase.bars,
    sourceLimit: phrase.sourceLimit,
  }
}

function fillPhase(pool: Phrase[], phase: PhaseName, budget: number): Draft[] {
  if (pool.length === 0 || budget <= 0) return []
  const drafts: Draft[] = []
  let filled = 0
  let index = 0
  let guard = 0
  while (filled < budget - 0.4 && guard < 4000) {
    guard++
    const phrase = pool[index % pool.length]
    index++
    const once = (phrase.end - phrase.start) / phrase.playbackRate
    if (once <= 0.05) break
    const room = budget - filled
    let repeats = 1
    if (room >= once) {
      const chunk = Math.min(room, Math.max(once * 2, 48))
      repeats = Math.max(1, Math.floor(chunk / once))
      if (pool.length > 1) repeats = Math.min(repeats, 4)
    } else if (drafts.length > 0) {
      break
    }
    drafts.push(draftFrom(phrase, phase, repeats))
    filled += once * repeats
  }
  return drafts
}

function layout(drafts: Draft[]): MixSegment[] {
  const segments: MixSegment[] = []
  for (const draft of drafts) {
    const duration = played(draft)
    if (duration <= 0.02) continue
    const previous = segments[segments.length - 1]
    let crossfadeIn = 0
    let crossfadeBars: 0 | 8 | 16 = 0
    if (previous && previous.trackId !== draft.trackId) {
      const barsWanted = crossfadeBarCount(previous.bpm)
      const bar = barSeconds(previous.bpm)
      const previousDuration = previous.mixEnd - previous.mixStart
      const cap = Math.min(previousDuration, duration) * 0.4
      let bars: 8 | 16 = barsWanted
      let seconds = bars * bar
      if (seconds > cap && bars === 16) {
        bars = 8
        seconds = 8 * bar
      }
      if (seconds > cap) seconds = cap
      if (seconds >= 0.25) {
        crossfadeIn = seconds
        crossfadeBars = bars
      }
    }
    const mixStart = (previous ? previous.mixEnd : 0) - crossfadeIn
    segments.push({
      ...draft,
      mixStart,
      mixEnd: mixStart + duration,
      crossfadeIn,
      crossfadeBars,
      seam: 0,
      part: "song",
    })
  }
  return segments
}

function planDuration(drafts: Draft[]): number {
  const segments = layout(drafts)
  if (segments.length === 0) return 0
  return segments[segments.length - 1].mixEnd
}

function dominantPhase(shape: IntensityShape): PhaseName {
  if (shape === "full-ride" || shape === "peak") return "peak"
  if (shape === "build") return "build"
  if (shape === "warm-up") return "warm-up"
  return "cool-down"
}

function bestPhrase(phrases: Phrase[], phase: PhaseName): Phrase {
  const pool = poolFor(phrases, phase)
  const source = pool.length > 0 ? pool : phrases
  return [...source].sort((a, b) => {
    const preference = (phrase: Phrase) => (phrase.bars === 16 ? 0 : phrase.bars === 32 ? 1 : 2)
    return preference(a) - preference(b) || energyScore(a, phase) - energyScore(b, phase)
  })[0]
}

function addFiller(drafts: Draft[], filler: Phrase, phase: PhaseName, delta: number) {
  const once = (filler.end - filler.start) / filler.playbackRate
  const repeats = Math.max(1, Math.min(6, Math.round(delta / Math.max(once, 0.1))))
  const existing = drafts.findLastIndex(
    (draft) =>
      draft.phase === phase &&
      draft.trackId === filler.trackId &&
      Math.abs(draft.loopStart - filler.start) < 0.02,
  )
  if (existing >= 0) {
    drafts[existing].repeats += repeats
    return
  }
  const block = draftFrom(filler, phase, repeats)
  const insertAt = drafts.findLastIndex((draft) => draft.phase === phase)
  if (insertAt >= 0) drafts.splice(insertAt + 1, 0, block)
  else drafts.push(block)
}

function shrinkOne(drafts: Draft[]): boolean {
  for (let index = drafts.length - 1; index >= 0; index--) {
    if (drafts[index].repeats >= 1.99) {
      drafts[index].repeats -= 1
      return true
    }
  }
  if (drafts.length <= 1) return false
  let longest = -1
  let longestAt = 0
  for (let index = 0; index < drafts.length; index++) {
    const length = played(drafts[index])
    if (length > longest) {
      longest = length
      longestAt = index
    }
  }
  drafts.splice(longestAt, 1)
  return true
}

function fitLastRepeats(drafts: Draft[], target: number) {
  const block = drafts[drafts.length - 1]
  const once = (block.loopEnd - block.loopStart) / block.playbackRate
  if (once <= 0.001) return
  let low = 0.12
  let high = Math.max(block.repeats, target / once, 1)
  block.repeats = high
  let guard = 0
  while (planDuration(drafts) < target && guard++ < 10) {
    high *= 2
    block.repeats = high
  }
  for (let step = 0; step < 48; step++) {
    const mid = (low + high) / 2
    block.repeats = mid
    if (planDuration(drafts) > target) high = mid
    else low = mid
  }
  block.repeats = (low + high) / 2
}

function microFit(drafts: Draft[], target: number) {
  let guard = 0
  while (drafts.length > 0 && guard++ < 16) {
    fitLastRepeats(drafts, target)
    const duration = planDuration(drafts)
    if (Math.abs(duration - target) <= 0.05) return
    const last = drafts[drafts.length - 1]
    if (duration > target + 0.05 && drafts.length > 1 && last.repeats <= 0.14) {
      drafts.pop()
      continue
    }
    return
  }
}

function coarseFit(drafts: Draft[], target: number, filler: Phrase, phase: PhaseName) {
  let guard = 0
  while (guard++ < 3000) {
    const duration = planDuration(drafts)
    const delta = target - duration
    if (Math.abs(delta) <= 2) return
    if (delta > 0) {
      const before = duration
      addFiller(drafts, filler, phase, delta)
      if (planDuration(drafts) <= before + 0.01) return
      continue
    }
    const saved = drafts.map((draft) => ({ ...draft }))
    if (!shrinkOne(drafts)) return
    if (planDuration(drafts) < target - 2) {
      drafts.splice(0, drafts.length, ...saved)
      return
    }
  }
}

export function planRemix(
  tracks: TrackAnalysis[],
  targetSeconds: number,
  shape: IntensityShape,
  options: PlanOptions = {},
): MixPlan {
  if (tracks.length === 0) throw new Error("Add at least one track.")
  if (!Number.isFinite(targetSeconds) || targetSeconds < MIN_TARGET) {
    throw new Error("Ride length has to be at least 30 seconds.")
  }

  const masterBpm = median(tracks.map((track) => safeBpm(track.bpm)))
  const prepared = tracks.map((track) => {
    const bpm = safeBpm(track.bpm)
    return {
      track: { ...track, bpm, energy: clamp01(track.energy) },
      rate: clamp(masterBpm / bpm, RATE_MIN, RATE_MAX),
    }
  })
  const phrases = prepared.flatMap(({ track, rate }) => phrasesFor(track, rate))
  if (phrases.length === 0) throw new Error("These tracks are too short to mix.")

  const drafts: Draft[] = []
  for (const spec of RIDE_SHAPES[shape]) {
    const allowed = new Set(tracksForPhase(prepared.map((item) => item.track), spec.phase, shape).map((track) => track.id))
    let phasePhrases = phrases.filter((phrase) => allowed.has(phrase.trackId))
    if (phasePhrases.length === 0) phasePhrases = phrases
    let pool = poolFor(phasePhrases, spec.phase)
    if (pool.length === 0) pool = phasePhrases
    if (drafts.length === 0 && options.anchorTrackId) {
      const preferred = pool.filter((phrase) => phrase.trackId === options.anchorTrackId)
      const fromAnchor = phrases.filter((phrase) => phrase.trackId === options.anchorTrackId)
      const lead = preferred.length > 0 ? preferred : fromAnchor
      const rest = pool.filter((phrase) => phrase.trackId !== options.anchorTrackId)
      if (lead.length > 0) pool = [...lead, ...rest]
    }
    drafts.push(...fillPhase(pool, spec.phase, spec.ratio * targetSeconds))
  }

  if (drafts.length === 0) {
    drafts.push(draftFrom(phrases[0], RIDE_SHAPES[shape][0].phase, 1))
  }

  const phase = dominantPhase(shape)
  coarseFit(drafts, targetSeconds, bestPhrase(phrases, phase), phase)
  microFit(drafts, targetSeconds)
  const segments = layout(drafts)
  const duration = segments.length > 0 ? segments[segments.length - 1].mixEnd : 0

  return { segments, slices: [], songs: [], duration, target: targetSeconds, masterBpm, shape, mode: "remix" }
}
