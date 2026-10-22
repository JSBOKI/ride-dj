import { detectBpm } from "./bpm.ts"
import { detectSections } from "./sections.ts"
import type { TrackAnalysis } from "./types.ts"

export function downsample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): { samples: Float32Array; sampleRate: number } {
  if (fromRate <= toRate * 1.05) return { samples, sampleRate: fromRate }
  const ratio = fromRate / toRate
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio))
    let sum = 0
    for (let j = start; j < end; j++) sum += samples[j]
    out[i] = sum / Math.max(1, end - start)
  }
  return { samples: out, sampleRate: toRate }
}

export function audioBufferToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  const channels = buffer.numberOfChannels
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < buffer.length; i++) mono[i] += data[i] / channels
  }
  return mono
}

export function analyzeSamples(
  samples: Float32Array,
  sampleRate: number,
  id: string,
  name: string,
  hintBpm?: number,
): TrackAnalysis {
  const prepared = downsample(samples, sampleRate, 22050)
  const bpm = detectBpm(prepared.samples, prepared.sampleRate, hintBpm ? { hintBpm } : {})
  const safeBpm = Number.isFinite(bpm.bpm) && bpm.bpm >= 40 && bpm.bpm <= 240 ? bpm.bpm : 120
  const sections = detectSections(prepared.samples, prepared.sampleRate, safeBpm, bpm.beatOffset)
  const duration = samples.length / sampleRate
  const covered = sections.reduce((sum, section) => sum + Math.max(0, section.end - section.start), 0)
  const energy =
    covered > 0
      ? sections.reduce((sum, section) => sum + section.energy * (section.end - section.start), 0) / covered
      : 0.5
  return {
    id,
    name,
    duration,
    bpm: safeBpm,
    beatOffset: bpm.beatOffset,
    energy,
    sections,
    analysisVersion: ANALYSIS_VERSION,
  }
}

/** Bump when beat-grid analysis changes so stored songs are re-analysed at ride start. */
export const ANALYSIS_VERSION = 2

/** "… 120 BPM …" in a Suno style prompt. */
export function bpmHintFromTags(tags: string | undefined): number | undefined {
  const match = tags?.match(/(\d{2,3})\s*bpm/i)
  const value = match ? Number(match[1]) : NaN
  return value >= 50 && value <= 220 ? value : undefined
}
