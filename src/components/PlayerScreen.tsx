import { useEffect, useState } from "react"
import { Pause, Play, SkipForward } from "lucide-react"
import type { MixEngine } from "../audio/engine.ts"
import { Button } from "./ui/button.tsx"
import { formatBpm, formatClock } from "../lib/format.ts"
import { PHASE_META, shapeLabel } from "../lib/phase.ts"
import type { IntensityShape, MixPlan } from "../lib/types.ts"
import { useMediaSession } from "../hooks/useMediaSession.ts"
import { useWakeLock } from "../hooks/useWakeLock.ts"

interface PlayerScreenProps {
  engine: MixEngine
  plan: MixPlan | null
  shape: IntensityShape
  elapsedBase: number
  onAdjust: (deltaSeconds: number) => void
  onBack: () => void
}

export function PlayerScreen({ engine, plan, shape, elapsedBase, onAdjust, onBack }: PlayerScreenProps) {
  const [mixTime, setMixTime] = useState(0)
  const [playing, setPlaying] = useState(engine.isPlaying)
  const [positionBucket, setPositionBucket] = useState(0)

  useEffect(() => {
    let frame = 0
    const tick = () => {
      setMixTime(engine.currentMixTime())
      setPlaying(engine.isPlaying)
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [engine, plan])

  useEffect(() => {
    const timer = window.setInterval(() => setPositionBucket(Math.floor(engine.currentMixTime())), 1000)
    return () => window.clearInterval(timer)
  }, [engine, plan])

  const segment = plan ? engine.currentSegment(mixTime) ?? plan.segments[0] : null
  const elapsed = elapsedBase + mixTime
  const remaining = plan ? Math.max(0, plan.duration - mixTime) : 0
  const total = elapsedBase + (plan?.duration ?? 0)
  const ended = Boolean(plan) && !playing && mixTime >= (plan?.duration ?? 1) - 0.08
  const wake = useWakeLock(playing)

  useMediaSession({
    active: Boolean(plan),
    playing,
    title: segment?.trackName ?? "Ride DJ",
    album: segment ? PHASE_META[segment.phase].label : shapeLabel(shape),
    duration: total,
    position: Math.min(elapsedBase + positionBucket, total),
    onPlay: () => {
      engine.resume()
      engine.play()
    },
    onPause: () => engine.pause(),
    onNext: () => engine.skipToNext(),
    onPrevious: () => {
      const current = engine.currentSegment()
      engine.seek(current ? current.mixStart : 0)
    },
    onSeekForward: () => onAdjust(60),
    onSeekBackward: () => onAdjust(-60),
  })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (event.code === "Space") {
        event.preventDefault()
        engine.resume()
        engine.toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [engine])

  if (!plan || !segment) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-display text-4xl tracking-wide">Now</h1>
        <p className="text-sm text-muted-foreground">Build a ride first. The player waits here.</p>
        <Button className="h-12" onClick={onBack} type="button">
          Set up a ride
        </Button>
      </div>
    )
  }

  const phase = PHASE_META[segment.phase]

  return (
    <div className="flex flex-col gap-6 pb-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" style={{ color: phase.color }}>
          {phase.label}
          <span className="ml-2 text-muted-foreground">{phase.blurb}</span>
        </p>
        <p className="font-display text-2xl tabular-nums">{formatBpm(segment.bpm)} BPM</p>
      </div>

      <div>
        <p className="sr-only" aria-live="polite">
          {ended
            ? "Ride complete"
            : `${formatClock(elapsedBase + positionBucket)} elapsed, ${formatClock(Math.max(0, (plan?.duration ?? 0) - positionBucket))} remaining, ${phase.label}`}
        </p>
        <p className="font-display text-[22vw] leading-[0.85] font-medium tabular-nums tracking-tight sm:text-8xl">
          {formatClock(elapsed)}
        </p>
        <p className="mt-2 text-muted-foreground">
          <span className="font-display text-4xl text-foreground tabular-nums">{formatClock(remaining)}</span>
          <span className="ml-2 text-sm">{ended ? "complete" : "remaining"}</span>
        </p>
      </div>

      <div>
        <div className="relative h-14 overflow-hidden rounded-xl bg-muted">
          <div className="flex h-full">
            {elapsedBase > 0 && (
              <div style={{ width: `${(elapsedBase / total) * 100}%` }} className="h-full bg-foreground/15" />
            )}
            {plan.segments.map((item, index) => {
              const visualEnd = index < plan.segments.length - 1 ? plan.segments[index + 1].mixStart : item.mixEnd
              return (
                <div
                  key={`${item.mixStart}-${index}`}
                  title={`${PHASE_META[item.phase].label} · ${item.trackName}`}
                  style={{
                    width: `${((visualEnd - item.mixStart) / total) * 100}%`,
                    background: PHASE_META[item.phase].color,
                    opacity: index === engine.segmentIndexAt(mixTime) ? 1 : 0.72,
                  }}
                />
              )
            })}
          </div>
          <div
            className="absolute inset-y-0 w-0.5 bg-foreground"
            style={{ left: `${total > 0 ? (elapsed / total) * 100 : 0}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] tracking-wide text-muted-foreground uppercase">
          {(["warm-up", "build", "peak", "cool-down"] as const).map((name) => (
            <span key={name} className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full" style={{ background: PHASE_META[name].color }} />
              {PHASE_META[name].label}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="truncate text-lg font-medium">{ended ? "Ride complete" : segment.trackName}</p>
        <p className="text-sm text-muted-foreground">
          {shapeLabel(shape)} · {formatClock(total)} planned
          {wake.supported ? (wake.held ? " · screen stays on" : " · wake lock idle") : ""}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button className="h-16" variant="outline" onClick={() => onAdjust(-60)} type="button">
          −1 min
        </Button>
        <Button
          className="h-16 text-base"
          onClick={() => {
            engine.resume()
            if (ended) engine.seek(0)
            engine.toggle()
          }}
          type="button"
        >
          {playing ? <Pause /> : <Play />}
          {playing ? "Pause" : ended ? "Replay" : "Play"}
        </Button>
        <Button className="h-16" variant="outline" onClick={() => onAdjust(60)} type="button">
          +1 min
        </Button>
      </div>
      <Button className="h-12" variant="secondary" onClick={() => engine.skipToNext()} type="button">
        <SkipForward /> Skip to next segment
      </Button>
    </div>
  )
}
