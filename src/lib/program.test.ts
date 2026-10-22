import { describe, expect, it } from "vitest"
import { maxHrFromAge, meanEffort, PRESET_PROGRAMS, programSeconds, scaleProgram, sectionAt, targetHr, timeline } from "./program.ts"
import { parseHeartRate } from "../hooks/useHeartRate.ts"

describe("ride programs", () => {
  it("presets are 20, 30 and 45 minutes and include every key section", () => {
    expect(PRESET_PROGRAMS.map((program) => programSeconds(program) / 60)).toEqual([20, 30, 45])
    const kinds = new Set(PRESET_PROGRAMS.flatMap((program) => program.sections.map((section) => section.kind)))
    for (const kind of ["warm-up", "climb", "sprint", "recover", "steady", "cool-down"]) expect(kinds).toContain(kind)
  })

  it("scales a program to a new length exactly", () => {
    const scaled = scaleProgram(PRESET_PROGRAMS[1], 40 * 60)
    expect(programSeconds(scaled)).toBe(2400)
    expect(scaled.sections.map((section) => section.kind)).toEqual(PRESET_PROGRAMS[1].sections.map((section) => section.kind))
  })

  it("finds the section at a time and its effort", () => {
    const sections = timeline(PRESET_PROGRAMS[0])
    expect(sectionAt(sections, 0)?.kind).toBe("warm-up")
    expect(sectionAt(sections, 250)?.kind).toBe("sprint")
    expect(meanEffort(sections, 240, 360)).toBeGreaterThan(meanEffort(sections, 0, 240))
  })

  it("derives max and target heart rate", () => {
    expect(maxHrFromAge(40)).toBe(180)
    const [low, high] = targetHr("sprint", 180)
    expect(low).toBeGreaterThan(150)
    expect(high).toBeLessThanOrEqual(180)
  })

  it("parses the BLE heart-rate measurement in uint8 and uint16 form", () => {
    expect(parseHeartRate(new DataView(new Uint8Array([0x00, 72]).buffer))).toBe(72)
    expect(parseHeartRate(new DataView(new Uint8Array([0x01, 0x2c, 0x01]).buffer))).toBe(300)
  })
})
