import { formatClock } from "../lib/format.ts"
import { SECTION_META, targetHr, type TimedSection } from "../lib/program.ts"
import type { HeartSample } from "../hooks/useHeartRate.ts"

interface RideChartProps {
  sections: TimedSection[]
  total: number
  time: number
  maxHr: number
  heart?: HeartSample[]
  /** Song changes, drawn as ticks. */
  songStarts?: number[]
  compact?: boolean
}

const W = 1000
const H = 260
const PAD_L = 34
const PAD_R = 40
const PAD_T = 14
const PAD_B = 26

/** Effort bars per section, the target heart-rate band, live HR, and a playhead. */
export function RideChart({ sections, total, time, maxHr, heart = [], songStarts = [], compact = false }: RideChartProps) {
  const height = compact ? 170 : H
  const plotW = W - PAD_L - PAD_R
  const plotH = height - PAD_T - PAD_B
  const x = (seconds: number) => PAD_L + (Math.max(0, Math.min(total, seconds)) / Math.max(1, total)) * plotW
  const yEffort = (rpe: number) => PAD_T + plotH - (rpe / 10) * plotH
  const hrLow = Math.round(maxHr * 0.45)
  const hrHigh = maxHr
  const yHr = (bpm: number) => PAD_T + plotH - ((Math.max(hrLow, Math.min(hrHigh, bpm)) - hrLow) / (hrHigh - hrLow)) * plotH
  const current = sections.find((section) => time >= section.start && time < section.end) ?? sections[sections.length - 1]

  let targetPath = ""
  let bandTop = ""
  let bandBottom = ""
  for (const section of sections) {
    const [low, high] = targetHr(section.kind, maxHr)
    const mid = (low + high) / 2
    targetPath += `${targetPath ? "L" : "M"}${x(section.start)},${yHr(mid)}L${x(section.end)},${yHr(mid)}`
    bandTop += `${bandTop ? "L" : "M"}${x(section.start)},${yHr(high)}L${x(section.end)},${yHr(high)}`
    bandBottom = `L${x(section.end)},${yHr(low)}L${x(section.start)},${yHr(low)}` + bandBottom
  }
  const band = bandTop ? `${bandTop}${bandBottom}Z` : ""

  let heartPath = ""
  let lastTime = -Infinity
  for (const sample of heart) {
    if (sample.time > total) break
    if (sample.time - lastTime < total / 600) continue
    heartPath += `${heartPath ? "L" : "M"}${x(sample.time).toFixed(1)},${yHr(sample.bpm).toFixed(1)}`
    lastTime = sample.time
  }

  const ticks: number[] = []
  const step = total > 2400 ? 600 : total > 900 ? 300 : 120
  for (let tick = 0; tick <= total + 1; tick += step) ticks.push(tick)
  const hrTicks = [0.5, 0.6, 0.7, 0.8, 0.9].map((share) => Math.round(maxHr * share))

  return (
    <figure className="w-full" data-testid="ride-chart">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Ride effort by section with target heart rate"
      >
        <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} rx={6} fill="currentColor" opacity={0.04} />
        {[2, 4, 6, 8, 10].map((rpe) => (
          <line key={rpe} x1={PAD_L} x2={PAD_L + plotW} y1={yEffort(rpe)} y2={yEffort(rpe)} stroke="currentColor" opacity={0.07} />
        ))}
        {sections.map((section) => {
          const meta = SECTION_META[section.kind]
          const active = current?.index === section.index
          const width = Math.max(1, x(section.end) - x(section.start) - 1.5)
          return (
            <g key={section.index}>
              <rect
                x={x(section.start) + 0.75}
                y={yEffort(meta.rpe)}
                width={width}
                height={PAD_T + plotH - yEffort(meta.rpe)}
                rx={3}
                fill={meta.color}
                opacity={active ? 0.95 : time >= section.end ? 0.35 : 0.6}
                stroke={active ? "white" : "none"}
                strokeWidth={active ? 2.5 : 0}
              >
                <title>
                  {meta.label} · RPE {meta.rpe} · {formatClock(section.end - section.start)}
                </title>
              </rect>
              {width > 60 && !compact && (
                <text
                  x={x(section.start) + width / 2}
                  y={yEffort(meta.rpe) - 5}
                  textAnchor="middle"
                  fontSize={15}
                  fill="currentColor"
                  opacity={active ? 1 : 0.7}
                >
                  {meta.label}
                </text>
              )}
            </g>
          )
        })}
        {band && <path d={band} fill="#ff4d6a" opacity={0.12} />}
        {targetPath && <path d={targetPath} fill="none" stroke="#ff4d6a" strokeWidth={2.5} strokeDasharray="7 5" />}
        {heartPath && <path d={heartPath} fill="none" stroke="#ffffff" strokeWidth={2.5} strokeLinejoin="round" data-testid="hr-line" />}
        {songStarts.map((start, index) => (
          <line key={index} x1={x(start)} x2={x(start)} y1={PAD_T + plotH} y2={PAD_T + plotH + 6} stroke="currentColor" opacity={0.5} />
        ))}
        {ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={height - 6} textAnchor="middle" fontSize={13} fill="currentColor" opacity={0.55}>
            {Math.round(tick / 60)}′
          </text>
        ))}
        {[2, 5, 8].map((rpe) => (
          <text key={rpe} x={PAD_L - 8} y={yEffort(rpe) + 4} textAnchor="end" fontSize={12} fill="currentColor" opacity={0.5}>
            {rpe}
          </text>
        ))}
        {hrTicks.map((bpm) => (
          <text key={bpm} x={W - PAD_R + 6} y={yHr(bpm) + 4} fontSize={12} fill="#ff8aa0" opacity={0.8}>
            {bpm}
          </text>
        ))}
        <line x1={x(time)} x2={x(time)} y1={PAD_T - 4} y2={PAD_T + plotH + 2} stroke="white" strokeWidth={3} data-testid="playhead" />
        <circle cx={x(time)} cy={PAD_T - 4} r={5} fill="white" />
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>Bars: effort (RPE 1–10)</span>
        <span className="text-[#ff8aa0]">- - target HR (max {maxHr})</span>
        {heartPath && <span className="text-foreground">— your HR</span>}
      </figcaption>
    </figure>
  )
}
