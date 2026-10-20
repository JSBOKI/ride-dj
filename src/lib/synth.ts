export interface SynthSection {
  bars: number
  energy: number
}

export interface ClickTrackOptions {
  bpm: number
  bars?: number
  sampleRate?: number
  sections?: SynthSection[]
}

/** Click track with a bass tone so both the beat grid and energy changes are obvious. */
export function renderClickTrack(options: ClickTrackOptions): Float32Array {
  const sampleRate = options.sampleRate ?? 22050
  const sections = options.sections ?? [{ bars: options.bars ?? 32, energy: 0.75 }]
  const bars = options.bars ?? sections.reduce((sum, section) => sum + section.bars, 0)
  const beat = 60 / options.bpm
  const length = Math.max(1, Math.floor(bars * beat * 4 * sampleRate))
  const samples = new Float32Array(length)
  const energyAtBar = new Float32Array(bars)
  let cursor = 0
  for (const section of sections) {
    for (let i = 0; i < section.bars && cursor < bars; i++, cursor++) {
      energyAtBar[cursor] = section.energy
    }
  }
  const fallback = sections[sections.length - 1]?.energy ?? 0.6
  while (cursor < bars) energyAtBar[cursor++] = fallback

  const beats = bars * 4
  for (let beatIndex = 0; beatIndex < beats; beatIndex++) {
    const energy = energyAtBar[Math.floor(beatIndex / 4)] ?? fallback
    const start = Math.floor(beatIndex * beat * sampleRate)
    const downbeat = beatIndex % 4 === 0
    const amp = (downbeat ? 1 : 0.7) * (0.3 + 0.7 * energy)
    const kickLength = Math.floor(0.085 * sampleRate)
    for (let i = 0; i < kickLength && start + i < length; i++) {
      const time = i / sampleRate
      const frequency = 190 * Math.exp(-30 * time) + 46
      samples[start + i] += Math.sin(2 * Math.PI * frequency * time) * Math.exp(-24 * time) * amp
    }
    const tone = 50 + energy * 36
    const beatSamples = Math.floor(beat * sampleRate)
    for (let i = 0; i < beatSamples && start + i < length; i++) {
      const time = i / sampleRate
      samples[start + i] += Math.sin(2 * Math.PI * tone * time) * energy * 0.16
    }
  }

  for (let i = 0; i < length; i++) samples[i] = Math.tanh(samples[i])
  return samples
}

export interface DemoTrackSpec {
  name: string
  bpm: number
  sections: SynthSection[]
}

/** Short original clicks used as the in-app demo ride. No recorded music. */
export const DEMO_TRACKS: DemoTrackSpec[] = [
  {
    name: "Warm Spin",
    bpm: 96,
    sections: [
      { bars: 16, energy: 0.26 },
      { bars: 16, energy: 0.4 },
    ],
  },
  {
    name: "Cadence",
    bpm: 114,
    sections: [
      { bars: 16, energy: 0.48 },
      { bars: 16, energy: 0.64 },
    ],
  },
  {
    name: "Redline",
    bpm: 132,
    sections: [
      { bars: 16, energy: 0.78 },
      { bars: 16, energy: 0.96 },
    ],
  },
  {
    name: "Coast",
    bpm: 104,
    sections: [
      { bars: 16, energy: 0.52 },
      { bars: 16, energy: 0.28 },
    ],
  },
]
