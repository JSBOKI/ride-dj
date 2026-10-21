import type { IntensityShape, PhaseName } from "./types.ts"

export const PHASE_META: Record<PhaseName, { label: string; color: string; blurb: string }> = {
  "warm-up": { label: "Warm-up", color: "#ff8a3d", blurb: "Easy spin" },
  build: { label: "Build", color: "#e6c14a", blurb: "Turn the screw" },
  peak: { label: "Peak", color: "#ff4d6a", blurb: "Stay on it" },
  "cool-down": { label: "Cool-down", color: "#3ec7ff", blurb: "Spin it out" },
}

export const SHAPE_META: { id: IntensityShape; label: string; detail: string }[] = [
  { id: "full-ride", label: "Full ride", detail: "Warm up, build, peak, then cool down" },
  { id: "warm-up", label: "Warm-up", detail: "Stay easy the whole way" },
  { id: "build", label: "Build", detail: "Climb from easy to hard" },
  { id: "peak", label: "Peak", detail: "Stay with the hardest songs" },
  { id: "cool-down", label: "Cool-down", detail: "Come down and spin out" },
]

export function shapeLabel(shape: IntensityShape): string {
  return SHAPE_META.find((item) => item.id === shape)?.label ?? shape
}

export function segmentLabel(segment: { trackName: string; part: string; repeats: number }): string {
  if (segment.part === "groove") return `${segment.trackName} · groove`
  if (segment.part === "outro") return `${segment.trackName} · ending`
  if (segment.repeats > 1.2) return `${segment.trackName} · loop`
  return segment.trackName
}
