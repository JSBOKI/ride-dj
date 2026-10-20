import { describe, expect, it } from "vitest"
import { detectBpm } from "./bpm.ts"
import { renderClickTrack } from "./synth.ts"

describe("detectBpm", () => {
  it.each([90, 100, 110, 120, 128, 136, 150])("locks onto a %i BPM click track", (bpm) => {
    const samples = renderClickTrack({ bpm, bars: 32, sampleRate: 22050 })
    const result = detectBpm(samples, 22050)
    expect(Math.abs(result.bpm - bpm)).toBeLessThanOrEqual(1)
    expect(result.beatOffset).toBeGreaterThanOrEqual(0)
    expect(result.beatOffset).toBeLessThan(60 / bpm)
  })
})
