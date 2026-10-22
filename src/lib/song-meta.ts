import sunoMeta from "../config/suno-meta.json"
import { lyricOverrides } from "../config/lyrics.ts"
import { bpmHintFromTags } from "./analyze.ts"
import { buildLyrics, type Lyrics } from "./lyrics.ts"
import { parseSunoLinks } from "./suno.ts"
import type { SongRecord } from "./types.ts"

export interface SunoClipMeta {
  title: string
  tags: string
  displayTags: string
  lyrics: string
  duration: number | null
  instrumental: boolean
}

const meta = sunoMeta as Record<string, SunoClipMeta>

export function sunoIdOf(song: Pick<SongRecord, "sunoUrl">): string | null {
  return song.sunoUrl ? (parseSunoLinks(song.sunoUrl).songs[0]?.id ?? null) : null
}

export function clipMeta(song: Pick<SongRecord, "sunoUrl">): SunoClipMeta | null {
  const id = sunoIdOf(song)
  return id ? (meta[id] ?? null) : null
}

export function bpmHintFor(song: Pick<SongRecord, "sunoUrl">): number | undefined {
  return bpmHintFromTags(clipMeta(song)?.tags)
}

export function lyricsFor(song: SongRecord): Lyrics | null {
  const id = sunoIdOf(song)
  const override = (id && lyricOverrides[id]) || lyricOverrides[song.name]
  const clip = clipMeta(song)
  const bar = song.bpm > 0 ? 240 / song.bpm : 2
  return buildLyrics({
    lrc: song.lrc || override?.lrc,
    text: song.lyrics || (clip && !clip.instrumental ? clip.lyrics : undefined),
    duration: song.duration,
    bar,
  })
}

export function styleFor(song: SongRecord): string | null {
  const clip = clipMeta(song)
  return clip?.displayTags || null
}
