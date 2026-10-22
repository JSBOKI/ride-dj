import { planRemix } from "./planner-remix.ts"
import { scaleProgram, type RideProgram, type SectionKind } from "./program.ts"
import { planRide } from "./ride-planner.ts"
import type { IntensityShape, MixMode, MixPlan, MixSegment, Slice, TrackAnalysis } from "./types.ts"

export interface PlanOptions {
  mode?: MixMode
  /** Ride program. When omitted, one is derived from the shape. */
  program?: RideProgram
}

/** Old one-word shapes as a program, for saved sessions and the Remix planner. */
export function programForShape(shape: IntensityShape, seconds: number): RideProgram {
  const plan: Record<IntensityShape, [SectionKind, number][]> = {
    "full-ride": [["warm-up", 0.15], ["steady", 0.3], ["climb", 0.2], ["sprint", 0.1], ["recover", 0.1], ["cool-down", 0.15]],
    "warm-up": [["warm-up", 1]],
    build: [["warm-up", 0.25], ["steady", 0.35], ["climb", 0.4]],
    peak: [["climb", 0.6], ["sprint", 0.4]],
    "cool-down": [["recover", 0.4], ["cool-down", 0.6]],
  }
  const base: RideProgram = {
    id: `shape-${shape}`,
    name: shape,
    detail: "",
    sections: plan[shape].map(([kind, share]) => ({ kind, seconds: Math.round(share * 1000) })),
  }
  return scaleProgram(base, seconds)
}

export function planMix(
  tracks: TrackAnalysis[],
  targetSeconds: number,
  shape: IntensityShape,
  options: PlanOptions = {},
): MixPlan {
  if (tracks.length === 0) throw new Error("Add at least one track.")
  if (!Number.isFinite(targetSeconds) || targetSeconds < 30) {
    throw new Error("Ride length has to be at least 30 seconds.")
  }
  const program = options.program ?? programForShape(shape, targetSeconds)
  if (options.mode === "remix") {
    const plan = planRemix(tracks, targetSeconds, shape, {})
    return { ...plan, slices: segmentsToSlices(plan.segments), songs: [], program }
  }
  return { ...planRide(tracks, program), shape }
}

/** Remix plans are phrase blocks; the engine plays everything as slices. */
export function segmentsToSlices(segments: MixSegment[]): Slice[] {
  const slices: Slice[] = []
  segments.forEach((segment, index) => {
    const next = segments[index + 1]
    const phrase = Math.max(0.02, segment.loopEnd - segment.loopStart)
    const rate = segment.playbackRate > 0 ? segment.playbackRate : 1
    const phraseOut = phrase / rate
    const seam = segment.repeats > 1.001 && segment.seam > 0 ? Math.min(segment.seam, phraseOut * 0.45) : 0.008
    const step = phraseOut - (segment.repeats > 1.001 ? seam : 0)
    const count = Math.max(1, Math.ceil(segment.repeats - 1e-9))
    for (let pass = 0; pass < count; pass++) {
      const mixStart = segment.mixStart + pass * step
      const mixEnd = Math.min(segment.mixEnd, mixStart + phraseOut)
      if (mixEnd - mixStart < 0.02) continue
      const firstPass = pass === 0
      const lastPass = pass === count - 1
      slices.push({
        trackId: segment.trackId,
        trackName: segment.trackName,
        songIndex: index,
        mixStart,
        mixEnd,
        sourceStart: segment.loopStart,
        sourceEnd: segment.loopStart + (mixEnd - mixStart) * rate,
        playbackRate: rate,
        fadeIn: firstPass ? Math.max(0.008, segment.crossfadeIn) : seam,
        fadeOut: lastPass ? Math.max(0.008, next?.crossfadeIn ?? 0.008) : seam,
        fadeInBars: firstPass ? segment.crossfadeBars : 0,
        fadeOutBars: lastPass ? (next?.crossfadeBars ?? 0) : 0,
        fadeInKind: firstPass ? (index === 0 ? "start" : "blend") : "loop",
        fadeOutKind: lastPass ? (next ? "blend" : "end") : "loop",
        bpm: segment.bpm,
      })
    }
  })
  return slices
}
