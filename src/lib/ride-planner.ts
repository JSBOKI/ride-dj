import { clamp } from "./format.ts"
import { meanEffort, programSeconds, SECTION_META, timeline, type RideProgram, type TimedSection } from "./program.ts"
import type { MixPlan, Slice, SongSpan, TrackAnalysis } from "./types.ts"

export const RATE_MIN = 0.97
export const RATE_MAX = 1.03
/** No song plays for less than this unless the ride itself is shorter. */
export const MIN_SONG_SECONDS = 120
/** Equal-power seam between loop passes, in bars. */
export const SEAM_BARS = 8
/** Loopable phrase lengths, in bars. */
export const LOOP_BARS = [32, 16] as const
/** Song-to-song blends, in bars. */
export const BLEND_BARS = [32, 16] as const
const MAX_BLEND_SECONDS = 64
const BLEND_SHARE = 0.4
const END_FADE_BARS = 16

export function safeBpm(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) return 120
  return bpm
}

export interface BeatGrid {
  bar: number
  /** First downbeat, seconds. */
  d0: number
  /** Full bars from d0 to the end of the audio. */
  bars: number
  duration: number
}

export function beatGrid(track: TrackAnalysis): BeatGrid {
  const bar = 240 / safeBpm(track.bpm)
  const raw = Number.isFinite(track.beatOffset) ? track.beatOffset : 0
  const d0 = ((raw % bar) + bar) % bar
  const bars = Math.max(0, Math.floor((track.duration - d0) / bar + 1e-6))
  return { bar, d0, bars, duration: track.duration }
}

export function downbeat(grid: BeatGrid, index: number): number {
  return grid.d0 + index * grid.bar
}

interface LoopPhrase {
  /** Bar index of the phrase start (multiple of 8 from the first downbeat). */
  startBar: number
  bars: number
  start: number
  end: number
  energy: number
  label: "peak" | "build" | "calm"
}

function energyBetween(track: TrackAnalysis, from: number, to: number): number {
  let sum = 0
  let covered = 0
  for (const section of track.sections) {
    const overlap = Math.min(to, section.end) - Math.max(from, section.start)
    if (overlap > 0) {
      sum += overlap * section.energy
      covered += overlap
    }
  }
  return covered > 0 ? sum / covered : track.energy
}

/** Strongest section start (the drop), snapped to a downbeat. */
export function dropTime(track: TrackAnalysis): number | null {
  const grid = beatGrid(track)
  let best: { start: number; energy: number } | null = null
  for (const section of track.sections) {
    if (section.end - section.start < 8 * grid.bar) continue
    if (!best || section.energy > best.energy + 0.02) best = { start: section.start, energy: section.energy }
  }
  if (!best || best.start < grid.bar * 4) return null
  const index = Math.round((best.start - grid.d0) / grid.bar)
  return downbeat(grid, index)
}

/**
 * Candidate phrases to repeat: on the 8-bar phrase grid, 16 or 32 bars long,
 * with room for the half seam on both sides.
 */
export function loopPhrases(track: TrackAnalysis, keepClear: { head: number; tail: number }): LoopPhrase[] {
  const grid = beatGrid(track)
  const half = SEAM_BARS / 2
  const found: LoopPhrase[] = []
  for (const bars of LOOP_BARS) {
    for (let startBar = 8; startBar + bars <= grid.bars; startBar += 8) {
      const start = downbeat(grid, startBar)
      const end = downbeat(grid, startBar + bars)
      if (start - half * grid.bar < keepClear.head - 1e-6) continue
      if (end + half * grid.bar > keepClear.tail + 1e-6) continue
      found.push({ startBar, bars, start, end, energy: energyBetween(track, start, end), label: "calm" })
    }
  }
  if (found.length === 0) return []
  const picks: LoopPhrase[] = []
  const add = (phrase: LoopPhrase | undefined, label: LoopPhrase["label"]) => {
    if (!phrase) return
    if (picks.some((item) => item.start === phrase.start && item.bars === phrase.bars)) return
    picks.push({ ...phrase, label })
  }
  const byEnergy = [...found].sort((a, b) => b.energy - a.energy || b.bars - a.bars)
  add(byEnergy.find((phrase) => phrase.bars === 32) ?? byEnergy[0], "peak")
  const drop = dropTime(track)
  if (drop != null) {
    add(
      found.filter((phrase) => phrase.end <= drop + 1e-6).sort((a, b) => b.end - a.end || b.bars - a.bars)[0],
      "build",
    )
  }
  add([...found].sort((a, b) => a.energy - b.energy || b.bars - a.bars)[0], "calm")
  return picks
}

function blendBarsFor(heardBpm: number, outgoingSeconds: number, incomingSeconds: number): number {
  const bar = 240 / heardBpm
  const cap = Math.min(MAX_BLEND_SECONDS, BLEND_SHARE * Math.min(outgoingSeconds, incomingSeconds))
  for (const bars of BLEND_BARS) if (bars * bar <= cap + 1e-6) return bars
  return 16
}

/** Rate and tempo multiple that bring a song onto the heard tempo, within ±3%. */
export function matchTempo(heard: number | null, bpm: number): { rate: number; matched: boolean } {
  if (heard == null) return { rate: 1, matched: true }
  let best = { rate: 1, gap: Infinity }
  for (const multiple of [0.5, 1, 2]) {
    const ratio = heard / (bpm * multiple)
    const gap = Math.abs(Math.log(ratio))
    if (gap < best.gap) best = { rate: ratio, gap }
  }
  const rate = clamp(best.rate, RATE_MIN, RATE_MAX)
  return { rate, matched: Math.abs(rate - best.rate) < 1e-6 }
}

interface Config {
  track: TrackAnalysis
  grid: BeatGrid
  rate: number
  matched: boolean
  sIn: number
  loop: LoopPhrase | null
  loops: number
  sOut: number
  /** Output seconds. */
  length: number
  last: boolean
  endFade: number
  blendInBars: number
  blendIn: number
  start: number
  cost: number
}

interface PlanState {
  t: number
  heard: number | null
  /** Blend into the next song, fixed by the song before it. */
  blendBars: number
  blendSeconds: number
}

function outBarsFor(heard: number, length: number): number {
  return blendBarsFor(heard, length, MIN_SONG_SECONDS * 1.4)
}

export interface RidePlanOptions {
  /** Songs that must not be picked first (e.g. replanning). */
  avoidFirst?: string
}

/**
 * Plans a ride: whole songs in an order whose energy and tempo follow the
 * program, stretched only by repeating whole 16/32-bar phrases with 8-bar
 * equal-power seams, and joined by 16/32-bar beat-matched blends.
 */
export function planRide(tracks: TrackAnalysis[], program: RideProgram, _options: RidePlanOptions = {}): MixPlan {
  const usable = tracks
    .filter((track) => track.duration > 4)
    .map((track) => ({ ...track, bpm: safeBpm(track.bpm), energy: clamp(Number.isFinite(track.energy) ? track.energy : 0.5, 0, 1) }))
  if (usable.length === 0) throw new Error("Add at least one track.")
  const target = programSeconds(program)
  if (!Number.isFinite(target) || target < 30) throw new Error("Ride length has to be at least 30 seconds.")
  const sections = timeline(program)
  const intensity = intensityRanks(usable)

  const configs: Config[] = []
  const used = new Map<string, number>()
  const state: PlanState = { t: 0, heard: null, blendBars: 0, blendSeconds: 0 }
  let guard = 0
  while (guard++ < 200) {
    const remaining = target - state.t
    const choice = pickNext(usable, intensity, sections, state, remaining, used, configs[configs.length - 1]?.track.id)
    if (!choice) break
    configs.push(choice)
    used.set(choice.track.id, (used.get(choice.track.id) ?? 0) + 1)
    if (choice.last) break
    const heard = choice.track.bpm * choice.rate
    const outBars = outBarsFor(heard, choice.length)
    const outSeconds = (outBars * 240) / heard
    state.t += choice.length - outSeconds
    state.heard = heard
    state.blendBars = outBars
    state.blendSeconds = outSeconds
  }
  return assemble(configs, target, sections, program)
}

function intensityRanks(tracks: TrackAnalysis[]): Map<string, number> {
  const rank = (values: number[], value: number) => {
    if (values.length <= 1) return 0.5
    const below = values.filter((item) => item < value - 1e-9).length
    const equal = values.filter((item) => Math.abs(item - value) <= 1e-9).length
    return (below + (equal - 1) / 2) / (values.length - 1)
  }
  const energies = tracks.map((track) => track.energy)
  const tempos = tracks.map((track) => track.bpm)
  const out = new Map<string, number>()
  for (const track of tracks) {
    const score = 0.6 * rank(energies, track.energy) + 0.4 * rank(tempos, track.bpm)
    out.set(track.id, 0.1 + 0.8 * score)
  }
  return out
}

function pickNext(
  tracks: TrackAnalysis[],
  intensity: Map<string, number>,
  sections: TimedSection[],
  state: PlanState,
  remaining: number,
  used: Map<string, number>,
  previousId: string | undefined,
): Config | null {
  let best: Config | null = null
  const first = state.heard == null
  for (const track of tracks) {
    if (track.id === previousId && tracks.length > 1) continue
    const grid = beatGrid(track)
    const tempo = matchTempo(state.heard, track.bpm)
    const rate = tempo.rate
    const heard = track.bpm * rate
    const blendInBars = first ? 0 : state.blendBars
    const blendIn = first ? 0 : state.blendSeconds
    const sIn = first ? 0 : grid.d0
    const blendInSource = blendIn * rate
    const endBar = downbeat(grid, grid.bars)
    const tailClear = endBar - 32 * grid.bar
    let phrases = loopPhrases(track, { head: sIn + blendInSource, tail: tailClear })
    if (phrases.length === 0) phrases = loopPhrases(track, { head: 0, tail: grid.duration })
    const options: (LoopPhrase | null)[] = [null, ...phrases]
    const reuse = used.get(track.id) ?? 0
    const minLength = Math.min(remaining, Math.max(MIN_SONG_SECONDS, blendIn / BLEND_SHARE))

    for (const loop of options) {
      const phraseSource = loop ? loop.end - loop.start : 0
      // Loops stretch a song to at most twice its length unless the crate is too small to fill the ride.
      const crateSeconds = tracks.reduce((sum, item) => sum + item.duration, 0)
      const loopBudget = tracks.length === 1 ? Infinity : crateSeconds * 1.2 >= remaining ? grid.duration : grid.duration * 2
      const maxLoops = loop
        ? Math.max(0, Math.min(Math.ceil((remaining * rate) / phraseSource) + 1, Math.floor(loopBudget / phraseSource)))
        : 0
      for (let loops = 0; loops <= Math.min(maxLoops, 40); loops++) {
        if (loop == null && loops > 0) break
        if (loop && loops === 0) continue
        // Last-song option: end exactly on the ride clock.
        const lastSource = remaining * rate - loops * phraseSource
        const lastValid =
          lastSource + sIn <= grid.duration + 1e-6 &&
          lastSource > 0 &&
          (!loop || sIn + lastSource >= loop.end + (SEAM_BARS / 2) * grid.bar + 2) &&
          (remaining <= MIN_SONG_SECONDS + 1 || remaining >= minLength - 1e-6)
        if (lastValid) {
          const sOut = sIn + lastSource
          const natural = grid.duration - sOut < 0.75
          const config = scoreConfig({
            track,
            grid,
            rate,
            matched: tempo.matched,
            sIn,
            loop,
            loops,
            sOut: natural ? grid.duration : sOut,
            length: remaining,
            last: true,
            endFade: natural ? Math.min(4, remaining * 0.1) : Math.min((END_FADE_BARS * grid.bar) / rate, remaining * 0.25),
            blendInBars,
            blendIn,
            start: state.t,
            cost: 0,
          }, intensity, sections, state, reuse, grid.duration - sOut)
          if (!best || config.cost < best.cost) best = config
        }
        // Not-last options: end on the natural last downbeat, or trimmed to an earlier phrase line.
        for (let trim = 0; trim <= 32; trim += 8) {
          const sOut = downbeat(grid, grid.bars - trim)
          const length = (sOut - sIn + loops * phraseSource) / rate
          if (length < minLength - 1e-6) continue
          const outSeconds = (outBarsFor(heard, length) * 240) / heard
          if (loop && sOut - outSeconds * rate < loop.end + (SEAM_BARS / 2) * grid.bar - 1e-6) continue
          if (outSeconds > BLEND_SHARE * length + 1e-6) continue
          const after = remaining - (length - outSeconds)
          if (after < MIN_SONG_SECONDS) continue
          // Look ahead: time the unused songs can't cover will need repeats later.
          const shortfall = Math.max(0, after - unusedSeconds(tracks, used, track.id))
          const config = scoreConfig({
            track,
            grid,
            rate,
            matched: tempo.matched,
            sIn,
            loop,
            loops,
            sOut,
            length,
            last: false,
            endFade: 0,
            blendInBars,
            blendIn,
            start: state.t,
            cost: trim * 0.06 + shortfall / 75,
          }, intensity, sections, state, reuse, 0, outSeconds)
          if (!best || config.cost < best.cost) best = config
        }
      }
    }
  }
  return best
}

function unusedSeconds(tracks: TrackAnalysis[], used: Map<string, number>, current: string): number {
  let total = 0
  for (const track of tracks) {
    if (track.id === current || (used.get(track.id) ?? 0) > 0) continue
    total += Math.max(0, track.duration - 40)
  }
  return total
}

function scoreConfig(
  config: Config,
  intensity: Map<string, number>,
  sections: TimedSection[],
  state: PlanState,
  reuse: number,
  trimmedTail: number,
  outSeconds = 0,
): Config {
  const start = state.t
  const end = start + config.length
  const level = intensity.get(config.track.id) ?? 0.5
  const wanted = meanEffort(sections, start, end)
  let cost = config.cost
  cost += 4 * Math.abs(level - wanted)
  cost += reuse * 3
  if (!config.matched) cost += 3
  cost += Math.abs(config.rate - 1) * 20
  cost += config.loops * 0.2 + config.loops * config.loops * 0.06
  if (config.loop) {
    // Loop calm phrases in easy sections and peak phrases in hard ones.
    const loopMix = start + (config.loop.start - config.sIn) / config.rate
    const loopEffort = meanEffort(sections, loopMix, loopMix + (config.loops * (config.loop.end - config.loop.start)) / config.rate)
    const want = loopEffort > 0.55 ? "peak" : loopEffort < 0.35 ? "calm" : "build"
    if (config.loop.label !== want) cost += 0.6
  }
  if (config.last) {
    cost += Math.max(0, trimmedTail) / 60
  } else {
    // Land the blend on a section boundary.
    const mid = end - outSeconds / 2
    let nearest = Infinity
    for (const section of sections) if (section.start > start + 1) nearest = Math.min(nearest, Math.abs(section.start - mid))
    if (Number.isFinite(nearest)) cost += Math.min(nearest, 120) / 45
  }
  // Land the drop on the start of a climb or sprint.
  const drop = dropTime(config.track)
  if (drop != null) {
    const dropMix = dropMixTime(config, drop, start)
    if (dropMix != null && dropMix < end) {
      const hard = sections.filter((section) => (section.kind === "sprint" || section.kind === "climb") && section.start >= start && section.start < end)
      if (hard.length > 0) {
        const miss = Math.min(...hard.map((section) => Math.abs(section.start - dropMix)))
        cost += Math.min(miss, 90) / 45
      }
    }
  }
  return { ...config, cost }
}

function dropMixTime(config: Config, drop: number, start: number): number | null {
  if (drop < config.sIn) return null
  const phrase = config.loop ? config.loop.end - config.loop.start : 0
  const shifted = config.loop && drop >= config.loop.end - 1e-6 ? drop + config.loops * phrase : drop
  if (drop > config.sOut) return null
  return start + (shifted - config.sIn) / config.rate
}

function assemble(configs: Config[], target: number, sections: TimedSection[], program: RideProgram): MixPlan {
  const slices: Slice[] = []
  const songs: SongSpan[] = []
  for (let index = 0; index < configs.length; index++) {
    const config = configs[index]
    const next = configs[index + 1]
    const { grid, rate, track } = config
    const heard = track.bpm * rate
    const outBars = next ? next.blendInBars : 0
    const fadeOut = next ? next.blendIn : config.endFade
    const songStart = config.start
    const half = (SEAM_BARS / 2) * grid.bar
    const seam = (SEAM_BARS * grid.bar) / rate
    const pieces: { from: number; to: number }[] = []
    if (config.loop && config.loops > 0) {
      pieces.push({ from: config.sIn, to: config.loop.end + half })
      for (let pass = 1; pass < config.loops; pass++) pieces.push({ from: config.loop.start - half, to: config.loop.end + half })
      pieces.push({ from: config.loop.start - half, to: config.sOut })
    } else {
      pieces.push({ from: config.sIn, to: config.sOut })
    }
    let mixCursor = songStart
    for (let piece = 0; piece < pieces.length; piece++) {
      const { from, to } = pieces[piece]
      const firstPiece = piece === 0
      const lastPiece = piece === pieces.length - 1
      const mixStart = firstPiece ? songStart : mixCursor
      const mixEnd = mixStart + (to - from) / rate
      slices.push({
        trackId: track.id,
        trackName: track.name,
        songIndex: index,
        mixStart,
        mixEnd: lastPiece && !next ? target : mixEnd,
        sourceStart: from,
        sourceEnd: to,
        playbackRate: rate,
        fadeIn: firstPiece ? config.blendIn : seam,
        fadeOut: lastPiece ? fadeOut : seam,
        fadeInBars: firstPiece ? config.blendInBars : SEAM_BARS,
        fadeOutBars: lastPiece ? (next ? outBars : Math.round((config.endFade * rate) / grid.bar)) : SEAM_BARS,
        fadeInKind: firstPiece ? (index === 0 ? "start" : "blend") : "loop",
        fadeOutKind: lastPiece ? (next ? "blend" : "end") : "loop",
        bpm: heard,
      })
      // The next pass starts a full seam before this one ends.
      mixCursor = mixEnd - seam
    }
    const songEnd = slices[slices.length - 1].mixEnd
    const drop = dropTime(track)
    const dropAt = drop != null ? dropMixTime(config, drop, songStart) : null
    songs.push({
      trackId: track.id,
      trackName: track.name,
      mixStart: songStart,
      mixEnd: songEnd,
      bpm: heard,
      playbackRate: rate,
      energy: track.energy,
      loops: config.loops,
      loopBars: config.loop?.bars ?? 0,
      blendInBars: config.blendInBars,
      beatMatched: config.matched,
      ...(dropAt != null && dropAt < songEnd ? { dropAt } : {}),
    })
  }
  const duration = slices.length > 0 ? Math.max(...slices.map((slice) => slice.mixEnd)) : 0
  const heard = songs.map((song) => song.bpm).sort((a, b) => a - b)
  return {
    segments: [],
    slices,
    songs,
    duration,
    target,
    masterBpm: heard.length > 0 ? heard[Math.floor(heard.length / 2)] : 120,
    shape: "full-ride",
    mode: "intact",
    program,
    sectionsTimeline: sections,
  }
}

/** Equal-power gain of a slice at a mix time (0 outside it). */
export function sliceGain(slice: Slice, mixTime: number): number {
  if (mixTime < slice.mixStart - 1e-9 || mixTime > slice.mixEnd + 1e-9) return 0
  let gain = 1
  if (slice.fadeIn > 0.001 && mixTime < slice.mixStart + slice.fadeIn) {
    gain *= Math.sin(clamp((mixTime - slice.mixStart) / slice.fadeIn, 0, 1) * (Math.PI / 2))
  }
  if (slice.fadeOut > 0.001 && mixTime > slice.mixEnd - slice.fadeOut) {
    gain *= Math.cos(clamp((mixTime - (slice.mixEnd - slice.fadeOut)) / slice.fadeOut, 0, 1) * (Math.PI / 2))
  }
  return gain
}

/** The loudest slice at a time: which song is "now", and where in its source we are (for lyrics). */
export function dominantAt(plan: Pick<MixPlan, "slices">, mixTime: number): { slice: Slice; sourceTime: number } | null {
  let best: Slice | null = null
  let bestGain = -1
  for (const slice of plan.slices) {
    if (mixTime < slice.mixStart || mixTime > slice.mixEnd) continue
    const gain = sliceGain(slice, mixTime)
    if (gain > bestGain + 1e-9) {
      best = slice
      bestGain = gain
    }
  }
  if (!best) {
    best = plan.slices[plan.slices.length - 1] ?? null
    if (!best) return null
  }
  const sourceTime = best.sourceStart + (clamp(mixTime, best.mixStart, best.mixEnd) - best.mixStart) * best.playbackRate
  return { slice: best, sourceTime }
}

export { SECTION_META }
