import { describe, expect, it } from "vitest"
import { crossfadeBarCount, planMix } from "./planner.ts"
import type { IntensityShape, MixPlan, MixSegment, TrackAnalysis } from "./types.ts"

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

function sixMinute(id: string, energy: number): TrackAnalysis {
  return makeTrack(id, 128, [
    { bars: 64, energy: Math.max(0.12, energy - 0.08) },
    { bars: 64, energy },
    { bars: 64, energy: Math.min(0.98, energy + 0.05) },
  ])
}

function expectOnTarget(plan: MixPlan, target: number) {
  expect(plan.mode).toBe("intact")
  expect(
    Math.abs(plan.duration - target),
    `planned ${plan.duration.toFixed(3)}s for ${target}s (${plan.segments.length} segments: ${plan.segments
      .map((segment) => `${segment.trackName}/${segment.part}/${(segment.mixEnd - segment.mixStart).toFixed(1)}s`)
      .join(", ")})`,
  ).toBeLessThanOrEqual(2)
  expect(plan.segments.length).toBeGreaterThan(0)
  expect(plan.segments[0].mixStart).toBeCloseTo(0, 3)
  expect(plan.segments[plan.segments.length - 1].mixEnd).toBeCloseTo(plan.duration, 3)
  for (let index = 0; index < plan.segments.length; index++) {
    const segment = plan.segments[index]
    expect(segment.repeats).toBeGreaterThan(0)
    expect(segment.loopEnd).toBeGreaterThan(segment.loopStart)
    expect(segment.playbackRate).toBeGreaterThanOrEqual(0.97 - 1e-9)
    expect(segment.playbackRate).toBeLessThanOrEqual(1.03 + 1e-9)
    expect([0, 8, 16, 32]).toContain(segment.crossfadeBars)
    expect(segment.mixEnd).toBeGreaterThan(segment.mixStart)
    if (index === 0) {
      expect(segment.crossfadeIn).toBe(0)
      continue
    }
    const previous = plan.segments[index - 1]
    expect(segment.mixStart).toBeCloseTo(previous.mixEnd - segment.crossfadeIn, 3)
    expect(segment.mixStart).toBeGreaterThan(previous.mixStart)
  }
}

function assertIntact(plan: MixPlan) {
  const byTrack = new Map<string, MixSegment[]>()
  for (const segment of plan.segments) {
    const list = byTrack.get(segment.trackId) ?? []
    list.push(segment)
    byTrack.set(segment.trackId, list)
  }
  for (const list of byTrack.values()) {
    expect(list.length).toBeLessThanOrEqual(3)
    let backward = 0
    let forwardSkips = 0
    for (let index = 1; index < list.length; index++) {
      const previous = list[index - 1]
      const next = list[index]
      if (next.loopStart < previous.loopEnd - 0.5) backward += 1
      else if (next.loopStart > previous.loopEnd + 0.75) forwardSkips += 1
    }
    expect(backward).toBeLessThanOrEqual(1)
    expect(forwardSkips).toBeLessThanOrEqual(1)
  }
  const minimum = Math.min(60, plan.target)
  for (const segment of plan.segments) {
    expect(segment.mixEnd - segment.mixStart).toBeGreaterThanOrEqual(minimum - 0.05)
  }
}

describe("planMix intact", () => {
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
      const plan = planMix(tracks, target, "full-ride")
      expectOnTarget(plan, target)
      assertIntact(plan)
    }
  })

  it.each(["warm-up", "build", "peak", "cool-down"] as IntensityShape[])(
    "hits 20, 30, and 45 minutes for the %s shape",
    (shape) => {
      for (const minutes of [20, 30, 45]) {
        const plan = planMix(rideSet, minutes * 60, shape)
        expectOnTarget(plan, minutes * 60)
        assertIntact(plan)
      }
    },
  )

  it("loops one long section when the songs are shorter than the ride", () => {
    const plan = planMix(shortSet, 20 * 60, "peak")
    expectOnTarget(plan, 20 * 60)
    assertIntact(plan)
    const looped = plan.segments.filter((segment) => segment.repeats > 1.2)
    expect(looped.length).toBeGreaterThan(0)
    expect(looped.length).toBeLessThanOrEqual(3)
    for (const segment of looped) {
      expect(segment.seam).toBeGreaterThan(0)
      expect(segment.bars).toBeGreaterThanOrEqual(8)
    }
  })

  it("trims five six-minute songs toward a 20 minute ride without chopping them up", () => {
    const tracks = [0.28, 0.46, 0.72, 0.9, 0.34].map((energy, index) => sixMinute(`six-${index + 1}`, energy))
    const available = tracks.reduce((sum, track) => sum + track.duration, 0)
    expect(available).toBe(30 * 60)
    const plan = planMix(tracks, 20 * 60, "full-ride")
    expectOnTarget(plan, 20 * 60)
    assertIntact(plan)
    const used = new Set(plan.segments.map((segment) => segment.trackId))
    expect(used.size).toBeLessThan(tracks.length)
    const played = plan.segments.reduce(
      (sum, segment) => sum + (segment.loopEnd - segment.loopStart) * Math.min(segment.repeats, 1),
      0,
    )
    expect(played).toBeLessThan(available - 60)
  })

  it("stretches a single 6 minute song to 20 minutes on one middle loop", () => {
    const song = sixMinute("chant", 0.8)
    expect(song.duration).toBeCloseTo(6 * 60, 5)
    const plan = planMix([song], 20 * 60, "peak")
    expectOnTarget(plan, 20 * 60)
    assertIntact(plan)
    expect(plan.segments.length).toBeLessThanOrEqual(3)
    const groove = plan.segments.find((segment) => segment.part === "groove")
    expect(groove).toBeTruthy()
    expect(groove?.bars).toBeGreaterThanOrEqual(16)
    expect(groove?.bars).toBeLessThanOrEqual(64)
    expect(groove?.repeats).toBeGreaterThan(2)
    expect(groove?.seam).toBeGreaterThan(0)
    expect(groove!.loopStart).toBeGreaterThan(50)
    expect(groove!.loopEnd).toBeLessThan(song.duration - 50)
    const intro = plan.segments.find((segment) => segment.part === "intro")
    const outro = plan.segments.find((segment) => segment.part === "outro")
    expect(intro?.loopStart).toBe(0)
    expect(intro?.loopEnd).toBeCloseTo(groove!.loopStart, 3)
    expect(outro?.loopStart).toBeCloseTo(groove!.loopEnd, 3)
  })

  it("skips or fades a long song instead of slicing it into phrases", () => {
    const plan = planMix(longSet, 5 * 60, "full-ride")
    expectOnTarget(plan, 5 * 60)
    assertIntact(plan)
    const used = new Set(plan.segments.map((segment) => segment.trackId))
    expect(used.size).toBe(1)
    expect(plan.segments.length).toBeLessThanOrEqual(2)
  })

  it("puts higher energy in the peak than in the warm-up", () => {
    const plan = planMix(rideSet, 30 * 60, "full-ride")
    const mean = (phase: MixSegment["phase"]) => {
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
    const weighted = (plan: MixPlan) => {
      const weight = plan.segments.reduce((sum, segment) => sum + (segment.mixEnd - segment.mixStart), 0)
      return plan.segments.reduce((sum, segment) => sum + segment.energy * (segment.mixEnd - segment.mixStart), 0) / weight
    }
    expect(weighted(planMix(rideSet, 20 * 60, "peak"))).toBeGreaterThan(weighted(planMix(rideSet, 20 * 60, "cool-down")) + 0.2)
  })

  it("crossfades track changes on a 16 or 32 bar grid", () => {
    const plan = planMix(rideSet, 30 * 60, "full-ride")
    const blends = plan.segments.filter((segment, index) => {
      if (index === 0) return false
      return plan.segments[index - 1].trackId !== segment.trackId && segment.crossfadeIn > 0
    })
    expect(blends.length).toBeGreaterThan(0)
    for (const blend of blends) expect([16, 32]).toContain(blend.crossfadeBars)
  })

  it("starts a replan on the anchored track when that track is in the ride", () => {
    const plan = planMix(rideSet, 12 * 60, "full-ride", { anchorTrackId: "hard" })
    expect(plan.segments[0].trackId).toBe("hard")
    expectOnTarget(plan, 12 * 60)
    assertIntact(plan)
  })

  it("keeps remix available and off unless asked", () => {
    const intact = planMix(rideSet, 20 * 60, "full-ride")
    const remix = planMix(rideSet, 20 * 60, "full-ride", { mode: "remix" })
    expect(intact.mode).toBe("intact")
    expect(remix.mode).toBe("remix")
    expect(remix.segments.length).toBeGreaterThan(intact.segments.length)
    expect(Math.abs(remix.duration - 20 * 60)).toBeLessThanOrEqual(2)
  })

  it("rejects an empty crate", () => {
    expect(() => planMix([], 600, "full-ride")).toThrow(/track/i)
  })
})

describe("crossfadeBarCount", () => {
  it("uses 16 bars around 128 BPM and 32 bars once that blend is about 48 seconds", () => {
    expect(crossfadeBarCount(100)).toBe(16)
    expect(crossfadeBarCount(128)).toBe(16)
    expect(crossfadeBarCount(160)).toBe(32)
    expect(crossfadeBarCount(174)).toBe(32)
  })
})
