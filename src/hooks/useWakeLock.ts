import { useEffect, useState } from "react"

export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!active || !supported) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen")
        if (cancelled) {
          await next.release()
          return
        }
        lock = next
        setHeld(true)
        next.addEventListener("release", () => {
          if (!cancelled) setHeld(false)
        })
      } catch {
        if (!cancelled) setHeld(false)
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisible)
      void lock?.release()
    }
  }, [active, supported])

  return { supported, held: active && held }
}
