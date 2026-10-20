import { useEffect } from "react"

interface MediaSessionControls {
  active: boolean
  playing: boolean
  title: string
  album: string
  duration: number
  position: number
  onPlay: () => void
  onPause: () => void
  onNext: () => void
  onPrevious: () => void
  onSeekForward: () => void
  onSeekBackward: () => void
}

export function useMediaSession(controls: MediaSessionControls): void {
  const {
    active,
    playing,
    title,
    album,
    duration,
    position,
    onPlay,
    onPause,
    onNext,
    onPrevious,
    onSeekForward,
    onSeekBackward,
  } = controls

  useEffect(() => {
    if (!active || !("mediaSession" in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || "Ride DJ",
      artist: "Ride DJ",
      album: album || "Stationary bike",
    })
    navigator.mediaSession.playbackState = playing ? "playing" : "paused"
    const bind = (name: MediaSessionAction, handler: () => void) => {
      try {
        navigator.mediaSession.setActionHandler(name, handler)
      } catch {
        // This action isn't supported here.
      }
    }
    bind("play", onPlay)
    bind("pause", onPause)
    bind("nexttrack", onNext)
    bind("previoustrack", onPrevious)
    bind("seekforward", onSeekForward)
    bind("seekbackward", onSeekBackward)
    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: 1,
          position: Math.min(Math.max(0, position), duration),
        })
      } catch {
        // Some browsers reject a position update mid-transition.
      }
    }
    return () => {
      for (const name of ["play", "pause", "nexttrack", "previoustrack", "seekforward", "seekbackward"] as const) {
        try {
          navigator.mediaSession.setActionHandler(name, null)
        } catch {
          // Ignore.
        }
      }
    }
  }, [active, album, duration, onNext, onPause, onPlay, onPrevious, onSeekBackward, onSeekForward, playing, position, title])
}
