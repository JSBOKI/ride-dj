import { useEffect, useRef } from "react"
import { lineAt, type Lyrics } from "../lib/lyrics.ts"

interface LyricsPanelProps {
  lyrics: Lyrics | null
  sourceTime: number
  title: string
}

/** Karaoke view: the current line is highlighted and kept centred. */
export function LyricsPanel({ lyrics, sourceTime, title }: LyricsPanelProps) {
  const box = useRef<HTMLDivElement>(null)
  const index = lyrics ? lineAt(lyrics.lines, sourceTime) : -1
  useEffect(() => {
    const container = box.current
    if (!container) return
    const active = container.querySelector<HTMLElement>("[data-active='true']")
    if (!active) {
      container.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    container.scrollTo({ top: active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2, behavior: "smooth" })
  }, [index, lyrics])

  return (
    <section className="rounded-xl bg-card ring-1 ring-foreground/10" data-testid="lyrics-panel">
      <header className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Lyrics</h2>
        {lyrics && (
          <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {lyrics.timing === "lrc" ? "synced" : "estimated timing"}
          </span>
        )}
      </header>
      <div ref={box} className="relative h-48 overflow-y-auto px-4 pt-2 pb-16 [mask-image:linear-gradient(transparent,black_18%,black_70%,transparent)]">
        {!lyrics && <p className="pt-12 text-center text-sm text-muted-foreground">No lyrics for {title || "this track"}.</p>}
        {lyrics?.lines.map((line, lineIndex) => {
          const active = lineIndex === index
          const header = line.section && line.section !== lyrics.lines[lineIndex - 1]?.section
          return (
            <div key={`${line.time}-${lineIndex}`}>
              {header && <p className="mt-3 text-[10px] tracking-[0.18em] text-muted-foreground uppercase">{line.section}</p>}
              <p
                data-active={active}
                className={`py-0.5 transition-all duration-300 ${
                  active
                    ? "text-xl font-semibold text-primary"
                    : lineIndex < index
                      ? "text-base text-muted-foreground/60"
                      : "text-base text-muted-foreground"
                }`}
              >
                {line.text || "♪"}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
