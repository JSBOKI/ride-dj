export type SectionKind = "warm-up" | "steady" | "climb" | "sprint" | "recover" | "cool-down"

export interface ProgramSection {
  kind: SectionKind
  seconds: number
}

export interface RideProgram {
  id: string
  name: string
  detail: string
  sections: ProgramSection[]
}

export interface SectionMeta {
  label: string
  color: string
  /** RPE 1–10. */
  rpe: number
  /** Target band, % of max heart rate. */
  hr: [number, number]
  cadence: string
  resistance: string
  cue: string
}

export const SECTION_META: Record<SectionKind, SectionMeta> = {
  "warm-up": {
    label: "Warm-up",
    color: "#ff9f43",
    rpe: 3,
    hr: [55, 65],
    cadence: "85–95 rpm",
    resistance: "Light",
    cue: "Easy spin, loosen up",
  },
  steady: {
    label: "Steady",
    color: "#e6c14a",
    rpe: 6,
    hr: [70, 80],
    cadence: "85–95 rpm",
    resistance: "Medium",
    cue: "Hold a tempo you could talk through",
  },
  climb: {
    label: "Climb",
    color: "#ff6b3d",
    rpe: 8,
    hr: [80, 88],
    cadence: "60–75 rpm",
    resistance: "Heavy",
    cue: "Add resistance, drive down through the pedals",
  },
  sprint: {
    label: "Sprint",
    color: "#ff3d6e",
    rpe: 9,
    hr: [88, 95],
    cadence: "100–115 rpm",
    resistance: "Medium-heavy",
    cue: "All out, fast legs",
  },
  recover: {
    label: "Recover",
    color: "#3ec7ff",
    rpe: 3,
    hr: [55, 65],
    cadence: "80–90 rpm",
    resistance: "Light",
    cue: "Back off and breathe",
  },
  "cool-down": {
    label: "Cool-down",
    color: "#7c8cff",
    rpe: 2,
    hr: [50, 60],
    cadence: "75–85 rpm",
    resistance: "Light",
    cue: "Spin it out",
  },
}

export const SECTION_KINDS = Object.keys(SECTION_META) as SectionKind[]

const m = (minutes: number) => Math.round(minutes * 60)
const s = (kind: SectionKind, minutes: number): ProgramSection => ({ kind, seconds: m(minutes) })

export const PRESET_PROGRAMS: RideProgram[] = [
  {
    id: "intervals-20",
    name: "20-min Intervals",
    detail: "Warm up, three sprint/recover rounds, cool down",
    sections: [
      s("warm-up", 4),
      s("sprint", 2),
      s("recover", 2),
      s("sprint", 2),
      s("recover", 2),
      s("sprint", 2),
      s("recover", 2),
      s("cool-down", 4),
    ],
  },
  {
    id: "hills-30",
    name: "30-min Hills",
    detail: "Three climbs with recoveries and a final sprint",
    sections: [
      s("warm-up", 5),
      s("climb", 4),
      s("recover", 2),
      s("climb", 4),
      s("recover", 2),
      s("climb", 4),
      s("sprint", 2),
      s("recover", 2),
      s("cool-down", 5),
    ],
  },
  {
    id: "endurance-45",
    name: "45-min Endurance",
    detail: "Long steady tempo blocks with one climb",
    sections: [
      s("warm-up", 6),
      s("steady", 10),
      s("climb", 4),
      s("recover", 3),
      s("steady", 12),
      s("sprint", 2),
      s("recover", 2),
      s("cool-down", 6),
    ],
  },
]

export function programSeconds(program: { sections: ProgramSection[] }): number {
  return program.sections.reduce((sum, section) => sum + Math.max(0, section.seconds), 0)
}

export interface TimedSection extends ProgramSection {
  index: number
  start: number
  end: number
}

export function timeline(program: { sections: ProgramSection[] }): TimedSection[] {
  let cursor = 0
  return program.sections
    .filter((section) => section.seconds > 0)
    .map((section, index) => {
      const start = cursor
      cursor += section.seconds
      return { ...section, index, start, end: cursor }
    })
}

export function sectionAt(sections: TimedSection[], time: number): TimedSection | null {
  if (sections.length === 0) return null
  for (const section of sections) if (time < section.end) return section
  return sections[sections.length - 1]
}

/** Effort 0–1 from RPE. */
export function effortOf(kind: SectionKind): number {
  return (SECTION_META[kind].rpe - 1) / 9
}

/** Mean effort over [from, to). */
export function meanEffort(sections: TimedSection[], from: number, to: number): number {
  let sum = 0
  let covered = 0
  for (const section of sections) {
    const overlap = Math.min(to, section.end) - Math.max(from, section.start)
    if (overlap > 0) {
      sum += overlap * effortOf(section.kind)
      covered += overlap
    }
  }
  return covered > 0 ? sum / covered : 0.5
}

/** Tanaka et al. 2001: 208 − 0.7 × age. */
export function maxHrFromAge(age: number): number {
  const safe = Number.isFinite(age) ? Math.min(100, Math.max(10, age)) : 40
  return Math.round(208 - 0.7 * safe)
}

export function targetHr(kind: SectionKind, maxHr: number): [number, number] {
  const [low, high] = SECTION_META[kind].hr
  return [Math.round((low / 100) * maxHr), Math.round((high / 100) * maxHr)]
}

/** Fit a program to a different length by scaling every section, rounded to 15 s. */
export function scaleProgram(program: RideProgram, seconds: number): RideProgram {
  const total = programSeconds(program)
  if (total <= 0) return program
  const factor = seconds / total
  const sections = program.sections.map((section) => ({
    kind: section.kind,
    seconds: Math.max(15, Math.round((section.seconds * factor) / 15) * 15),
  }))
  const drift = seconds - programSeconds({ sections })
  sections[sections.length - 1].seconds = Math.max(15, sections[sections.length - 1].seconds + drift)
  return { ...program, sections }
}

const PROFILE_KEY = "ride-dj-profile"

export interface RiderProfile {
  age: number
  /** Overrides the age formula when set. */
  maxHr?: number
  voice: boolean
}

export function readProfile(): RiderProfile {
  const fallback: RiderProfile = { age: 40, voice: true }
  if (typeof localStorage === "undefined") return fallback
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<RiderProfile>
    return {
      age: typeof parsed.age === "number" ? parsed.age : fallback.age,
      maxHr: typeof parsed.maxHr === "number" && parsed.maxHr > 80 ? parsed.maxHr : undefined,
      voice: parsed.voice !== false,
    }
  } catch {
    return fallback
  }
}

export function saveProfile(profile: RiderProfile): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

export function effectiveMaxHr(profile: RiderProfile): number {
  return profile.maxHr ?? maxHrFromAge(profile.age)
}

const PROGRAM_KEY = "ride-dj-program"

export function readStoredProgram(): RideProgram {
  const fallback = PRESET_PROGRAMS[1]
  if (typeof localStorage === "undefined") return fallback
  try {
    const raw = localStorage.getItem(PROGRAM_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as RideProgram
    if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) return fallback
    const sections = parsed.sections.filter(
      (section) => SECTION_KINDS.includes(section.kind) && Number.isFinite(section.seconds) && section.seconds > 0,
    )
    if (sections.length === 0) return fallback
    return { id: String(parsed.id), name: String(parsed.name), detail: String(parsed.detail ?? ""), sections }
  } catch {
    return fallback
  }
}

export function saveProgram(program: RideProgram): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(PROGRAM_KEY, JSON.stringify(program))
}
