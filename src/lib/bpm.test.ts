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

describe("beat grid", () => {
  it("finds the downbeat and an exact tempo on a long track with a pickup", () => {
    const bpm = 124
    const sampleRate = 22050
    const body = renderClickTrack({ bpm, bars: 96, sampleRate })
    const pad = Math.round(0.73 * sampleRate)
    const samples = new Float32Array(body.length + pad)
    samples.set(body, pad)
    const result = detectBpm(samples, sampleRate)
    expect(Math.abs(result.bpm - bpm)).toBeLessThan(0.05)
    const bar = 240 / bpm
    const expected = 0.73 % bar
    const error = Math.min(Math.abs(result.beatOffset - expected), bar - Math.abs(result.beatOffset - expected))
    expect(error).toBeLessThan(0.02)
    // After 90 bars the grid is still on the beat.
    const drift = Math.abs(90 * (240 / result.bpm) - 90 * bar)
    expect(drift).toBeLessThan(0.03)
  })

  it("uses a style-tag tempo hint to fix half-time detection", () => {
    const samples = renderClickTrack({ bpm: 128, bars: 32, sampleRate: 22050 })
    expect(Math.round(detectBpm(samples, 22050, { hintBpm: 128 }).bpm)).toBe(128)
  })
})
