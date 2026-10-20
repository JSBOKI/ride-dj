import { clamp } from "../lib/format.ts"
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
  private scheduled = new Set<number>()
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
      if (this.scheduled.has(index)) continue
      if (segment.mixEnd <= mixTime + 0.03) continue
      if (segment.mixStart > horizon) continue
      this.schedule(index)
      this.scheduled.add(index)
    }
    if (mixTime >= this.duration - 0.03) {
      this.pausedAt = this.duration
      this.playing = false
      window.clearInterval(this.timer)
      this.stopSources()
    }
  }

  private schedule(index: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const segment = this.segments[index]
    const buffer = this.buffers.get(segment.trackId)
    if (!buffer) return
    try {
      const loopStart = clamp(segment.loopStart, 0, Math.max(0, buffer.duration - 0.02))
      const loopEnd = clamp(segment.loopEnd, loopStart + 0.02, buffer.duration)
      const phrase = loopEnd - loopStart
      const totalSource = phrase * segment.repeats
      const nowMix = Math.max(0, ctx.currentTime - this.origin)
      const startMix = Math.max(segment.mixStart, nowMix)
      if (startMix >= segment.mixEnd - 0.015) return
      const intoSource = (startMix - segment.mixStart) * segment.playbackRate
      const remaining = totalSource - intoSource
      if (remaining <= 0.015) return
      const offset = loopStart + (intoSource % phrase)
      const when = Math.max(ctx.currentTime + 0.02, this.origin + startMix)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = segment.playbackRate
      if (segment.repeats > 1.001 || intoSource + 0.001 > phrase) {
        source.loop = true
        source.loopStart = loopStart
        source.loopEnd = loopEnd
      }

      const filter = ctx.createBiquadFilter()
      filter.type = "highpass"
      filter.Q.value = 0.7
      filter.frequency.setValueAtTime(35, when)

      const gain = ctx.createGain()
      this.automate(gain, filter, index, when, startMix)
      source.connect(filter)
      filter.connect(gain)
      gain.connect(ctx.destination)
      source.start(when, Math.min(offset, buffer.duration - 0.01), remaining)
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
  ): void {
    const segment = this.segments[index]
    const next = this.segments[index + 1]
    const fadeOut = next && next.trackId !== segment.trackId ? next.crossfadeIn : 0
    const fadeIn = segment.crossfadeIn
    const ctxAt = (mixTime: number) => this.origin + mixTime
    const fadeInEnd = ctxAt(segment.mixStart + fadeIn)
    const fadeOutStart = ctxAt(segment.mixEnd - fadeOut)
    const fadeOutEnd = ctxAt(segment.mixEnd)

    let value = 1
    if (fadeIn > 0.02 && startMix < segment.mixStart + fadeIn) {
      value = Math.sin(clamp((startMix - segment.mixStart) / fadeIn, 0, 1) * (Math.PI / 2))
    }
    if (fadeOut > 0.02 && startMix > segment.mixEnd - fadeOut) {
      value = Math.cos(clamp((startMix - (segment.mixEnd - fadeOut)) / fadeOut, 0, 1) * (Math.PI / 2))
    }
    const level = gain.gain
    level.setValueAtTime(Math.max(0.0001, value), now)
    if (fadeIn > 0.02 && fadeInEnd > now + 0.03) level.linearRampToValueAtTime(1, fadeInEnd)
    if (fadeOut > 0.02 && fadeOutEnd > now + 0.06) {
      const hold = Math.max(now + 0.04, fadeIn > 0 ? fadeInEnd : now, fadeOutStart)
      if (hold < fadeOutEnd - 0.04) level.linearRampToValueAtTime(1, hold)
      level.linearRampToValueAtTime(0.0001, fadeOutEnd)
      const sweepFrom = Math.max(now + 0.03, fadeOutStart)
      if (sweepFrom < fadeOutEnd - 0.05) {
        filter.frequency.setValueAtTime(35, sweepFrom)
        filter.frequency.exponentialRampToValueAtTime(280, fadeOutEnd)
      }
    }
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
