import { describe, expect, it } from "vitest"
import { crossfadeBarCount, planMix } from "./planner.ts"
import type { IntensityShape, MixPlan, TrackAnalysis } from "./types.ts"

function makeTrack(
  id: string,
  bpm: number,
  sections: { bars: number; energy: number }[],
): TrackAnalysis {
  const bar = 240 / bpm
  let cursor = 0
  const built = sections.map((section) => {
    const start = cursor
    const end = cursor + section.bars * bar
    cursor = end
    return { start, end, energy: section.energy }
  })
  const duration = cursor
  const energy =
    built.reduce((sum, section) => sum + section.energy * (section.end - section.start), 0) / duration
  return { id, name: id, duration, bpm, beatOffset: 0, energy, sections: built }
}

const rideSet: TrackAnalysis[] = [
  makeTrack("easy", 96, [
    { bars: 32, energy: 0.22 },
    { bars: 16, energy: 0.3 },
  ]),
  makeTrack("mid", 118, [
    { bars: 32, energy: 0.5 },
    { bars: 16, energy: 0.58 },
  ]),
  makeTrack("hard", 132, [
    { bars: 32, energy: 0.84 },
    { bars: 32, energy: 0.95 },
  ]),
  makeTrack("down", 108, [
    { bars: 32, energy: 0.36 },
    { bars: 16, energy: 0.24 },
  ]),
]

const shortSet: TrackAnalysis[] = [
  makeTrack("a", 100, [{ bars: 16, energy: 0.3 }]),
  makeTrack("b", 124, [{ bars: 16, energy: 0.7 }]),
  makeTrack("c", 140, [{ bars: 16, energy: 0.9 }]),
]

const longSet: TrackAnalysis[] = [
  makeTrack("long-low", 90, [
    { bars: 160, energy: 0.3 },
    { bars: 160, energy: 0.45 },
  ]),
  makeTrack("long-high", 150, [
    { bars: 160, energy: 0.8 },
    { bars: 160, energy: 0.92 },
  ]),
]

function expectOnTarget(plan: MixPlan, target: number) {
  expect(
    Math.abs(plan.duration - target),
    `planned ${plan.duration.toFixed(3)}s for ${target}s (${plan.segments.length} segments)`,
  ).toBeLessThanOrEqual(2)
  expect(plan.segments.length).toBeGreaterThan(0)
  expect(plan.segments[0].mixStart).toBeCloseTo(0, 3)
  expect(plan.segments[plan.segments.length - 1].mixEnd).toBeCloseTo(plan.duration, 3)
  for (let index = 0; index < plan.segments.length; index++) {
    const segment = plan.segments[index]
    expect(segment.repeats).toBeGreaterThan(0)
    expect(segment.loopEnd).toBeGreaterThan(segment.loopStart)
    expect(segment.playbackRate).toBeGreaterThanOrEqual(0.94 - 1e-9)
    expect(segment.playbackRate).toBeLessThanOrEqual(1.06 + 1e-9)
    expect([0, 8, 16]).toContain(segment.crossfadeBars)
    expect(segment.mixEnd).toBeGreaterThan(segment.mixStart)
    if (index === 0) {
      expect(segment.crossfadeIn).toBe(0)
      continue
    }
    const previous = plan.segments[index - 1]
    expect(segment.mixStart).toBeCloseTo(previous.mixEnd - segment.crossfadeIn, 3)
    expect(segment.mixStart).toBeGreaterThan(previous.mixStart)
    expect(segment.crossfadeIn).toBeLessThanOrEqual(segment.mixEnd - segment.mixStart + 1e-6)
  }
}

describe("planMix", () => {
  it.each([
    { label: "four songs", tracks: rideSet, targets: [120, 600, 20 * 60, 30 * 60, 45 * 60] },
    { label: "short songs that must loop", tracks: shortSet, targets: [10 * 60, 20 * 60, 30 * 60] },
    { label: "long songs that must be cut", tracks: longSet, targets: [5 * 60, 20 * 60, 45 * 60] },
    {
      label: "one short song",
      tracks: [makeTrack("solo", 128, [{ bars: 24, energy: 0.66 }])],
      targets: [8 * 60, 20 * 60],
    },
    {
      label: "spread tempos",
      tracks: [88, 104, 128, 160].map((bpm, index) =>
        makeTrack(`t${bpm}`, bpm, [
          { bars: 32, energy: 0.25 + index * 0.2 },
          { bars: 16, energy: 0.3 + index * 0.18 },
        ]),
      ),
      targets: [15 * 60, 30 * 60, 45 * 60],
    },
  ])("$label hits every target within 2 seconds", ({ tracks, targets }) => {
    for (const target of targets) {
      expectOnTarget(planMix(tracks, target, "full-ride"), target)
    }
  })

  it.each(["warm-up", "build", "peak", "cool-down"] as IntensityShape[])(
    "hits 20, 30, and 45 minutes for the %s shape",
    (shape) => {
      for (const minutes of [20, 30, 45]) {
        expectOnTarget(planMix(rideSet, minutes * 60, shape), minutes * 60)
      }
    },
  )

  it("loops phrase-aligned material when the songs are shorter than the ride", () => {
    const plan = planMix(shortSet, 20 * 60, "peak")
    const source = shortSet.reduce((sum, track) => sum + track.duration, 0)
    const played = plan.segments.reduce(
      (sum, segment) => sum + (segment.loopEnd - segment.loopStart) * segment.repeats,
      0,
    )
    expect(played).toBeGreaterThan(source + 30)
    expect(plan.segments.some((segment) => segment.repeats > 1.2 || segment.bars === 8 || segment.bars === 16 || segment.bars === 32)).toBe(true)
  })

  it("trims five six-minute songs to a 20 minute ride", () => {
    // 128 BPM and 192 bars is exactly 6:00. Five of those match Hamlet Trance Ride (30:00 catalog, 20:00 target).
    const energies = [0.28, 0.46, 0.72, 0.9, 0.34]
    const tracks = energies.map((energy, index) =>
      makeTrack(`six-minute-${index + 1}`, 128, [
        { bars: 64, energy: Math.max(0.15, energy - 0.08) },
        { bars: 64, energy },
        { bars: 64, energy: Math.min(0.98, energy + 0.05) },
      ]),
    )
    const available = tracks.reduce((sum, track) => sum + track.duration, 0)
    expect(available).toBe(30 * 60)
    const plan = planMix(tracks, 20 * 60, "full-ride")
    expectOnTarget(plan, 20 * 60)
    const played = plan.segments.reduce(
      (sum, segment) => sum + (segment.loopEnd - segment.loopStart) * segment.repeats,
      0,
    )
    expect(played).toBeLessThan(available - 60)
  })

  it("skips surplus audio when the songs run long", () => {
    const plan = planMix(longSet, 5 * 60, "full-ride")
    const available = longSet.reduce((sum, track) => sum + track.duration, 0)
    const played = plan.segments.reduce(
      (sum, segment) => sum + (segment.loopEnd - segment.loopStart) * segment.repeats,
      0,
    )
    expect(played).toBeLessThan(available - 60)
    expectOnTarget(plan, 5 * 60)
  })

  it("puts higher energy in the peak than in the warm-up", () => {
    const plan = planMix(rideSet, 30 * 60, "full-ride")
    const mean = (phase: MixPlan["segments"][number]["phase"]) => {
      const matching = plan.segments.filter((segment) => segment.phase === phase)
      const weight = matching.reduce((sum, segment) => sum + (segment.mixEnd - segment.mixStart), 0)
      return matching.reduce((sum, segment) => sum + segment.energy * (segment.mixEnd - segment.mixStart), 0) / weight
    }
    expect(mean("peak")).toBeGreaterThan(mean("warm-up") + 0.2)
  })

  it("orders a build from easier songs into harder ones", () => {
    const plan = planMix(rideSet, 20 * 60, "build")
    expect(plan.segments[0].energy).toBeLessThan(plan.segments[plan.segments.length - 1].energy)
  })

  it("plays a hotter peak ride than a cool-down on the same songs", () => {
    const mean = (plan: MixPlan) =>
      plan.segments.reduce((sum, segment) => sum + segment.energy, 0) / plan.segments.length
    expect(mean(planMix(rideSet, 20 * 60, "peak"))).toBeGreaterThan(mean(planMix(rideSet, 20 * 60, "cool-down")))
  })

  it("crossfades track changes on an 8 or 16 bar grid", () => {
    const plan = planMix(rideSet, 30 * 60, "full-ride")
    const blends = plan.segments.filter((segment, index) => {
      if (index === 0) return false
      const previous = plan.segments[index - 1]
      return previous.trackId !== segment.trackId && segment.crossfadeIn > 0
    })
    expect(blends.length).toBeGreaterThan(0)
    for (const blend of blends) expect([8, 16]).toContain(blend.crossfadeBars)
  })

  it("starts a replan on the anchored track when that track is in the ride", () => {
    const plan = planMix(rideSet, 12 * 60, "full-ride", { anchorTrackId: "hard" })
    expect(plan.segments[0].trackId).toBe("hard")
    expectOnTarget(plan, 12 * 60)
  })

  it("rejects an empty crate", () => {
    expect(() => planMix([], 600, "full-ride")).toThrow(/track/i)
  })
})

describe("crossfadeBarCount", () => {
  it("uses 8 bars around 128 BPM and 16 bars on faster trance tempos", () => {
    expect(crossfadeBarCount(100)).toBe(8)
    expect(crossfadeBarCount(128)).toBe(8)
    expect(crossfadeBarCount(160)).toBe(16)
    expect(crossfadeBarCount(174)).toBe(16)
  })
})
