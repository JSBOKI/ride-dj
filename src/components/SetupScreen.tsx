import { useMemo } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "./ui/button.tsx"
import { Card } from "./ui/card.tsx"
import { Slider } from "./ui/slider.tsx"
import { RideChart } from "./RideChart.tsx"
import { formatClock } from "../lib/format.ts"
import { planMix } from "../lib/planner.ts"
import {
  effectiveMaxHr,
  maxHrFromAge,
  PRESET_PROGRAMS,
  programSeconds,
  scaleProgram,
  SECTION_KINDS,
  SECTION_META,
  targetHr,
  timeline,
  type RideProgram,
  type RiderProfile,
  type SectionKind,
} from "../lib/program.ts"
import type { MixMode, MixPlan } from "../lib/types.ts"
import { useLibrary } from "../state/library.tsx"
import { heartRateSupport } from "../hooks/useHeartRate.ts"

interface SetupScreenProps {
  program: RideProgram
  onProgram: (program: RideProgram) => void
  profile: RiderProfile
  onProfile: (profile: RiderProfile) => void
  mode: MixMode
  onMode: (mode: MixMode) => void
  onStart: () => void
  starting: boolean
}

export function SetupScreen({ program, onProgram, profile, onProfile, mode, onMode, onStart, starting }: SetupScreenProps) {
  const library = useLibrary()
  const selected = library.songs.filter((song) => library.selectedIds.includes(song.id) && !song.error && song.duration > 1)
  const total = programSeconds(program)
  const sections = useMemo(() => timeline(program), [program])
  const maxHr = effectiveMaxHr(profile)

  const preview = useMemo(() => {
    if (selected.length === 0) return null
    try {
      return planMix(selected, total, "full-ride", { mode, program })
    } catch (error) {
      return error instanceof Error ? error : new Error("Couldn't plan that ride.")
    }
  }, [mode, program, selected, total])
  const plan = preview instanceof Error || preview === null ? null : preview
  const planError = preview instanceof Error ? preview.message : null

  const custom = (sectionsNext: RideProgram["sections"]) =>
    onProgram({ id: "custom", name: "Custom", detail: "Your own sections", sections: sectionsNext })
  const editSection = (index: number, patch: Partial<{ kind: SectionKind; seconds: number }>) =>
    custom(program.sections.map((section, at) => (at === index ? { ...section, ...patch } : section)))
  const move = (index: number, delta: number) => {
    const next = [...program.sections]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    custom(next)
  }

  const hr = heartRateSupport()

  return (
    <div className="flex flex-col gap-5 pb-28">
      <div>
        <h1 className="font-display text-4xl leading-none tracking-wide">Ride</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {selected.length === 0
            ? "Pick tracks in the library. Songs play whole and follow the sections of your ride."
            : `${selected.length} track${selected.length === 1 ? "" : "s"} selected. Harder songs land on climbs and sprints, calmer ones on recovery.`}
        </p>
      </div>

      <section className="flex flex-col gap-2" data-testid="program-presets">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Program</h2>
        {PRESET_PROGRAMS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onProgram(preset)}
            className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
              program.id === preset.id ? "bg-primary/15 ring-primary" : "bg-card ring-foreground/10"
            }`}
          >
            <span className="block font-medium">{preset.name}</span>
            <span className="text-xs text-muted-foreground">{preset.detail}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => custom(program.sections)}
          className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
            program.id === "custom" ? "bg-primary/15 ring-primary" : "bg-card ring-foreground/10"
          }`}
        >
          <span className="block font-medium">Custom</span>
          <span className="text-xs text-muted-foreground">Start from the current program and edit the sections</span>
        </button>
      </section>

      <Card className="gap-3 p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">{program.name}</p>
            <p className="font-display text-3xl leading-none tabular-nums">{formatClock(total)}</p>
          </div>
          <p className="text-sm text-muted-foreground">{sections.length} sections</p>
        </div>
        <RideChart sections={sections} total={total} time={0} maxHr={maxHr} songStarts={plan?.songs.map((song) => song.mixStart).slice(1)} compact />
        <div className="px-1 pt-1">
          <Slider
            min={10}
            max={90}
            step={1}
            value={[Math.round(total / 60)]}
            onValueChange={(value) => {
              const minutes = value[0] ?? Math.round(total / 60)
              onProgram({ ...scaleProgram(program, minutes * 60), id: program.id === "custom" ? "custom" : `${program.id}-scaled`, name: program.name })
            }}
            aria-label="Ride length in minutes (scales every section)"
          />
          <p className="mt-1 text-center text-xs text-muted-foreground">Drag to scale every section to a new length</p>
        </div>
      </Card>

      {program.id === "custom" && (
        <section className="flex flex-col gap-2" data-testid="custom-builder">
          <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Sections</h2>
          {program.sections.map((section, index) => (
            <div key={index} className="flex items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-foreground/10">
              <span className="size-3 shrink-0 rounded-full" style={{ background: SECTION_META[section.kind].color }} />
              <select
                className="h-10 min-w-0 flex-1 rounded-lg bg-muted px-2 text-sm"
                value={section.kind}
                onChange={(event) => editSection(index, { kind: event.target.value as SectionKind })}
                aria-label="Section type"
              >
                {SECTION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {SECTION_META[kind].label} · RPE {SECTION_META[kind].rpe}
                  </option>
                ))}
              </select>
              <input
                className="h-10 w-16 rounded-lg bg-muted px-2 text-right text-sm tabular-nums"
                type="number"
                inputMode="decimal"
                min={0.5}
                step={0.5}
                value={Math.round((section.seconds / 60) * 2) / 2}
                onChange={(event) => {
                  const minutes = Number(event.target.value)
                  if (Number.isFinite(minutes) && minutes > 0) editSection(index, { seconds: Math.round(minutes * 60) })
                }}
                aria-label="Minutes"
              />
              <span className="text-xs text-muted-foreground">min</span>
              <Button variant="ghost" size="icon" type="button" onClick={() => move(index, -1)} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon" type="button" onClick={() => move(index, 1)} aria-label="Move down">
                <ArrowDown />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                disabled={program.sections.length <= 1}
                onClick={() => custom(program.sections.filter((_, at) => at !== index))}
                aria-label="Remove section"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            className="h-11"
            type="button"
            onClick={() => custom([...program.sections, { kind: "steady", seconds: 180 }])}
          >
            <Plus /> Add section
          </Button>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Effort guide</h2>
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {SECTION_KINDS.map((kind) => {
            const meta = SECTION_META[kind]
            const [low, high] = targetHr(kind, maxHr)
            return (
              <li key={kind} className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 ring-1 ring-foreground/10">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: meta.color }} />
                <span className="w-20 font-medium">{meta.label}</span>
                <span className="text-muted-foreground">
                  RPE {meta.rpe} · {low}–{high} bpm · {meta.cadence} · {meta.resistance}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">You</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Age
            <input
              className="h-11 rounded-lg bg-muted px-3 tabular-nums"
              type="number"
              inputMode="numeric"
              min={10}
              max={100}
              value={profile.age}
              onChange={(event) => {
                const age = Number(event.target.value)
                if (Number.isFinite(age)) onProfile({ ...profile, age })
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Max HR
            <input
              className="h-11 rounded-lg bg-muted px-3 tabular-nums"
              type="number"
              inputMode="numeric"
              min={100}
              max={230}
              placeholder={String(maxHrFromAge(profile.age))}
              value={profile.maxHr ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value)
                onProfile({ ...profile, maxHr: event.target.value === "" || !Number.isFinite(value) ? undefined : value })
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Max HR {maxHr} bpm {profile.maxHr ? "(your setting)" : `(from age: 208 − 0.7 × ${profile.age})`}. Saved on this device.
        </p>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={profile.voice}
            onChange={(event) => onProfile({ ...profile, voice: event.target.checked })}
          />
          Spoken cues before each section change
        </label>
        <p className="text-xs text-muted-foreground">
          {hr === "supported"
            ? "Live heart rate: connect a Bluetooth chest strap or watch broadcasting HR on the Now screen."
            : hr === "ios"
              ? "Live heart rate needs Web Bluetooth, which iPhone and iPad Safari don't support. The chart shows your target heart rate only."
              : "Live heart rate needs Web Bluetooth (Chrome on desktop or Android). This browser will show target heart rate only."}
        </p>
      </section>

      <PlanPreview plan={plan} error={planError} />

      <details className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onMode(mode === "remix" ? "intact" : "remix")}
            className={`rounded-xl px-4 py-3 text-left ring-1 transition ${
              mode === "remix" ? "bg-primary/15 ring-primary" : "bg-background ring-foreground/10"
            }`}
          >
            <span className="block font-medium">Remix mode {mode === "remix" ? "on" : "off"}</span>
            <span className="text-xs text-muted-foreground">
              {mode === "remix"
                ? "The old planner splices short phrases. Turn it off to keep each song whole."
                : "Off: songs play whole. Turn on only if you want short chopped phrases."}
            </span>
          </button>
        </div>
      </details>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-lg border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button
          className="h-14 w-full text-base"
          disabled={!plan || starting || Boolean(library.busy)}
          onClick={onStart}
          type="button"
        >
          {starting ? "Opening the mix…" : plan ? `Tap to start ${formatClock(plan.duration)} ride` : "Select tracks to start"}
        </Button>
      </div>
    </div>
  )
}

function PlanPreview({ plan, error }: { plan: MixPlan | null; error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!plan) return null
  return (
    <Card className="gap-2 p-4">
      <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
        {plan.mode === "remix" ? "Remix" : "Song order"} · {Math.round(plan.masterBpm)} BPM
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        {plan.songs.map((song, index) => (
          <li key={`${song.trackId}-${index}`} className="flex justify-between gap-3">
            <span className="truncate">
              {song.trackName}
              {song.loops > 0 && <span className="text-muted-foreground"> · +{song.loops}×{song.loopBars} bars</span>}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatClock(song.mixStart)} · {formatClock(song.mixEnd - song.mixStart)}
            </span>
          </li>
        ))}
        {plan.mode === "remix" && <li className="text-muted-foreground">{plan.slices.length} chopped phrases</li>}
      </ul>
    </Card>
  )
}
