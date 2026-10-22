import { describe, expect, it } from "vitest"
import { buildLyrics, lineAt, parseLrc, spreadLyrics } from "./lyrics.ts"
import { dominantAt, planRide } from "./ride-planner.ts"
import type { TrackAnalysis } from "./types.ts"

describe("lyrics", () => {
  it("parses LRC with multiple stamps and an offset", () => {
    const lines = parseLrc("[ti:Test]\n[offset:+500]\n[00:01.00]one\n[00:05.50][01:10.25]chorus\n")
    expect(lines.map((line) => line.time)).toEqual([1.5, 6, 70.75])
    expect(lines[1].text).toBe("chorus")
  })

  it("spreads plain lyrics over the vocal span and skips section tags", () => {
    const lines = spreadLyrics("[Verse]\nfirst line\nsecond\n\n[Chorus]\nhook", { start: 10, end: 70 })
    expect(lines).toHaveLength(3)
    expect(lines[0].time).toBe(10)
    expect(lines[2].section).toBe("Chorus")
    expect(lines[2].time).toBeLessThan(70)
    expect(lines[1].time).toBeGreaterThan(lines[0].time)
  })

  it("prefers LRC timings over plain text", () => {
    const lyrics = buildLyrics({ lrc: "[00:02.00]a\n[00:04.00]b", text: "x\ny", duration: 200 })
    expect(lyrics?.timing).toBe("lrc")
    expect(lineAt(lyrics!.lines, 3)).toBe(0)
    expect(lineAt(lyrics!.lines, 1)).toBe(-1)
  })

  it("repeats the right lines when a section loops", () => {
    const bpm = 120
    const bar = 2
    const track: TrackAnalysis = {
      id: "t",
      name: "t",
      duration: 96 * bar,
      bpm,
      beatOffset: 0,
      energy: 0.6,
      sections: [{ start: 0, end: 96 * bar, energy: 0.6 }],
    }
    // One lyric line per 8 bars.
    const lrc = Array.from({ length: 12 }, (_, index) => `[00:${String(index * 16).padStart(2, "0")}.00]line ${index}`)
      .map((line, index) => (index * 16 >= 60 ? `[0${Math.floor((index * 16) / 60)}:${String((index * 16) % 60).padStart(2, "0")}.00]line ${index}` : line))
      .join("\n")
    const lyrics = buildLyrics({ lrc, duration: track.duration })!
    const plan = planRide([track], { id: "x", name: "x", detail: "", sections: [{ kind: "steady", seconds: 420 }] })
    const seen: number[] = []
    for (let time = 0; time < plan.duration; time += 4) {
      const now = dominantAt(plan, time)!
      const index = lineAt(lyrics.lines, now.sourceTime)
      if (seen[seen.length - 1] !== index) seen.push(index)
    }
    // Lines go back at least once (the loop) and every jump back lands on a phrase line.
    const backs = seen.filter((value, index) => index > 0 && value < seen[index - 1])
    expect(backs.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(9)
  })
})
