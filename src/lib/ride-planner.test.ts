import { describe, expect, it } from "vitest"
import { planMix } from "./planner.ts"
import { PRESET_PROGRAMS, programSeconds, SECTION_META, type RideProgram } from "./program.ts"
import { beatGrid, dominantAt, MIN_SONG_SECONDS, planRide, SEAM_BARS, sliceGain } from "./ride-planner.ts"
import type { MixPlan, TrackAnalysis } from "./types.ts"

function song(id: string, bpm: number, bars: { bars: number; energy: number }[], beatOffset = 0.37): TrackAnalysis {
  const bar = 240 / bpm
  let cursor = beatOffset
  const sections = bars.map((part) => {
    const start = cursor
    cursor += part.bars * bar
    return { start, end: cursor, energy: part.energy }
  })
  sections[0].start = 0
  const duration = cursor + 1.3
  sections[sections.length - 1].end = duration
  const energy = sections.reduce((sum, item) => sum + item.energy * (item.end - item.start), 0) / duration
  return { id, name: id, duration, bpm, beatOffset, energy, sections }
}

// Typical 3–5 minute Suno songs: intro, verse, build, drop/chorus, breakdown, chorus, outro.
const typical = (id: string, bpm: number, lift: number) =>
  song(id, bpm, [
    { bars: 8, energy: 0.3 + lift },
    { bars: 16, energy: 0.45 + lift },
    { bars: 8, energy: 0.55 + lift },
    { bars: 16, energy: 0.85 + lift },
    { bars: 16, energy: 0.4 + lift },
    { bars: 16, energy: 0.9 + lift },
    { bars: 16, energy: 0.35 + lift },
  ])

const crate: TrackAnalysis[] = [
  typical("calm-112", 112, -0.15),
  typical("mid-120", 120, 0),
  typical("hot-126", 126, 0.08),
  typical("drive-124", 124, 0.03),
  typical("easy-118", 118, -0.1),
  typical("big-128", 128, 0.1),
]

function assertContinuous(plan: MixPlan, tracks: TrackAnalysis[]) {
  const byId = new Map(tracks.map((track) => [track.id, track]))
  expect(plan.duration).toBeCloseTo(plan.target, 1)
  // No gaps: some slice is audible at every moment except the final fade.
  const endFade = plan.slices.at(-1)!.fadeOut
  for (let time = 0.25; time < plan.duration - endFade; time += 0.5) {
    const loudest = Math.max(...plan.slices.map((slice) => sliceGain(slice, time)))
    // Equal-power blends never dip below -3 dB at the midpoint.
    expect(loudest, `gap at ${time.toFixed(1)}s`).toBeGreaterThan(0.69)
  }
  for (const slice of plan.slices) {
    const track = byId.get(slice.trackId)!
    const grid = beatGrid(track)
    expect(slice.sourceStart).toBeGreaterThanOrEqual(-1e-6)
    expect(slice.sourceEnd).toBeLessThanOrEqual(track.duration + 1e-6)
    expect(slice.playbackRate).toBeGreaterThanOrEqual(0.97 - 1e-9)
    expect(slice.playbackRate).toBeLessThanOrEqual(1.03 + 1e-9)
    if (slice.fadeInKind === "loop") {
      expect(slice.fadeInBars).toBeGreaterThanOrEqual(SEAM_BARS)
      expect(slice.fadeIn * slice.playbackRate).toBeCloseTo(SEAM_BARS * grid.bar, 3)
      // The seam is centred on a phrase line: start + half seam is a downbeat on the 8-bar grid.
      const centre = slice.sourceStart + (SEAM_BARS / 2) * grid.bar
      const barIndex = (centre - grid.d0) / grid.bar
      expect(Math.abs(barIndex - Math.round(barIndex))).toBeLessThan(1e-6)
      expect(Math.round(barIndex) % 8).toBe(0)
    }
    if (slice.fadeInKind === "blend") {
      expect([16, 32]).toContain(slice.fadeInBars)
      expect(slice.fadeIn).toBeGreaterThan(20)
      // Incoming song enters on a downbeat.
      const barIndex = (slice.sourceStart - grid.d0) / grid.bar
      expect(Math.abs(barIndex - Math.round(barIndex))).toBeLessThan(1e-6)
    }
    if (slice.fadeOutKind === "blend") {
      expect([16, 32]).toContain(slice.fadeOutBars)
      const fadeStart = slice.sourceEnd - slice.fadeOut * slice.playbackRate
      const barIndex = (fadeStart - grid.d0) / grid.bar
      expect(Math.abs(barIndex - Math.round(barIndex))).toBeLessThan(1e-4)
    }
  }
  // Song-level: each song plays at least two minutes (or the whole ride).
  const minimum = Math.min(MIN_SONG_SECONDS, plan.target)
  for (const span of plan.songs) {
    expect(span.mixEnd - span.mixStart, `${span.trackName} too short`).toBeGreaterThanOrEqual(minimum - 0.05)
  }
  // Blends overlap exactly where the next song starts.
  for (let index = 1; index < plan.songs.length; index++) {
    const incoming = plan.slices.find((slice) => slice.songIndex === index && slice.fadeInKind === "blend")!
    const outgoing = plan.slices.filter((slice) => slice.songIndex === index - 1).at(-1)!
    expect(outgoing.mixEnd - incoming.mixStart).toBeCloseTo(incoming.fadeIn, 3)
    expect(outgoing.fadeOut).toBeCloseTo(incoming.fadeIn, 3)
  }
}

describe("planRide", () => {
  for (const program of PRESET_PROGRAMS) {
    it(`plans ${program.name} as long, continuous songs`, () => {
      const plan = planRide(crate, program)
      expect(plan.target).toBe(programSeconds(program))
      assertContinuous(plan, crate)
      // A 20–45 min ride should not need more than one song per ~2.5 minutes.
      expect(plan.songs.length).toBeLessThanOrEqual(Math.ceil(plan.target / 150) + 1)
    })
  }

  it("stretches one short song with whole 16/32-bar loops for a long ride", () => {
    const one = [typical("solo", 124, 0)]
    const program: RideProgram = { id: "x", name: "x", detail: "", sections: [{ kind: "steady", seconds: 360 }] }
    const plan = planRide(one, program)
    assertContinuous(plan, one)
    expect(plan.songs[0].loops).toBeGreaterThan(1)
    expect([16, 32]).toContain(plan.songs[0].loopBars)
  })

  it("plays a short ride as one fragment no longer than the ride", () => {
    const program: RideProgram = { id: "x", name: "x", detail: "", sections: [{ kind: "warm-up", seconds: 90 }] }
    const plan = planRide(crate, program)
    expect(plan.songs).toHaveLength(1)
    expect(plan.duration).toBeCloseTo(90, 1)
  })

  it("puts higher-energy songs on climbs and sprints than on recovery", () => {
    const plan = planRide(crate, PRESET_PROGRAMS[1])
    const sections = plan.sectionsTimeline!
    const energyAt = (time: number) => {
      const now = dominantAt(plan, time)!
      return crate.find((track) => track.id === now.slice.trackId)!.energy
    }
    const hard = sections.filter((item) => SECTION_META[item.kind].rpe >= 8)
    const easy = sections.filter((item) => SECTION_META[item.kind].rpe <= 3)
    const mean = (list: typeof sections) =>
      list.reduce((sum, item) => sum + energyAt((item.start + item.end) / 2), 0) / list.length
    expect(mean(hard)).toBeGreaterThan(mean(easy))
  })

  it("keeps lyric time in sync across a loop: the source time repeats", () => {
    const one = [typical("solo", 120, 0)]
    const program: RideProgram = { id: "x", name: "x", detail: "", sections: [{ kind: "steady", seconds: 600 }] }
    const plan = planRide(one, program)
    const seams = plan.slices.filter((slice) => slice.fadeInKind === "loop")
    expect(seams.length).toBeGreaterThan(0)
    const seam = seams[0]
    const before = dominantAt(plan, seam.mixStart + 0.1)!
    const after = dominantAt(plan, seam.mixStart + seam.fadeIn - 0.1)!
    // Before the seam centre we're near the loop end; after it, back near the loop start.
    expect(before.sourceTime).toBeGreaterThan(after.sourceTime)
    // Time advances smoothly within a slice.
    const a = dominantAt(plan, seam.mixStart + seam.fadeIn + 1)!
    const b = dominantAt(plan, seam.mixStart + seam.fadeIn + 3)!
    expect(b.sourceTime - a.sourceTime).toBeCloseTo(2 * seam.playbackRate, 3)
  })

  it("defaults to the intact planner, and Remix only when asked", () => {
    expect(planMix(crate, 1200, "full-ride").mode).toBe("intact")
    const remix = planMix(crate, 1200, "full-ride", { mode: "remix" })
    expect(remix.mode).toBe("remix")
    expect(remix.slices.length).toBeGreaterThan(0)
  })

  it("rejects an empty crate", () => {
    expect(() => planRide([], PRESET_PROGRAMS[0])).toThrow()
  })
})
