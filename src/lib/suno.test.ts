import { describe, expect, it } from "vitest"
import { parseSunoLinks, sunoCdnMp3, sunoCdnMp4 } from "./suno.ts"

describe("parseSunoLinks", () => {
  it("pulls song and playlist ids out of pasted text", () => {
    const parsed = parseSunoLinks(`
      warmup https://suno.com/song/60854e25-c406-4cc4-8bea-f7c36bc989a7
      again https://suno.com/song/60854e25-C406-4CC4-8bea-f7c36bc989a7
      list https://suno.com/playlist/314b51fd-aa1f-4cd8-b761-596a93fb5458
    `)
    expect(parsed.songs).toEqual([
      {
        id: "60854e25-c406-4cc4-8bea-f7c36bc989a7",
        url: "https://suno.com/song/60854e25-c406-4cc4-8bea-f7c36bc989a7",
      },
    ])
    expect(parsed.playlists).toEqual([
      {
        id: "314b51fd-aa1f-4cd8-b761-596a93fb5458",
        url: "https://suno.com/playlist/314b51fd-aa1f-4cd8-b761-596a93fb5458",
      },
    ])
    expect(sunoCdnMp3(parsed.songs[0].id)).toBe(
      "https://cdn1.suno.ai/60854e25-c406-4cc4-8bea-f7c36bc989a7.mp3",
    )
    expect(sunoCdnMp4(parsed.songs[0].id)).toContain(".mp4")
  })

  it("ignores prose that is not a Suno link", () => {
    expect(parseSunoLinks("no links here, just a ride")).toEqual({ songs: [], playlists: [] })
  })
})
