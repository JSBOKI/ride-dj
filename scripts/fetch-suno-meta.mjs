// Fetches public Suno clip metadata (title, style tags, lyrics prompt, duration)
// for every song linked in src/config/playlists.ts and writes
// src/config/suno-meta.json. Browsers can't call this API from our origin
// (CORS), so the app ships the result. Network failures keep the old file.
import { readFileSync, writeFileSync, existsSync } from "node:fs"

const root = new URL("..", import.meta.url)
const playlists = readFileSync(new URL("src/config/playlists.ts", root), "utf8")
const outFile = new URL("src/config/suno-meta.json", root)
const ids = [...new Set([...playlists.matchAll(/suno\.com\/song\/([0-9a-f-]{36})/gi)].map((m) => m[1].toLowerCase()))]
const existing = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : {}
const out = { ...existing }
let fetched = 0
for (const id of ids) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const response = await fetch(`https://studio-api.prod.suno.com/api/clip/${id}`, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) continue
    const clip = await response.json()
    const meta = clip.metadata ?? {}
    out[id] = {
      title: clip.title ?? "",
      tags: meta.tags ?? "",
      displayTags: clip.display_tags ?? "",
      lyrics: meta.prompt ?? "",
      duration: meta.duration ?? null,
      instrumental: Boolean(meta.make_instrumental),
    }
    fetched++
  } catch {
    // Keep what we had.
  }
}
writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n")
console.log(`suno-meta: ${fetched}/${ids.length} clips refreshed, ${Object.keys(out).length} stored`)
