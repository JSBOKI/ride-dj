import { useState } from "react"
import { AudioLines, Disc3, Library } from "lucide-react"
import { MixEngine } from "./audio/engine.ts"
import { LibraryScreen } from "./components/LibraryScreen.tsx"
import { PlayerScreen } from "./components/PlayerScreen.tsx"
import { SetupScreen } from "./components/SetupScreen.tsx"
import { analyzeSamples, audioBufferToMono, ANALYSIS_VERSION } from "./lib/analyze.ts"
import { planMix } from "./lib/planner.ts"
import { programSeconds, readProfile, readStoredProgram, saveProfile, saveProgram, type RideProgram, type RiderProfile } from "./lib/program.ts"
import { bpmHintFor } from "./lib/song-meta.ts"
import type { MixMode, MixPlan, SongRecord } from "./lib/types.ts"
import { primeSpeech } from "./hooks/useVoiceCue.ts"
import { LibraryProvider, useLibrary } from "./state/library.tsx"

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
  const [engine] = useState(() => new MixEngine())

  const [view, setView] = useState<View>("library")
  const [program, setProgram] = useState<RideProgram>(() => readStoredProgram())
  const [profile, setProfile] = useState<RiderProfile>(() => readProfile())
  const [mode, setMode] = useState<MixMode>("intact")
  const [plan, setPlan] = useState<MixPlan | null>(null)
  const [starting, setStarting] = useState(false)
  const [rideError, setRideError] = useState<string | null>(null)

  const changeProgram = (next: RideProgram) => {
    setProgram(next)
    saveProgram(next)
    library.rememberSetup(Math.round(programSeconds(next) / 60), "full-ride")
  }
  const changeProfile = (next: RiderProfile) => {
    setProfile(next)
    saveProfile(next)
  }

  const selectedTracks = () =>
    library.songs.filter((song) => library.selectedIds.includes(song.id) && !song.error && song.duration > 1)

  const startRide = async () => {
    // Both must run inside the tap for iOS Safari.
    engine.resume()
    primeSpeech()
    let tracks = selectedTracks()
    if (tracks.length === 0) {
      setRideError("Pick at least one playable track.")
      return
    }
    setStarting(true)
    setRideError(null)
    try {
      const buffers = new Map<string, AudioBuffer>()
      const refreshed: SongRecord[] = []
      for (const track of tracks) {
        const blob = await library.audioFor(track.id)
        if (!blob) throw new Error(`Audio for ${track.name} isn't on this device anymore.`)
        const bytes = await blob.arrayBuffer()
        const buffer = await engine.context.decodeAudioData(bytes)
        buffers.set(track.id, buffer)
        // Songs analysed by an older version get a fresh beat grid (tempo, downbeat).
        if ((track.analysisVersion ?? 1) < ANALYSIS_VERSION && track.source !== "demo") {
          const analysis = analyzeSamples(audioBufferToMono(buffer), buffer.sampleRate, track.id, track.name, bpmHintFor(track))
          const updated: SongRecord = { ...track, ...analysis, id: track.id, name: track.name }
          await library.updateSong(updated)
          refreshed.push(updated)
        } else {
          refreshed.push(track)
        }
      }
      tracks = refreshed
      const next = planMix(tracks, programSeconds(program), "full-ride", { mode, program })
      engine.setBuffers(buffers)
      engine.loadPlan(next.slices)
      engine.play()
      setPlan(next)
      setView("player")
    } catch (error) {
      setRideError(error instanceof Error ? error.message : "The mix didn't start.")
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-lg flex-col">
      <header className="flex items-end justify-between px-4 pt-[max(0.85rem,env(safe-area-inset-top))] pb-3">
        <div>
          <p className="font-display text-4xl leading-none tracking-wide text-primary">RIDE DJ</p>
          <p className="mt-1 text-xs tracking-wide text-muted-foreground uppercase">For the bike</p>
        </div>
        <p className="max-w-36 text-right text-[11px] leading-snug text-muted-foreground">
          Whole songs, beatmatched to your ride
        </p>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        {rideError && view !== "library" && (
          <p className="mb-3 rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive">{rideError}</p>
        )}
        {view === "library" && <LibraryScreen />}
        {view === "setup" && (
          <SetupScreen
            program={program}
            onProgram={changeProgram}
            profile={profile}
            onProfile={changeProfile}
            mode={mode}
            onMode={setMode}
            onStart={() => void startRide()}
            starting={starting}
          />
        )}
        {view === "player" && (
          <PlayerScreen engine={engine} plan={plan} profile={profile} songs={library.songs} onBack={() => setView("setup")} />
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
