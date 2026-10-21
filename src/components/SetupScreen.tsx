import { useMemo } from "react"
import { Button } from "./ui/button.tsx"
import { Card } from "./ui/card.tsx"
import { Slider } from "./ui/slider.tsx"
import { formatClock } from "../lib/format.ts"
import { PHASE_META, SHAPE_META, segmentLabel, shapeLabel } from "../lib/phase.ts"
import { planMix } from "../lib/planner.ts"
import type { IntensityShape, MixMode, MixPlan } from "../lib/types.ts"
import { useLibrary } from "../state/library.tsx"

const PRESETS = [20, 30, 45]

interface SetupScreenProps {
  minutes: number
  shape: IntensityShape
  mode: MixMode
  onMinutes: (minutes: number) => void
  onShape: (shape: IntensityShape) => void
  onMode: (mode: MixMode) => void
  onStart: () => void
  starting: boolean
}

export function SetupScreen({ minutes, shape, mode, onMinutes, onShape, onMode, onStart, starting }: SetupScreenProps) {
  const library = useLibrary()
  const selected = library.songs.filter((song) => library.selectedIds.includes(song.id) && !song.error && song.duration > 1)

  const preview = useMemo(() => {
    if (selected.length === 0) return null
    try {
      return planMix(selected, minutes * 60, shape, { mode })
    } catch (error) {
      return error instanceof Error ? error : new Error("Couldn't plan that ride.")
    }
  }, [minutes, mode, selected, shape])

  const plan = preview instanceof Error || preview === null ? null : preview
  const planError = preview instanceof Error ? preview.message : null

  return (
    <div className="flex flex-col gap-5 pb-28">
      <div>
        <h1 className="font-display text-4xl leading-none tracking-wide">Ride</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selected.length === 0
            ? "Pick tracks in the library. The mix will land on the length you set."
            : mode === "remix"
              ? `${selected.length} track${selected.length === 1 ? "" : "s"} selected. Remix chops phrases to fill the clock.`
              : `${selected.length} track${selected.length === 1 ? "" : "s"} selected. Songs stay whole and follow the energy of the ride.`}
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Length</h2>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset}
              className="h-12"
              variant={minutes === preset ? "default" : "outline"}
              onClick={() => onMinutes(preset)}
              type="button"
            >
              {preset} min
            </Button>
          ))}
        </div>
        <div className="px-1 pt-2">
          <Slider
            min={10}
            max={90}
            step={1}
            value={[minutes]}
            onValueChange={(value) => onMinutes(value[0] ?? minutes)}
            aria-label="Ride length in minutes"
          />
          <p className="mt-2 text-center font-display text-3xl tabular-nums">{minutes} min</p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Intensity</h2>
        {SHAPE_META.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onShape(item.id)}
            className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
              shape === item.id ? "bg-primary/15 ring-primary" : "bg-card ring-foreground/10"
            }`}
          >
            <span className="block font-medium">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.detail}</span>
          </button>
        ))}
      </section>

      <details className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onMode(mode === "remix" ? "intact" : "remix")}
            className={`rounded-xl px-4 py-3 text-left ring-1 ${
              mode === "remix" ? "bg-primary/15 ring-primary" : "bg-background ring-foreground/10"
            }`}
          >
            <span className="block font-medium">{mode === "remix" ? "Remix is on" : "Remix is off"}</span>
            <span className="text-xs text-muted-foreground">
              {mode === "remix"
                ? "The old planner splices short phrases. Turn it off to keep each song intact."
                : "Intact plays whole songs, with one long middle loop only when the ride needs more time."}
            </span>
          </button>
        </div>
      </details>

      <PlanPreview plan={plan} error={planError} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Saved sessions</h2>
          <Button
            variant="outline"
            className="h-10"
            disabled={selected.length === 0}
            onClick={() => void library.saveSession({ targetSeconds: minutes * 60, shape })}
            type="button"
          >
            Save setup
          </Button>
        </div>
        {library.sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">Saved rides stay on this device.</p>
        )}
        {library.sessions.map((session) => (
          <Card key={session.id} className="flex-row items-center justify-between gap-3 p-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                onMinutes(Math.round(session.targetSeconds / 60))
                onShape(session.shape)
                library.selectOnly(session.songIds)
              }}
            >
              <span className="block font-medium">
                {shapeLabel(session.shape)} · {Math.round(session.targetSeconds / 60)} min
              </span>
              <span className="text-xs text-muted-foreground">{session.songIds.length} tracks</span>
            </button>
            <Button variant="ghost" className="h-10" onClick={() => void library.deleteSession(session.id)} type="button">
              Remove
            </Button>
          </Card>
        ))}
      </section>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-lg border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          className="h-14 w-full text-base"
          disabled={!plan || starting || Boolean(library.busy)}
          onClick={onStart}
          type="button"
        >
          {starting ? "Opening the mix…" : plan ? `Start ${formatClock(plan.duration)} ride` : "Select tracks to start"}
        </Button>
      </div>
    </div>
  )
}

function PlanPreview({ plan, error }: { plan: MixPlan | null; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!plan) return null
  const total = plan.duration || 1
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
            {plan.mode === "remix" ? "Remix" : "Intact"}
          </p>
          <p className="font-display text-3xl leading-none tabular-nums">{formatClock(plan.duration)}</p>
        </div>
        <p className="text-sm text-muted-foreground">{Math.round(plan.masterBpm)} BPM grid</p>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {plan.segments.map((segment, index) => {
          const visualEnd = index < plan.segments.length - 1 ? plan.segments[index + 1].mixStart : segment.mixEnd
          return (
            <div
              key={`${segment.trackId}-${index}`}
              className="h-full border-r border-background/70"
              style={{
                width: `${((visualEnd - segment.mixStart) / total) * 100}%`,
                background: PHASE_META[segment.phase].color,
              }}
            />
          )
        })}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {plan.segments.slice(0, plan.mode === "remix" ? 6 : 12).map((segment, index) => (
          <li key={`${segment.mixStart}-${index}`} className="flex justify-between gap-3">
            <span className="truncate">
              <span style={{ color: PHASE_META[segment.phase].color }}>{PHASE_META[segment.phase].label}</span>
              {" · "}
              {segmentLabel(segment)}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{formatClock(segment.mixEnd - segment.mixStart)}</span>
          </li>
        ))}
        {plan.segments.length > (plan.mode === "remix" ? 6 : 12) && (
          <li className="text-xs text-muted-foreground">
            + {plan.segments.length - (plan.mode === "remix" ? 6 : 12)} more blocks
          </li>
        )}
      </ul>
    </Card>
  )
}
