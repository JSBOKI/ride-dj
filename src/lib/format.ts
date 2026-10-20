export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return "00:00"
  const total = Math.max(0, Math.floor(seconds + 1e-4))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const mm = String(minutes).padStart(2, "0")
  const ss = String(secs).padStart(2, "0")
  if (hours > 0) return `${hours}:${mm}:${ss}`
  return `${mm}:${ss}`
}

export function formatBpm(bpm: number): string {
  if (!Number.isFinite(bpm) || bpm <= 0) return "—"
  return String(Math.round(bpm))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
