import { describe, expect, it } from "vitest"
import { detectSections } from "./sections.ts"
import { renderClickTrack } from "./synth.ts"

describe("detectSections", () => {
  it("splits a click track where the energy changes", () => {
    const bpm = 120
    const samples = renderClickTrack({
      bpm,
      sampleRate: 22050,
      sections: [
        { bars: 8, energy: 0.22 },
        { bars: 8, energy: 0.9 },
        { bars: 8, energy: 0.38 },
      ],
    })
    const sections = detectSections(samples, 22050, bpm, 0)
    expect(sections.length).toBeGreaterThanOrEqual(3)
    expect(sections[0].energy).toBeLessThan(sections[1].energy)
    expect(sections[1].energy).toBeGreaterThan(sections[2].energy)
    expect(sections[0].start).toBeLessThan(1)
    expect(sections[sections.length - 1].end).toBeGreaterThan(sections[0].end)
  })
})
