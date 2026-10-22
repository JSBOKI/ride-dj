import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bluetooth, HeartPulse, Pause, Play, SkipForward } from "lucide-react"
import type { MixEngine } from "../audio/engine.ts"
import { Button } from "./ui/button.tsx"
import { LyricsPanel } from "./LyricsPanel.tsx"
import { RideChart } from "./RideChart.tsx"
import { formatBpm, formatClock } from "../lib/format.ts"
import { sectionAt, SECTION_META, targetHr, timeline, type RiderProfile } from "../lib/program.ts"
import { effectiveMaxHr } from "../lib/program.ts"
import { dominantAt } from "../lib/ride-planner.ts"
import { lyricsFor } from "../lib/song-meta.ts"
import type { Lyrics } from "../lib/lyrics.ts"
import type { MixPlan, SongRecord } from "../lib/types.ts"
import { useMediaSession } from "../hooks/useMediaSession.ts"
import { useWakeLock } from "../hooks/useWakeLock.ts"
import { heartRateSupport, useHeartRate } from "../hooks/useHeartRate.ts"
import { useVoiceCue } from "../hooks/useVoiceCue.ts"

interface PlayerScreenProps {
  engine: MixEngine
  plan: MixPlan | null
  profile: RiderProfile
  songs: SongRecord[]
  onBack: () => void
}

const COUNTDOWN = 10

export function PlayerScreen({ engine, plan, profile, songs, onBack }: PlayerScreenProps) {
  const [mixTime, setMixTime] = useState(engine.currentMixTime())
  const [playing, setPlaying] = useState(engine.isPlaying)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMixTime(engine.currentMixTime())
      setPlaying(engine.isPlaying)
    }, 200)
    return () => window.clearInterval(timer)
  }, [engine, plan])

  const clock = useCallback(() => engine.currentMixTime(), [engine])
  const heart = useHeartRate(clock)
  const support = heartRateSupport()
  const speak = useVoiceCue(profile.voice)
  const maxHr = effectiveMaxHr(profile)
  const sections = useMemo(() => plan?.sectionsTimeline ?? (plan?.program ? timeline(plan.program) : []), [plan])
  const total = plan?.duration ?? 0
  const section = sectionAt(sections, mixTime)
  const nextSection = section ? sections[section.index + 1] : undefined
  const sectionLeft = section ? Math.max(0, section.end - mixTime) : 0
  const remaining = Math.max(0, total - mixTime)
  const ended = Boolean(plan) && !playing && mixTime >= total - 0.1
  const wake = useWakeLock(playing)

  const now = plan ? dominantAt(plan, mixTime) : null
  const track = now ? songs.find((song) => song.id === now.slice.trackId) : undefined
  const songIndex = now?.slice.songIndex ?? 0
  const span = plan?.songs[songIndex]
  const nextSong = plan?.songs[songIndex + 1]
  const lyrics = useMemo<Lyrics | null>(() => (track ? lyricsFor(track) : null), [track])

  // Countdown and voice cue before each section change.
  const spoken = useRef(new Set<string>())
  useEffect(() => {
    if (!playing || !nextSection) return
    const left = nextSection.start - mixTime
    const key = `${nextSection.index}`
    if (left <= COUNTDOWN && left > COUNTDOWN - 1.5 && !spoken.current.has(key)) {
      spoken.current.add(key)
      const meta = SECTION_META[nextSection.kind]
      speak(`${meta.label} in ten seconds. ${meta.resistance} resistance, ${meta.cadence.replace("–", " to ")}.`)
    }
    if (left <= 0.6 && left > 0 && !spoken.current.has(`${key}-go`)) {
      spoken.current.add(`${key}-go`)
      speak(nextSection.kind === "sprint" ? "Go!" : SECTION_META[nextSection.kind].cue)
    }
  }, [mixTime, nextSection, playing, speak])
  const countdown = nextSection && playing ? nextSection.start - mixTime : Infinity

  useMediaSession({
    active: Boolean(plan),
    playing,
    title: span?.trackName ?? "Ride DJ",
    album: section ? `${SECTION_META[section.kind].label} · ${formatClock(sectionLeft)} left` : "Ride DJ",
    duration: total,
    position: Math.floor(mixTime),
    onPlay: () => {
      engine.resume()
      engine.play()
    },
    onPause: () => engine.pause(),
    onNext: () => nextSong && engine.seek(nextSong.mixStart),
    onPrevious: () => engine.seek(span ? span.mixStart : 0),
    onSeekForward: () => engine.seek(engine.currentMixTime() + 30),
    onSeekBackward: () => engine.seek(engine.currentMixTime() - 30),
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

  if (!plan) {
    return (
      <div className="flex flex-col items-start gap-3 pt-6">
        <h1 className="font-display text-4xl tracking-wide">Nothing playing</h1>
        <p className="text-sm text-muted-foreground">Set up a ride first.</p>
        <Button onClick={onBack} type="button">
          Go to ride setup
        </Button>
      </div>
    )
  }

  const meta = section ? SECTION_META[section.kind] : null
  const [hrLow, hrHigh] = section ? targetHr(section.kind, maxHr) : [0, 0]

  return (
    <div className="flex flex-col gap-4 pb-8">
      {countdown <= COUNTDOWN && countdown > 0 && nextSection && (
        <div
          className="sticky top-0 z-10 flex items-center justify-between rounded-xl px-4 py-3 text-background shadow-lg"
          style={{ background: SECTION_META[nextSection.kind].color }}
          data-testid="countdown"
          role="status"
        >
          <span className="font-display text-2xl tracking-wide uppercase">{SECTION_META[nextSection.kind].label} in</span>
          <span className="font-display text-5xl tabular-nums">{Math.ceil(countdown)}</span>
        </div>
      )}

      {meta && section && (
        <section
          className="rounded-2xl p-4 ring-2"
          style={{ background: `${meta.color}22`, borderColor: meta.color, ["--tw-ring-color" as string]: meta.color }}
          data-testid="current-section"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
                Section {section.index + 1} of {sections.length}
              </p>
              <p className="font-display text-5xl leading-none tracking-wide uppercase" style={{ color: meta.color }}>
                {meta.label}
              </p>
              <p className="mt-1 text-sm">{meta.cue}</p>
            </div>
            <div className="text-right">
              <p className="font-display text-4xl leading-none tabular-nums">{formatClock(sectionLeft)}</p>
              <p className="text-[11px] text-muted-foreground uppercase">left in section</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            <Stat label="Effort" value={`RPE ${meta.rpe}`} />
            <Stat label="Target HR" value={`${hrLow}–${hrHigh}`} />
            <Stat label="Cadence" value={meta.cadence.replace(" rpm", "")} />
            <Stat label="Resistance" value={meta.resistance} />
          </dl>
          {nextSection && (
            <p className="mt-2 text-xs text-muted-foreground">
              Next: <span style={{ color: SECTION_META[nextSection.kind].color }}>{SECTION_META[nextSection.kind].label}</span> ·{" "}
              {formatClock(nextSection.end - nextSection.start)}
            </p>
          )}
        </section>
      )}

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">Ride</p>
          <p className="font-display text-4xl leading-none tabular-nums">{formatClock(remaining)}</p>
          <p className="text-[11px] text-muted-foreground uppercase">{ended ? "complete" : "remaining"}</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1 font-display text-4xl leading-none tabular-nums">
            <HeartPulse className="size-6 text-[#ff4d6a]" />
            {heart.bpm ?? "—"}
          </p>
          <p className="text-[11px] text-muted-foreground uppercase">
            {heart.bpm ? "bpm live" : `target ${hrLow}–${hrHigh}`}
          </p>
        </div>
      </div>

      <RideChart
        sections={sections}
        total={total}
        time={mixTime}
        maxHr={maxHr}
        heart={heart.samples}
        songStarts={plan.songs.map((song) => song.mixStart).slice(1)}
      />

      <div className="grid grid-cols-[1fr_2fr_1fr] gap-2">
        <Button className="h-16" variant="outline" onClick={() => engine.seek(span ? span.mixStart : 0)} type="button">
          Restart song
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
          {playing ? "Pause" : ended ? "Replay" : "Tap to play"}
        </Button>
        <Button
          className="h-16"
          variant="outline"
          disabled={!nextSong}
          onClick={() => nextSong && engine.seek(nextSong.mixStart)}
          type="button"
        >
          <SkipForward /> Next
        </Button>
      </div>

      <div>
        <p className="truncate text-lg font-medium">{ended ? "Ride complete" : (span?.trackName ?? "")}</p>
        <p className="text-sm text-muted-foreground">
          {span ? `${formatBpm(span.bpm)} BPM` : ""}
          {span && span.loops > 0 ? ` · ${span.loops}× ${span.loopBars}-bar loop` : ""}
          {nextSong ? ` · next: ${nextSong.trackName} at ${formatClock(nextSong.mixStart)}` : ""}
          {wake.supported ? (wake.held ? " · screen stays on" : "") : ""}
        </p>
      </div>

      <LyricsPanel lyrics={lyrics} sourceTime={now?.sourceTime ?? 0} title={span?.trackName ?? ""} />

      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-testid="hr-panel">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Heart rate</h2>
        {support === "supported" ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {heart.status === "connected"
                ? `Connected to ${heart.deviceName}.`
                : heart.message ?? "Connect a Bluetooth heart-rate strap or watch (standard HR service)."}
            </p>
            {heart.status === "connected" ? (
              <Button variant="outline" onClick={heart.disconnect} type="button">
                Disconnect
              </Button>
            ) : (
              <Button onClick={() => void heart.connect()} disabled={heart.status === "connecting"} type="button">
                <Bluetooth /> {heart.status === "connecting" ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {support === "ios"
              ? "Live heart rate isn't available on iPhone/iPad: Safari has no Web Bluetooth. The chart shows your target zone only."
              : "Live heart rate needs Web Bluetooth (Chrome on desktop or Android). Showing your target zone only."}
          </p>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background/60 px-1 py-2">
      <dt className="text-[10px] text-muted-foreground uppercase">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}
