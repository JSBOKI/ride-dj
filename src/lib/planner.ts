import { clamp } from "./format.ts"
import { planRemix } from "./planner-remix.ts"
import type { IntensityShape, MixMode, MixPlan, MixSegment, PhaseName, TrackAnalysis } from "./types.ts"

const RATE_MIN = 0.97
const RATE_MAX = 1.03
const MIN_SEGMENT = 60
const MIN_TARGET = 30

export interface PlanOptions {
  /** Keep the current song at the front when replanning mid-ride. */
  anchorTrackId?: string
  /** Intact plays whole songs. Remix is the older chopped-phrase planner. */
  mode?: MixMode
}

interface Arranged {
  track: TrackAnalysis
  phase: PhaseName
}

interface Block {
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
  seam: number
  part: MixSegment["part"]
  /** Frozen blend into this block. Fit does not recompute it. */
  crossfadeIn: number
  crossfadeBars: MixSegment["crossfadeBars"]
}

export interface LoopPass {
  outputStart: number
  outputLength: number
  sourceDuration: number
}

function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return 120
  return bpm
}

function barSeconds(bpm: number): number {
  return 240 / safeBpm(bpm)
}

function snapDown(time: number, bar: number): number {
  if (bar <= 0) return Math.max(0, time)
  return Math.max(0, Math.floor((time + 1e-6) / bar) * bar)
}

function snapUp(time: number, bar: number): number {
  if (bar <= 0) return Math.max(0, time)
  return Math.max(0, Math.ceil((time - 1e-6) / bar) * bar)
}

function snapNearest(time: number, bar: number): number {
  if (bar <= 0) return Math.max(0, time)
  return Math.max(0, Math.round(time / bar) * bar)
}

/** Prefer a 32-bar blend, and a 16-bar blend when 32 bars would run past about 48 seconds. */
export function crossfadeBarCount(bpm: number): 16 | 32 {
  const bar = barSeconds(bpm)
  return 32 * bar <= 48 ? 32 : 16
}

export function loopPasses(input: {
  loopStart: number
  loopEnd: number
  repeats: number
  playbackRate: number
  seam: number
}): LoopPass[] {
  const phrase = Math.max(0, input.loopEnd - input.loopStart)
  const rate = input.playbackRate > 0 ? input.playbackRate : 1
  const phraseOut = phrase / rate
  if (phraseOut <= 0.01 || input.repeats <= 0) return []
  const seam = input.repeats > 1.001 && input.seam > 0 ? Math.min(input.seam, phraseOut * 0.45) : 0
  if (seam <= 0 || input.repeats <= 1.001) {
    const reps = input.repeats
    return [{ outputStart: 0, outputLength: phraseOut * reps, sourceDuration: phrase * reps }]
  }
  const step = phraseOut - seam
  const duration = phraseOut + (input.repeats - 1) * step
  const count = Math.max(1, Math.ceil(input.repeats - 1e-9))
  const passes: LoopPass[] = []
  for (let index = 0; index < count; index++) {
    const start = index * step
    const end = index === count - 1 ? duration : start + phraseOut
    const outputLength = Math.min(phraseOut, Math.max(0.02, end - start))
    passes.push({
      outputStart: start,
      outputLength,
      sourceDuration: Math.min(phrase, outputLength * rate),
    })
  }
  return passes
}

export function segmentOutputSeconds(input: {
  loopStart: number
  loopEnd: number
  repeats: number
  playbackRate: number
  seam: number
}): number {
  const phrase = Math.max(0, input.loopEnd - input.loopStart)
  const rate = input.playbackRate > 0 ? input.playbackRate : 1
  const phraseOut = phrase / rate
  if (phraseOut <= 0 || input.repeats <= 0) return 0
  const seam = input.repeats > 1.001 && input.seam > 0 ? Math.min(input.seam, phraseOut * 0.45) : 0
  if (seam <= 0 || input.repeats <= 1) return phraseOut * input.repeats
  return phraseOut + (input.repeats - 1) * (phraseOut - seam)
}

function outputOf(block: Block): number {
  return segmentOutputSeconds(block)
}

/** 16 or 32 bars, frozen from the blocks' current lengths so later fitting stays monotonic. */
function blendBetween(previous: Block, next: Block): { seconds: number; bars: MixSegment["crossfadeBars"] } {
  const prevOut = outputOf(previous)
  const nextOut = outputOf(next)
  const contiguous =
    previous.trackId === next.trackId &&
    Math.abs(previous.repeats - Math.round(previous.repeats)) < 0.03 &&
    Math.abs(previous.loopEnd - next.loopStart) < 0.4
  if (contiguous || prevOut < 1 || nextOut < 1) return { seconds: 0, bars: 0 }
  const bar = barSeconds(previous.bpm)
  const cap = Math.min(prevOut, nextOut) * 0.45
  const wanted = crossfadeBarCount(previous.bpm)
  const order: Array<16 | 32> = wanted === 32 ? [32, 16] : [16]
  for (const bars of order) {
    const seconds = bars * bar
    if (seconds <= cap && seconds >= 0.5) return { seconds, bars }
  }
  // A single skip inside one song can use a shorter blend when 16 bars will not fit.
  if (previous.trackId === next.trackId) {
    const eight = 8 * bar
    if (eight <= cap && eight >= 0.5) return { seconds: eight, bars: 8 }
  }
  return { seconds: 0, bars: 0 }
}

function place(blocks: Block[]): MixSegment[] {
  const segments: MixSegment[] = []
  let cursor = 0
  for (const block of blocks) {
    const duration = outputOf(block)
    if (duration <= 0.02) continue
    const mixStart = cursor - block.crossfadeIn
    const segment: MixSegment = {
      trackId: block.trackId,
      trackName: block.trackName,
      phase: block.phase,
      loopStart: block.loopStart,
      loopEnd: block.loopEnd,
      repeats: block.repeats,
      playbackRate: block.playbackRate,
      bpm: block.bpm,
      energy: block.energy,
      bars: block.bars,
      sourceLimit: block.sourceLimit,
      seam: block.seam,
      part: block.part,
      mixStart,
      mixEnd: mixStart + duration,
      crossfadeIn: block.crossfadeIn,
      crossfadeBars: block.crossfadeBars,
    }
    segments.push(segment)
    cursor = segment.mixEnd
  }
  return segments
}

function durationOf(blocks: Block[]): number {
  const segments = place(blocks)
  return segments.length > 0 ? segments[segments.length - 1].mixEnd : 0
}

function stampBlends(blocks: Block[]) {
  if (blocks.length === 0) return
  blocks[0].crossfadeIn = 0
  blocks[0].crossfadeBars = 0
  for (let index = 1; index < blocks.length; index++) {
    const blend = blendBetween(blocks[index - 1], blocks[index])
    blocks[index].crossfadeIn = blend.seconds
    blocks[index].crossfadeBars = blend.bars
  }
}

function arrange(tracks: TrackAnalysis[], shape: IntensityShape): Arranged[] {
  const sorted = [...tracks].sort((a, b) => a.energy - b.energy || a.id.localeCompare(b.id))
  if (shape === "peak") return [...sorted].reverse().map((track) => ({ track, phase: "peak" }))
  if (shape === "warm-up") return sorted.map((track) => ({ track, phase: "warm-up" }))
  if (shape === "cool-down") return sorted.map((track) => ({ track, phase: "cool-down" }))
  if (shape === "build") {
    const warmupCount = sorted.length > 1 ? 1 : 0
    return sorted.map((track, index) => ({
      track,
      phase: index < warmupCount ? "warm-up" : "build",
    }))
  }
  if (sorted.length === 1) return [{ track: sorted[0], phase: "peak" }]
  if (sorted.length === 2) {
    return [
      { track: sorted[0], phase: "warm-up" },
      { track: sorted[1], phase: "peak" },
    ]
  }
  const warm = sorted[0]
  const cool = sorted[1]
  const peak = sorted[sorted.length - 1]
  const build = sorted.slice(2, -1)
  return [
    { track: warm, phase: "warm-up" },
    ...build.map((track) => ({ track, phase: "build" as const })),
    { track: peak, phase: "peak" },
    { track: cool, phase: "cool-down" },
  ]
}

function pullAnchor(arranged: Arranged[], anchorTrackId: string | undefined) {
  if (!anchorTrackId) return
  const index = arranged.findIndex((item) => item.track.id === anchorTrackId)
  if (index > 0) {
    const [item] = arranged.splice(index, 1)
    arranged.unshift(item)
  }
}

function ratesFor(songs: Arranged[]): number[] {
  const rates: number[] = []
  let heard: number | null = null
  for (const song of songs) {
    const bpm = safeBpm(song.track.bpm)
    const rate: number = heard == null ? 1 : clamp(heard / bpm, RATE_MIN, RATE_MAX)
    rates.push(rate)
    heard = bpm * rate
  }
  return rates
}

function estimateMix(songs: Arranged[]): number {
  if (songs.length === 0) return 0
  const rates = ratesFor(songs)
  let total = 0
  for (let index = 0; index < songs.length; index++) {
    const duration = songs[index].track.duration / rates[index]
    let fade = 0
    if (index > 0) {
      const bpm = safeBpm(songs[index - 1].track.bpm) * rates[index - 1]
      const bar = barSeconds(bpm)
      const previous = songs[index - 1].track.duration / rates[index - 1]
      const cap = Math.min(previous, duration) * 0.45
      const bars = crossfadeBarCount(bpm)
      const preferred = (bars === 32 && 32 * bar <= cap) || 16 * bar > cap ? bars : 16
      const seconds = preferred * bar
      if (seconds <= cap) fade = seconds
    }
    total += duration - fade
  }
  return Math.max(0, total)
}

function chooseSubset(journey: Arranged[], target: number, requireFirst: boolean): Arranged[] {
  const count = journey.length
  if (count === 0) return []
  if (count === 1) return journey
  let best = [journey[0]]
  let bestDistance = Infinity
  let bestTie = Infinity
  const consider = (subset: Arranged[]) => {
    const distance = Math.abs(estimateMix(subset) - target)
    let tie = -subset.length
    if (subset[0]?.track.id === journey[0]?.track.id) tie -= 2
    if (subset[subset.length - 1]?.track.id === journey[journey.length - 1]?.track.id) tie -= 2
    if (distance < bestDistance - 0.4 || (Math.abs(distance - bestDistance) <= 0.4 && tie < bestTie)) {
      best = subset
      bestDistance = distance
      bestTie = tie
    }
  }
  if (count > 12) {
    const prefix: Arranged[] = []
    for (const song of journey) {
      prefix.push(song)
      consider([...prefix])
    }
    return best
  }
  const masks = 1 << count
  for (let mask = 1; mask < masks; mask++) {
    if (requireFirst && (mask & 1) === 0) continue
    const subset: Arranged[] = []
    for (let index = 0; index < count; index++) {
      if (mask & (1 << index)) subset.push(journey[index])
    }
    consider(subset)
  }
  return best
}

function makeBlock(
  song: Arranged,
  rate: number,
  start: number,
  end: number,
  repeats: number,
  seam: number,
  part: MixSegment["part"],
): Block {
  const bpm = safeBpm(song.track.bpm)
  const bar = barSeconds(bpm)
  const phrase = Math.max(0, end - start)
  return {
    trackId: song.track.id,
    trackName: song.track.name,
    phase: song.phase,
    loopStart: start,
    loopEnd: end,
    repeats,
    playbackRate: rate,
    bpm: bpm * rate,
    energy: song.track.energy,
    bars: Math.max(1, Math.round(phrase / bar)),
    sourceLimit: song.track.duration,
    seam,
    part,
    crossfadeIn: 0,
    crossfadeBars: 0,
  }
}

function grooveWindow(track: TrackAnalysis, bars: number): { start: number; end: number; bars: number } | null {
  const bar = barSeconds(track.bpm)
  const length = bars * bar
  if (track.duration < MIN_SEGMENT * 2 + length) return null
  let center = track.duration / 2
  let bestEnergy = -1
  for (const section of track.sections) {
    if (section.energy >= bestEnergy) {
      bestEnergy = section.energy
      center = (section.start + section.end) / 2
    }
  }
  const earliest = snapUp(MIN_SEGMENT, bar)
  const latestEnd = snapDown(track.duration - MIN_SEGMENT, bar)
  if (latestEnd - earliest < length - 1e-3) return null
  let start = snapDown(center - length / 2, bar)
  const maxStart = latestEnd - length
  start = clamp(start, earliest, maxStart)
  start = snapDown(start, bar)
  if (start < earliest - 1e-3) start = snapUp(earliest, bar)
  const end = start + length
  if (start < MIN_SEGMENT - 0.05) return null
  if (end > track.duration - MIN_SEGMENT + 0.05) return null
  return { start, end, bars }
}

function tryGroove(song: Arranged, rate: number, desired: number): Block[] | null {
  const bar = barSeconds(song.track.bpm)
  const natural = song.track.duration / rate
  if (desired <= natural + 1) return null
  let fallback: Block[] | null = null
  for (const bars of [64, 48, 32, 16]) {
    const window = grooveWindow(song.track, bars)
    if (!window) continue
    const introOut = window.start / rate
    const phraseOut = (window.end - window.start) / rate
    const outroFull = (song.track.duration - window.end) / rate
    if (introOut < MIN_SEGMENT - 0.05 || outroFull < MIN_SEGMENT - 0.05 || phraseOut < 8) continue
    const seam = Math.min((2 * bar) / rate, phraseOut * 0.12)
    const step = phraseOut - seam
    if (step <= 1) continue
    const extra = desired - natural
    const added = Math.max(1, Math.ceil(extra / step - 1e-9))
    const repeats = added + 1
    const grown = natural + (repeats - 1) * step
    const outroOut = outroFull - (grown - desired)
    const grooveOut = phraseOut + (repeats - 1) * step
    if (grooveOut < MIN_SEGMENT - 0.05) continue
    if (outroOut < MIN_SEGMENT - 0.05) {
      // Nearest integer loop, full ending, only if tempo can still land inside ±3%.
      const nearestAdded = Math.max(1, Math.round(extra / step))
      const nearestRepeats = nearestAdded + 1
      const nearestGrown = natural + (nearestRepeats - 1) * step
      const scale = nearestGrown / desired
      const nextRate = rate * scale
      if (nextRate < RATE_MIN - 1e-9 || nextRate > RATE_MAX + 1e-9) continue
      const scaledSeam = seam / scale
      const candidate = [
        makeBlock(song, nextRate, 0, window.start, 1, 0, "intro"),
        makeBlock(song, nextRate, window.start, window.end, nearestRepeats, scaledSeam, "groove"),
        makeBlock(song, nextRate, window.end, song.track.duration, 1, 0, "outro"),
      ]
      if (candidate.every((block) => outputOf(block) >= MIN_SEGMENT - 0.05)) fallback ??= candidate
      continue
    }
    const outroEnd = Math.min(song.track.duration, window.end + outroOut * rate)
    return [
      makeBlock(song, rate, 0, window.start, 1, 0, "intro"),
      makeBlock(song, rate, window.start, window.end, repeats, seam, "groove"),
      makeBlock(song, rate, window.end, outroEnd, 1, 0, "outro"),
    ]
  }
  return fallback
}

function loopEntire(song: Arranged, rate: number, desired: number): Block[] {
  const natural = song.track.duration / rate
  const bar = barSeconds(song.track.bpm)
  const seam = natural > 1 ? Math.min((2 * bar) / rate, natural * 0.12) : 0
  const step = Math.max(0.25, natural - seam)
  const goal = Math.max(desired, natural < MIN_SEGMENT ? MIN_SEGMENT : natural)
  let repeats = Math.max(1, goal / step)
  const block = makeBlock(
    song,
    rate,
    0,
    song.track.duration,
    repeats,
    seam,
    natural <= 64 * bar ? "groove" : "song",
  )
  let guard = 0
  while (outputOf(block) + 0.02 < goal && guard++ < 24) {
    repeats += 0.05
    block.repeats = repeats
  }
  return [block]
}

function trimSong(song: Arranged, rate: number, desired: number): Block[] {
  const track = song.track
  const bar = barSeconds(track.bpm)
  const minSource = Math.min(track.duration, Math.min(MIN_SEGMENT, desired) * rate)
  const outroBars = [32, 48, 64, 16].find((bars) => {
    const length = bars * bar
    return length >= MIN_SEGMENT - 0.05 && length <= track.duration - MIN_SEGMENT
  })
  if (outroBars && desired >= MIN_SEGMENT * 2 - 0.5) {
    const outroLength = outroBars * bar
    const outroStart = snapDown(track.duration, bar) - outroLength
    const fadeCap = Math.min(16 * bar, outroLength * 0.45, (desired - outroLength / rate) * rate * 0.45)
    const fadeOut = fadeCap > 0.5 ? fadeCap / rate : 0
    const bodyOut = desired - outroLength / rate + fadeOut
    const bodyEnd = snapNearest(bodyOut * rate, bar)
    if (
      bodyOut >= MIN_SEGMENT - 0.05 &&
      bodyEnd >= minSource - 0.05 &&
      outroStart - bodyEnd >= 8 * bar &&
      outroStart > bodyEnd
    ) {
      return [
        makeBlock(song, rate, 0, Math.min(bodyEnd, outroStart - bar), 1, 0, "song"),
        makeBlock(song, rate, outroStart, Math.min(track.duration, outroStart + outroLength), 1, 0, "outro"),
      ]
    }
  }
  let end = snapNearest(desired * rate, bar)
  end = clamp(end, Math.min(track.duration, minSource), track.duration)
  if (track.duration - end < bar) end = track.duration
  return [makeBlock(song, rate, 0, end, 1, 0, "song")]
}

function renderSong(song: Arranged, rate: number, desired: number): Block[] {
  const natural = song.track.duration / rate
  const floor = Math.min(MIN_SEGMENT, Math.max(desired, 1))
  if (natural + 1.5 >= desired && natural <= desired + 1.5 && natural >= floor - 0.05) {
    return [makeBlock(song, rate, 0, song.track.duration, 1, 0, "song")]
  }
  if (desired < natural - 1.5) return trimSong(song, rate, Math.max(desired, floor))
  const grooved = tryGroove(song, rate, Math.max(desired, natural + 2))
  if (grooved && grooved.every((block) => outputOf(block) >= floor - 0.05)) return grooved
  return loopEntire(song, rate, Math.max(desired, floor, natural))
}

function priorityIndex(songs: Arranged[], shape: IntensityShape): number {
  if (shape === "build") return songs.length - 1
  if (shape === "full-ride") {
    const peak = songs.findIndex((song) => song.phase === "peak")
    if (peak >= 0) return peak
  }
  return 0
}

function songParts(song: Arranged, rate: number, desired: number): Block[] {
  const natural = song.track.duration / rate
  const safeDesired = natural < MIN_SEGMENT - 0.5 ? Math.max(desired, MIN_SEGMENT) : desired
  return renderSong(song, rate, safeDesired)
}

function buildBlocks(songs: Arranged[], target: number, shape: IntensityShape): Block[] {
  const rates = ratesFor(songs)
  let parts = songs.map((song, index) => {
    const natural = song.track.duration / rates[index]
    return songParts(song, rates[index], natural)
  })
  const flatten = () => parts.flat()
  stampBlends(flatten())
  const natural = durationOf(flatten())
  if (natural > target + 2) {
    if (songs.length > 1) {
      const headSongs = songs.slice(0, -1)
      const head = headSongs.map((song, index) => songParts(song, rates[index], song.track.duration / rates[index]))
      stampBlends(head.flat())
      const base = durationOf(head.flat())
      const tailSong = songs[songs.length - 1]
      const tail = songParts(tailSong, rates[rates.length - 1], tailSong.track.duration / rates[rates.length - 1])
      const incoming = blendBetween(head.flat()[head.flat().length - 1], tail[0]).seconds
      const desired = target - base + incoming
      if (desired < MIN_SEGMENT - 0.5) return buildBlocks(headSongs, target, shape)
      parts = [...head, trimSong(songs[songs.length - 1], rates[rates.length - 1], desired)]
      stampBlends(flatten())
      return flatten()
    }
    parts = [trimSong(songs[0], rates[0], target)]
    stampBlends(flatten())
    return flatten()
  }
  if (natural < target - 2) {
    const index = priorityIndex(songs, shape)
    const extra = target - natural
    const current = parts[index].reduce((sum, block) => sum + outputOf(block), 0)
    parts[index] = renderSong(songs[index], rates[index], current + extra)
    parts = parts.map((group, groupIndex) => (groupIndex === index ? group : group))
    stampBlends(flatten())
    const error = target - durationOf(flatten())
    if (Math.abs(error) > 2) {
      const again = parts[index].reduce((sum, block) => sum + outputOf(block), 0) + error
      parts[index] = renderSong(songs[index], rates[index], Math.max(again, MIN_SEGMENT))
      stampBlends(flatten())
    }
  }
  return flatten()
}

function solveKnob(
  blocks: Block[],
  target: number,
  knob: { min: number; max: number; set: (value: number) => void },
) {
  const duration = () => durationOf(blocks)
  let low = knob.min
  let high = knob.max
  knob.set(high)
  let guard = 0
  while (duration() < target - 0.01 && guard++ < 16) {
    high = high * 1.35 + 1
    knob.set(high)
    if (high > knob.max * 8 + target) break
  }
  knob.set(low)
  if (duration() > target) return
  for (let step = 0; step < 52; step++) {
    const mid = (low + high) / 2
    knob.set(mid)
    if (duration() > target) high = mid
    else low = mid
  }
  knob.set((low + high) / 2)
}

function fit(blocks: Block[], target: number) {
  if (blocks.length === 0) return
  solveKnob(blocks, target, flexibleKnob(blocks))
  if (Math.abs(durationOf(blocks) - target) <= 2) return
  if (blocks.length < 2) return
  const previous = blocks[blocks.length - 2]
  const ending = blocks[blocks.length - 1]
  if (previous.trackId !== ending.trackId || previous.repeats > 1.001) return
  const rate = previous.playbackRate
  const minEnd = Math.min(previous.sourceLimit, previous.loopStart + MIN_SEGMENT * rate)
  const maxEnd = previous.loopEnd
  if (maxEnd <= minEnd + 0.05) return
  solveKnob(blocks, target, {
    min: minEnd,
    max: maxEnd,
    set: (value) => {
      previous.repeats = 1
      previous.loopEnd = clamp(value, previous.loopStart + 0.05, maxEnd)
      const bar = barSeconds(previous.bpm / Math.max(rate, 0.01))
      previous.bars = Math.max(1, Math.round((previous.loopEnd - previous.loopStart) / bar))
    },
  })
}

function flexibleKnob(blocks: Block[]): { min: number; max: number; set: (value: number) => void } {
  const last = blocks[blocks.length - 1]
  if (last.repeats <= 1.001 && last.part !== "groove") {
    const minLength = Math.min(MIN_SEGMENT, Math.max(8, last.sourceLimit / last.playbackRate)) * last.playbackRate
    const minEnd = Math.min(last.sourceLimit, last.loopStart + minLength)
    return {
      min: Math.min(minEnd, last.loopEnd),
      max: last.sourceLimit,
      set: (value) => {
        last.repeats = 1
        last.loopEnd = clamp(value, last.loopStart + 0.05, last.sourceLimit)
        const bar = barSeconds(last.bpm / Math.max(last.playbackRate, 0.01))
        last.bars = Math.max(1, Math.round((last.loopEnd - last.loopStart) / bar))
      },
    }
  }
  const looped = [...blocks].reverse().find((block) => block.repeats > 1.001) ?? last
  const phrase = Math.max(0.05, looped.loopEnd - looped.loopStart)
  const phraseOut = phrase / looped.playbackRate
  const floor = MIN_SEGMENT
  const step = Math.max(0.2, phraseOut - looped.seam)
  let minRepeats = phraseOut >= floor - 0.02 ? 1 : 1 + (floor - phraseOut) / step
  const saved = looped.repeats
  let guard = 0
  while (guard++ < 24) {
    looped.repeats = minRepeats
    if (outputOf(looped) >= floor - 0.02) break
    minRepeats += 0.05
  }
  looped.repeats = saved
  return {
    min: minRepeats,
    max: Math.max(saved, minRepeats + 1),
    set: (value) => {
      looped.repeats = Math.max(minRepeats, value)
    },
  }
}

function planIntact(
  tracks: TrackAnalysis[],
  targetSeconds: number,
  shape: IntensityShape,
  options: PlanOptions,
): MixPlan {
  const prepared = tracks.map((track) => ({
    ...track,
    bpm: safeBpm(track.bpm),
    energy: clamp(Number.isFinite(track.energy) ? track.energy : 0.5, 0, 1),
    duration: Math.max(0, track.duration),
  }))
  const journey = arrange(prepared, shape)
  pullAnchor(journey, options.anchorTrackId)
  const chosen = chooseSubset(journey, targetSeconds, Boolean(options.anchorTrackId))
  const blocks = buildBlocks(chosen, targetSeconds, shape)
  fit(blocks, targetSeconds)
  const segments = place(blocks)
  const duration = segments.length > 0 ? segments[segments.length - 1].mixEnd : 0
  const heard = chosen.map((song, index) => safeBpm(song.track.bpm) * (ratesFor(chosen)[index] ?? 1))
  const masterBpm = heard.length > 0 ? median(heard) : 120
  return { segments, duration, target: targetSeconds, masterBpm, shape, mode: "intact" }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function planMix(
  tracks: TrackAnalysis[],
  targetSeconds: number,
  shape: IntensityShape,
  options: PlanOptions = {},
): MixPlan {
  if (tracks.length === 0) throw new Error("Add at least one track.")
  if (!Number.isFinite(targetSeconds) || targetSeconds < MIN_TARGET) {
    throw new Error("Ride length has to be at least 30 seconds.")
  }
  if (options.mode === "remix") return planRemix(tracks, targetSeconds, shape, options)
  return planIntact(tracks, targetSeconds, shape, options)
}
