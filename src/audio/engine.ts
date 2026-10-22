import { clamp } from "../lib/format.ts"
import { sliceGain } from "../lib/ride-planner.ts"
import type { Slice } from "../lib/types.ts"

/** Shortest declick ramp on a hard edge. */
const DECLICK = 0.006

function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
}

/**
 * Plays a plan of overlapping slices. Every slice is one AudioBufferSourceNode
 * with an equal-power gain curve; loop seams and song blends are just overlaps.
 */
export class MixEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private mediaElement: HTMLAudioElement | null = null
  private buffers = new Map<string, AudioBuffer>()
  private slices: Slice[] = []
  private nodes = new Map<number, AudioBufferSourceNode>()
  private playing = false
  private origin = 0
  private pausedAt = 0
  private timer = 0
  private readonly lookahead = 10

  /** Call synchronously from a tap or click so iOS Safari will start audio. */
  resume(): void {
    const ctx = this.ensure()
    void ctx.resume()
    if (this.mediaElement) void this.mediaElement.play().catch(() => this.fallbackToDestination())
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

  loadPlan(slices: Slice[]): void {
    this.stopSources()
    window.clearInterval(this.timer)
    this.slices = slices
    this.pausedAt = 0
    this.playing = false
  }

  play(): void {
    const ctx = this.ensure()
    void ctx.resume()
    if (this.mediaElement) void this.mediaElement.play().catch(() => this.fallbackToDestination())
    if (this.slices.length === 0) return
    if (this.pausedAt >= this.duration - 0.05) this.pausedAt = 0
    this.origin = ctx.currentTime + 0.08 - this.pausedAt
    if (this.master) {
      this.master.gain.cancelScheduledValues(ctx.currentTime)
      this.master.gain.setValueAtTime(0.9, ctx.currentTime + 0.07)
    }
    this.playing = true
    this.pump()
    window.clearInterval(this.timer)
    this.timer = window.setInterval(() => this.pump(), 250)
  }

  pause(): void {
    if (this.playing && this.ctx) this.pausedAt = this.currentMixTime()
    this.playing = false
    window.clearInterval(this.timer)
    // Duck the master for a few ms first so pausing never clicks.
    const ctx = this.ctx
    const master = this.master
    if (ctx && master) {
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(0.0001, now + 0.04)
      const nodes = [...this.nodes.values()]
      this.nodes.clear()
      window.setTimeout(() => {
        for (const node of nodes) {
          try {
            node.stop()
            node.disconnect()
          } catch {
            // Already stopped.
          }
        }
      }, 60)
    } else {
      this.stopSources()
    }
  }

  toggle(): void {
    if (this.playing) this.pause()
    else this.play()
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
    let end = 0
    for (const slice of this.slices) end = Math.max(end, slice.mixEnd)
    return end
  }

  currentMixTime(): number {
    if (!this.playing || !this.ctx) return this.pausedAt
    return clamp(this.ctx.currentTime - this.origin, 0, this.duration)
  }

  dispose(): void {
    this.pause()
    void this.ctx?.close()
    this.ctx = null
  }

  private ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ latencyHint: "playback" })
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.9
      // iOS: route through an <audio> element so playback survives the lock
      // screen, ignores the silent switch, and shows Media Session controls.
      if (isAppleMobile() && typeof this.ctx.createMediaStreamDestination === "function") {
        try {
          const stream = this.ctx.createMediaStreamDestination()
          this.master.connect(stream)
          const element = document.createElement("audio")
          element.setAttribute("playsinline", "")
          element.srcObject = stream.stream
          this.mediaElement = element
        } catch {
          this.master.connect(this.ctx.destination)
        }
      } else {
        this.master.connect(this.ctx.destination)
      }
    }
    return this.ctx
  }

  private fallbackToDestination(): void {
    if (!this.ctx || !this.master || !this.mediaElement) return
    this.mediaElement = null
    try {
      this.master.disconnect()
    } catch {
      // Already disconnected.
    }
    this.master.connect(this.ctx.destination)
  }

  private pump(): void {
    if (!this.playing || !this.ctx) return
    const mixTime = this.currentMixTime()
    const horizon = mixTime + this.lookahead
    for (let index = 0; index < this.slices.length; index++) {
      const slice = this.slices[index]
      if (slice.mixEnd <= mixTime + 0.02 || slice.mixStart > horizon) continue
      if (this.nodes.has(index)) continue
      this.start(index)
    }
    for (const [index, node] of this.nodes) {
      if (this.slices[index] && this.slices[index].mixEnd < mixTime - 1) {
        node.disconnect()
        this.nodes.delete(index)
      }
    }
    if (mixTime >= this.duration - 0.02) {
      this.pausedAt = this.duration
      this.playing = false
      window.clearInterval(this.timer)
      this.stopSources()
    }
  }

  private start(index: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const slice = this.slices[index]
    const buffer = this.buffers.get(slice.trackId)
    if (!buffer) return
    try {
      const nowMix = Math.max(0, ctx.currentTime + 0.03 - this.origin)
      const startMix = Math.max(slice.mixStart, nowMix)
      if (startMix >= slice.mixEnd - 0.02) return
      const offset = slice.sourceStart + (startMix - slice.mixStart) * slice.playbackRate
      const when = this.origin + startMix
      const outputLength = slice.mixEnd - startMix
      const sourceLength = Math.min(outputLength * slice.playbackRate, Math.max(0, buffer.duration - offset))
      if (sourceLength <= 0.02) return

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = slice.playbackRate
      const gain = ctx.createGain()
      const filter = ctx.createBiquadFilter()
      filter.type = "highpass"
      filter.Q.value = 0.7
      filter.frequency.setValueAtTime(20, when)
      // Bass swap: the outgoing song thins out in the second half of a blend.
      if (slice.fadeOutKind === "blend" && slice.fadeOut > 1) {
        const swap = this.origin + slice.mixEnd - slice.fadeOut / 2
        if (swap > when) {
          filter.frequency.setValueAtTime(20, swap)
          filter.frequency.exponentialRampToValueAtTime(240, this.origin + slice.mixEnd)
        }
      }
      const endMix = startMix + sourceLength / slice.playbackRate
      const steps = Math.min(2048, Math.max(16, Math.ceil((endMix - startMix) / 0.05)))
      const curve = new Float32Array(steps)
      for (let step = 0; step < steps; step++) {
        const mixAt = startMix + ((endMix - startMix) * step) / (steps - 1)
        let value = sliceGain(slice, mixAt)
        // Declick hard edges (resume mid-slice, or a slice with no fade).
        value *= clamp((mixAt - startMix) / DECLICK, 0, 1)
        value *= clamp((endMix - mixAt) / DECLICK, 0, 1)
        curve[step] = Math.max(0.00001, value)
      }
      gain.gain.setValueCurveAtTime(curve, when, Math.max(0.03, endMix - startMix))
      source.connect(filter)
      filter.connect(gain)
      gain.connect(master)
      source.start(when, clamp(offset, 0, Math.max(0, buffer.duration - 0.01)), sourceLength)
      this.nodes.set(index, source)
    } catch (error) {
      console.warn("Ride DJ skipped a slice", error)
    }
  }

  private stopSources(): void {
    for (const node of this.nodes.values()) {
      try {
        node.stop()
        node.disconnect()
      } catch {
        // Already stopped.
      }
    }
    this.nodes.clear()
  }
}
