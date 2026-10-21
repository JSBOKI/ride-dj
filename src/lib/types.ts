export type PhaseName = "warm-up" | "build" | "peak" | "cool-down"

/** Full ride runs all four phases. The others stay in one gear. */
export type IntensityShape = "full-ride" | PhaseName

export type SongSource = "file" | "suno" | "demo"

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
  duration: number
  target: number
  masterBpm: number
  shape: IntensityShape
  mode: MixMode
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
