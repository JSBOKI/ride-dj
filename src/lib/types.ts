import type { RideProgram, TimedSection } from "./program.ts"

export type PhaseName = "warm-up" | "build" | "peak" | "cool-down"

/** Full ride runs all four phases. The others stay in one gear. */
export type IntensityShape = "full-ride" | PhaseName

export type SongSource = "file" | "suno" | "demo" | "web"

export interface Section {
  /** Seconds from the start of the track. */
  start: number
  end: number
  /** 0–1, relative to the loudest moment in the track. */
  energy: number
}

export interface TrackAnalysis {
  id: string
  name: string
  duration: number
  bpm: number
  /** Seconds to the first downbeat. */
  beatOffset: number
  energy: number
  sections: Section[]
  analysisVersion?: number
}

export interface MixSegment {
  trackId: string
  trackName: string
  phase: PhaseName
  loopStart: number
  loopEnd: number
  /** How many times the phrase plays. Fractional values trim the last pass. */
  repeats: number
  playbackRate: number
  /** BPM heard after playbackRate. */
  bpm: number
  energy: number
  /** Bars in a single pass of the phrase. */
  bars: number
  sourceLimit: number
  mixStart: number
  mixEnd: number
  /** Overlap with the previous segment, in output seconds. */
  crossfadeIn: number
  /** 0 when segments abut. 8 or 16 in Remix. 16 or 32 between intact songs. */
  crossfadeBars: 0 | 8 | 16 | 32
  /**
   * Equal-power overlap between loop passes, in output seconds.
   * 0 plays a hard loop (Remix) or a single pass.
   */
  seam: number
  /** Which part of the song this block is. Intact songs use at most intro, groove, and outro. */
  part: "song" | "intro" | "groove" | "outro"
}

export type MixMode = "intact" | "remix"

export interface MixPlan {
  segments: MixSegment[]
  slices: Slice[]
  songs: SongSpan[]
  duration: number
  target: number
  masterBpm: number
  shape: IntensityShape
  mode: MixMode
  program?: RideProgram
  sectionsTimeline?: TimedSection[]
}

export interface BpmResult {
  bpm: number
  confidence: number
  beatOffset: number
}

export interface SongRecord extends TrackAnalysis {
  source: SongSource
  sunoUrl?: string
  loadNote?: string
  error?: string
  createdAt: number
  /** Optional LRC lyrics ([mm:ss.xx] line) with exact timings. */
  lrc?: string
  /** Plain lyrics without timings. */
  lyrics?: string
}

export interface PlaylistRecord {
  id: string
  name: string
  songIds: string[]
  sunoUrl?: string
  builtin: boolean
  note?: string
}

export interface SessionRecord {
  id: string
  name: string
  createdAt: number
  targetSeconds: number
  shape: IntensityShape
  songIds: string[]
}

/** One scheduled buffer source in the mix. Consecutive slices overlap by their fades. */
export interface Slice {
  trackId: string
  trackName: string
  /** Index into plan.songs. */
  songIndex: number
  mixStart: number
  mixEnd: number
  /** Source seconds at mixStart. The slice plays forward at playbackRate. */
  sourceStart: number
  sourceEnd: number
  playbackRate: number
  /** Equal-power fade lengths in output seconds. */
  fadeIn: number
  fadeOut: number
  fadeInBars: number
  fadeOutBars: number
  /** "loop" fades are seams inside one song; "blend" fades are song-to-song DJ mixes. */
  fadeInKind: "none" | "loop" | "blend" | "start"
  fadeOutKind: "none" | "loop" | "blend" | "end"
  bpm: number
}

export interface SongSpan {
  trackId: string
  trackName: string
  mixStart: number
  mixEnd: number
  /** BPM heard after rate. */
  bpm: number
  playbackRate: number
  energy: number
  loops: number
  loopBars: number
  /** Bars in the blend into this song (0 for the first). */
  blendInBars: number
  /** False when the tempo gap was wider than ±3% so beats drift during the blend. */
  beatMatched: boolean
  /** Mix time where the song's strongest section starts, if it is in the ride. */
  dropAt?: number
}
