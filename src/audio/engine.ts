import { clamp } from "../lib/format.ts"
import { loopPasses } from "../lib/planner.ts"
import type { MixSegment } from "../lib/types.ts"

/**
 * Schedules phrase loops on the Web Audio clock.
 * `AudioBufferSourceNode.start`'s duration is in buffer time; output length is
 * that duration divided by playbackRate (checked in Chrome).
 */
export class MixEngine {
  private ctx: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private segments: MixSegment[] = []
  private nodes: AudioBufferSourceNode[] = []
  private playing = false
  private origin = 0
  private pausedAt = 0
  private timer = 0
  private scheduled = new Set<string>()
  private readonly lookahead = 12

  /** Call synchronously from a tap or click so Safari will start audio. */
  resume(): void {
    const ctx = this.ensure()
    void ctx.resume()
  }

  get context(): AudioContext {
    return this.ensure()
  }

  get isPlaying(): boolean {
    return this.playing
  }

  setBuffers(buffers: Map<string, AudioBuffer>): void {
    this.buffers = buffers
  }

  loadPlan(segments: MixSegment[]): void {
    this.stopSources()
    window.clearInterval(this.timer)
    this.segments = segments
    this.pausedAt = 0
    this.playing = false
    this.scheduled.clear()
  }

  play(): void {
    const ctx = this.ensure()
    void ctx.resume()
    if (this.segments.length === 0) return
    if (this.pausedAt >= this.duration - 0.05) this.pausedAt = 0
    const lead = 0.05
    this.origin = ctx.currentTime + lead - this.pausedAt
    this.playing = true
    this.scheduled.clear()
    this.pump()
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => this.pump(), 200)
  }

  pause(): void {
    if (this.playing && this.ctx) this.pausedAt = this.currentMixTime()
    this.playing = false
    window.clearInterval(this.timer)
    this.stopSources()
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
  }

  skipToNext(): void {
    const time = this.currentMixTime()
    const index = this.segmentIndexAt(time)
    const current = this.segments[index]
    for (let cursor = index + 1; cursor < this.segments.length; cursor++) {
      const candidate = this.segments[cursor]
      if (!current || candidate.trackId !== current.trackId) {
        this.seek(candidate.mixStart)
        return
      }
    }
    const next = this.segments[index + 1]
    if (!next) {
      this.seek(this.duration)
      return
    }
    this.seek(next.mixStart)
  }

  seek(mixTime: number): void {
    const wasPlaying = this.playing
    this.stopSources()
    window.clearInterval(this.timer)
    this.playing = false
    this.pausedAt = clamp(mixTime, 0, this.duration)
    if (wasPlaying && this.pausedAt < this.duration - 0.05) this.play()
  }

  get duration(): number {
    const last = this.segments[this.segments.length - 1]
    return last ? last.mixEnd : 0
  }

  currentMixTime(): number {
    if (!this.playing || !this.ctx) return this.pausedAt
    return clamp(this.ctx.currentTime - this.origin, 0, this.duration)
  }

  segmentIndexAt(time: number): number {
    let index = 0
    for (let i = 0; i < this.segments.length; i++) {
      if (this.segments[i].mixStart <= time + 0.001) index = i
    }
    return index
  }

  currentSegment(time = this.currentMixTime()): MixSegment | null {
    return this.segments[this.segmentIndexAt(time)] ?? null
  }

  dispose(): void {
    this.pause()
    void this.ctx?.close()
    this.ctx = null
  }

  private ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") this.ctx = new AudioContext()
    return this.ctx
  }

  private pump(): void {
    if (!this.playing || !this.ctx) return
    const mixTime = this.currentMixTime()
    const horizon = mixTime + this.lookahead
    for (let index = 0; index < this.segments.length; index++) {
      const segment = this.segments[index]
      if (segment.mixEnd <= mixTime + 0.03) continue
      if (segment.mixStart > horizon) continue
      this.schedule(index, mixTime, horizon)
    }
    if (mixTime >= this.duration - 0.03) {
      this.pausedAt = this.duration
      this.playing = false
      window.clearInterval(this.timer)
      this.stopSources()
    }
  }

  private schedule(index: number, mixTime: number, horizon: number): void {
    const segment = this.segments[index]
    if (segment.seam > 0.02 && segment.repeats > 1.001) {
      const passes = loopPasses(segment)
      for (let passIndex = 0; passIndex < passes.length; passIndex++) {
        const pass = passes[passIndex]
        const passStart = segment.mixStart + pass.outputStart
        const passEnd = passStart + pass.outputLength
        if (passEnd <= mixTime + 0.03) continue
        if (passStart > horizon) break
        const key = `${index}:${passIndex}`
        if (this.scheduled.has(key)) continue
        this.scheduled.add(key)
        this.startSlice(index, {
          mixStart: passStart,
          mixEnd: Math.min(segment.mixEnd, passEnd),
          sourceOffset: segment.loopStart,
          sourceDuration: pass.sourceDuration,
          seamIn: passIndex > 0 ? segment.seam : 0,
          seamOut: passIndex < passes.length - 1 ? segment.seam : 0,
        })
      }
      return
    }
    const key = `${index}:0`
    if (this.scheduled.has(key)) return
    this.scheduled.add(key)
    this.startSlice(index, {
      mixStart: segment.mixStart,
      mixEnd: segment.mixEnd,
      sourceOffset: segment.loopStart,
      sourceDuration: (segment.loopEnd - segment.loopStart) * segment.repeats,
      seamIn: 0,
      seamOut: 0,
      nativeLoop: segment.repeats > 1.001,
    })
  }

  private startSlice(
    index: number,
    slice: {
      mixStart: number
      mixEnd: number
      sourceOffset: number
      sourceDuration: number
      seamIn: number
      seamOut: number
      nativeLoop?: boolean
    },
  ): void {
    const ctx = this.ctx
    if (!ctx) return
    const segment = this.segments[index]
    const buffer = this.buffers.get(segment.trackId)
    if (!buffer) return
    try {
      const loopStart = clamp(segment.loopStart, 0, Math.max(0, buffer.duration - 0.02))
      const loopEnd = clamp(segment.loopEnd, loopStart + 0.02, buffer.duration)
      const nowMix = Math.max(0, ctx.currentTime - this.origin)
      const startMix = Math.max(slice.mixStart, nowMix)
      if (startMix >= slice.mixEnd - 0.015) return
      const into = (startMix - slice.mixStart) * segment.playbackRate
      const remaining = slice.sourceDuration - into
      if (remaining <= 0.015) return
      const phrase = Math.max(0.02, loopEnd - loopStart)
      const offset = slice.nativeLoop ? loopStart + (into % phrase) : slice.sourceOffset + into
      const when = Math.max(ctx.currentTime + 0.02, this.origin + startMix)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = segment.playbackRate
      if (slice.nativeLoop) {
        source.loop = true
        source.loopStart = loopStart
        source.loopEnd = loopEnd
      }

      const filter = ctx.createBiquadFilter()
      filter.type = "highpass"
      filter.Q.value = 0.7
      filter.frequency.setValueAtTime(35, when)

      const gain = ctx.createGain()
      this.automate(gain, filter, index, when, startMix, slice)
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start(when, clamp(offset, 0, Math.max(0, buffer.duration - 0.01)), remaining)
      this.nodes.push(source)
    } catch (error) {
      console.warn("Ride DJ skipped a segment", error)
    }
  }

  private automate(
    gain: GainNode,
    filter: BiquadFilterNode,
    index: number,
    now: number,
    startMix: number,
    slice: { mixStart: number; mixEnd: number; seamIn: number; seamOut: number },
  ): void {
    const segment = this.segments[index]
    const next = this.segments[index + 1]
    const songFadeOut = next && next.crossfadeIn > 0 ? next.crossfadeIn : 0
    const songFadeIn = segment.crossfadeIn
    const bassSwap = Boolean(next && next.trackId !== segment.trackId && songFadeOut > 0.02)
    const endMix = Math.min(slice.mixEnd, segment.mixEnd)
    const from = Math.max(now, this.origin + startMix)
    const to = this.origin + endMix
    if (to <= from + 0.02) return
    const samples = Math.min(512, Math.max(8, Math.ceil((to - from) / 0.08)))
    const curve = new Float32Array(samples)
    const mix0 = from - this.origin
    const mix1 = to - this.origin
    for (let point = 0; point < samples; point++) {
      const mixAt = mix0 + ((mix1 - mix0) * point) / Math.max(1, samples - 1)
      curve[point] = Math.max(0.0001, this.envelope(segment, mixAt, slice, songFadeIn, songFadeOut))
    }
    gain.gain.setValueCurveAtTime(curve, from, to - from)
    if (bassSwap) {
      const fadeOutStart = this.origin + (segment.mixEnd - songFadeOut)
      const fadeOutEnd = this.origin + segment.mixEnd
      const sweepFrom = Math.max(from + 0.03, fadeOutStart)
      if (sweepFrom < fadeOutEnd - 0.05 && sweepFrom < to) {
        filter.frequency.setValueAtTime(35, sweepFrom)
        filter.frequency.exponentialRampToValueAtTime(280, Math.min(fadeOutEnd, to))
      }
    }
  }

  private envelope(
    segment: MixSegment,
    mixAt: number,
    slice: { mixStart: number; mixEnd: number; seamIn: number; seamOut: number },
    songFadeIn: number,
    songFadeOut: number,
  ): number {
    let value = 1
    if (songFadeIn > 0.02 && mixAt < segment.mixStart + songFadeIn) {
      value *= Math.sin(clamp((mixAt - segment.mixStart) / songFadeIn, 0, 1) * (Math.PI / 2))
    }
    if (songFadeOut > 0.02 && mixAt > segment.mixEnd - songFadeOut) {
      value *= Math.cos(clamp((mixAt - (segment.mixEnd - songFadeOut)) / songFadeOut, 0, 1) * (Math.PI / 2))
    }
    if (slice.seamIn > 0.02 && mixAt < slice.mixStart + slice.seamIn) {
      value *= Math.sin(clamp((mixAt - slice.mixStart) / slice.seamIn, 0, 1) * (Math.PI / 2))
    }
    if (slice.seamOut > 0.02 && mixAt > slice.mixEnd - slice.seamOut) {
      value *= Math.cos(clamp((mixAt - (slice.mixEnd - slice.seamOut)) / slice.seamOut, 0, 1) * (Math.PI / 2))
    }
    return value
  }

  private stopSources(): void {
    for (const node of this.nodes) {
      try {
        node.stop()
        node.disconnect()
      } catch {
        // Already stopped.
      }
    }
    this.nodes = []
    this.scheduled.clear()
  }
}
