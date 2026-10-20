import { useState } from "react"
import { AudioLines, Disc3, Library } from "lucide-react"
import { MixEngine } from "./audio/engine.ts"
import { LibraryScreen } from "./components/LibraryScreen.tsx"
import { PlayerScreen } from "./components/PlayerScreen.tsx"
import { SetupScreen } from "./components/SetupScreen.tsx"
import { planMix } from "./lib/planner.ts"
import type { IntensityShape, MixPlan } from "./lib/types.ts"
import { LibraryProvider, readStoredSetup, useLibrary } from "./state/library.tsx"

type View = "library" | "setup" | "player"

export default function App() {
  return (
    <LibraryProvider>
      <RideApp />
    </LibraryProvider>
  )
}

function RideApp() {
  const library = useLibrary()
  const stored = readStoredSetup()
  const [engine] = useState(() => new MixEngine())

  const [view, setView] = useState<View>("library")
  const [minutes, setMinutes] = useState(stored.minutes)
  const [shape, setShape] = useState<IntensityShape>(stored.shape)
  const [plan, setPlan] = useState<MixPlan | null>(null)
  const [elapsedBase, setElapsedBase] = useState(0)
  const [starting, setStarting] = useState(false)
  const [rideError, setRideError] = useState<string | null>(null)

  const changeMinutes = (next: number) => {
    setMinutes(next)
    library.rememberSetup(next, shape)
  }
  const changeShape = (next: IntensityShape) => {
    setShape(next)
    library.rememberSetup(minutes, next)
  }

  const selectedTracks = () =>
    library.songs.filter((song) => library.selectedIds.includes(song.id) && !song.error && song.duration > 1)

  const startRide = async () => {
    engine.resume()
    const tracks = selectedTracks()
    if (tracks.length === 0) {
      setRideError("Pick at least one playable track.")
      return
    }
    setStarting(true)
    setRideError(null)
    try {
      const next = planMix(tracks, minutes * 60, shape)
      const buffers = new Map<string, AudioBuffer>()
      for (const track of tracks) {
        const blob = await library.audioFor(track.id)
        if (!blob) throw new Error(`Audio for ${track.name} isn't on this device anymore.`)
        const bytes = await blob.arrayBuffer()
        buffers.set(track.id, await engine.context.decodeAudioData(bytes))
      }
      engine.setBuffers(buffers)
      engine.loadPlan(next.segments)
      engine.play()
      setPlan(next)
      setElapsedBase(0)
      setView("player")
    } catch (error) {
      setRideError(error instanceof Error ? error.message : "The mix didn't start.")
    } finally {
      setStarting(false)
    }
  }

  const adjust = (delta: number) => {
    if (!plan) return
    const tracks = selectedTracks()
    if (tracks.length === 0) return
    const live = engine.currentMixTime()
    const elapsed = elapsedBase + live
    const requested = Math.min(180 * 60, Math.max(60, elapsed + (plan.duration - live) + delta))
    const remaining = Math.max(30, requested - elapsed)
    const anchor = engine.currentSegment(live)?.trackId
    const next = planMix(tracks, remaining, shape, anchor ? { anchorTrackId: anchor } : {})
    const wasPlaying = engine.isPlaying
    engine.loadPlan(next.segments)
    if (wasPlaying) engine.play()
    setElapsedBase(elapsed)
    setPlan(next)
    setMinutes(Math.max(10, Math.round((elapsed + next.duration) / 60)))
  }

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col">
      <header className="flex items-end justify-between px-4 pt-[max(0.85rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="font-display text-4xl leading-none tracking-wide text-primary">RIDE DJ</p>
          <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">For the bike</p>
        </div>
        <p className="max-w-36 text-right text-[11px] leading-snug text-muted-foreground">
          Beatmatched to the minute
        </p>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        {rideError && view !== "library" && (
          <p className="mb-3 rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive">{rideError}</p>
        )}
        {view === "library" && <LibraryScreen />}
        {view === "setup" && (
          <SetupScreen
            minutes={minutes}
            shape={shape}
            onMinutes={changeMinutes}
            onShape={changeShape}
            onStart={() => void startRide()}
            starting={starting}
          />
        )}
        {view === "player" && (
          <PlayerScreen
            engine={engine}
            plan={plan}
            shape={shape}
            elapsedBase={elapsedBase}
            onAdjust={adjust}
            onBack={() => setView("setup")}
          />
        )}
      </main>
      <nav className="grid grid-cols-3 border-t border-border bg-background pb-[max(0.35rem,env(safe-area-inset-bottom))]">
        <TabButton active={view === "library"} label="Library" onClick={() => setView("library")}>
          <Library />
        </TabButton>
        <TabButton active={view === "setup"} label="Ride" onClick={() => setView("setup")}>
          <Disc3 />
        </TabButton>
        <TabButton active={view === "player"} label="Now" onClick={() => setView("player")}>
          <AudioLines />
        </TabButton>
      </nav>
    </div>
  )
}

function TabButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] tracking-wide ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      {children}
      {label}
    </button>
  )
}
