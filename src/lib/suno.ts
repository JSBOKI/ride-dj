const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

export interface SunoSongRef {
  id: string
  url: string
}

export interface SunoPlaylistRef {
  id: string
  url: string
}

export interface ParsedSunoLinks {
  songs: SunoSongRef[]
  playlists: SunoPlaylistRef[]
}

export function sunoSongUrl(id: string): string {
  return `https://suno.com/song/${id}`
}

export function sunoCdnMp3(id: string): string {
  return `https://cdn1.suno.ai/${id}.mp3`
}

export function sunoCdnMp4(id: string): string {
  return `https://cdn1.suno.ai/${id}.mp4`
}

export function parseSunoLinks(text: string): ParsedSunoLinks {
  const songs: SunoSongRef[] = []
  const playlists: SunoPlaylistRef[] = []
  const seenSongs = new Set<string>()
  const seenPlaylists = new Set<string>()
  for (const match of text.matchAll(new RegExp(`suno\\.com/song/(${UUID})`, "gi"))) {
    const id = match[1].toLowerCase()
    if (seenSongs.has(id)) continue
    seenSongs.add(id)
    songs.push({ id, url: sunoSongUrl(id) })
  }
  for (const match of text.matchAll(new RegExp(`suno\\.com/playlist/(${UUID})`, "gi"))) {
    const id = match[1].toLowerCase()
    if (seenPlaylists.has(id)) continue
    seenPlaylists.add(id)
    playlists.push({ id, url: `https://suno.com/playlist/${id}` })
  }
  return { songs, playlists }
}

export interface ResolvedPlaylistSong {
  id: string
  title: string
  pageUrl: string
}

export interface PlaylistResolution {
  ok: boolean
  name?: string
  songs: ResolvedPlaylistSong[]
  message: string
}

interface PlaylistClip {
  clip?: { id?: string; title?: string }
}

interface PlaylistPayload {
  name?: string
  playlist_clips?: PlaylistClip[]
}

/**
 * Suno's playlist API is public but only sends Access-Control-Allow-Origin
 * for https://suno.com. Browsers on any other origin throw on this fetch.
 */
export async function resolveSunoPlaylist(playlistId: string): Promise<PlaylistResolution> {
  const endpoints = [
    `https://studio-api.prod.suno.com/api/playlist/${playlistId}/`,
    `https://studio-api-prod.suno.com/api/playlist/${playlistId}/`,
  ]
  let message =
    "This browser can't read Suno playlists. The API only allows requests from suno.com. Paste the song links instead."
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        mode: "cors",
        headers: { Accept: "application/json" },
      })
      if (!response.ok) {
        message = `Suno refused the playlist (${response.status}). Paste the song links instead.`
        continue
      }
      const data = (await response.json()) as PlaylistPayload
      const songs: ResolvedPlaylistSong[] = []
      for (const entry of data.playlist_clips ?? []) {
        const id = entry.clip?.id
        if (!id) continue
        songs.push({
          id,
          title: entry.clip?.title?.trim() || "Suno song",
          pageUrl: sunoSongUrl(id),
        })
      }
      if (songs.length === 0) {
        return {
          ok: false,
          songs: [],
          message: "Suno returned the playlist, but it had no songs. Paste the song links instead.",
        }
      }
      return {
        ok: true,
        name: data.name,
        songs,
        message: `Found ${songs.length} songs on Suno.`,
      }
    } catch {
      message =
        "This browser can't read Suno playlists. The API only allows requests from suno.com. Paste the song links instead."
    }
  }
  return { ok: false, songs: [], message }
}

export type SunoAudioVia = "cdn-mp3" | "cdn-mp4"

export type SunoAudioResult =
  | { ok: true; blob: Blob; via: SunoAudioVia }
  | { ok: false; message: string; detail: string; previewUrl?: string }

function probeAudioElement(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(false)
      return
    }
    const audio = document.createElement("audio")
    audio.crossOrigin = "anonymous"
    audio.preload = "metadata"
    let settled = false
    const finish = (loaded: boolean) => {
      if (settled) return
      settled = true
      audio.removeAttribute("src")
      audio.load()
      resolve(loaded)
    }
    audio.addEventListener("loadedmetadata", () => finish(true), { once: true })
    audio.addEventListener("error", () => finish(false), { once: true })
    window.setTimeout(() => finish(false), 8000)
    audio.src = url
  })
}

/**
 * Tries the public mp3 first. On current Suno songs that URL is 403 and the
 * CORS-enabled asset is the mp4 (AAC), which decodeAudioData accepts.
 */
export async function fetchSunoAudio(id: string): Promise<SunoAudioResult> {
  const attempts: { url: string; via: SunoAudioVia }[] = [
    // The mp4 (AAC) is the asset that allows cross-origin reads; the mp3 is usually 403.
    { url: sunoCdnMp4(id), via: "cdn-mp4" },
    { url: sunoCdnMp3(id), via: "cdn-mp3" },
  ]
  const notes: string[] = []
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, { mode: "cors" })
      if (!response.ok) {
        notes.push(`${attempt.via} returned HTTP ${response.status}`)
        continue
      }
      const blob = await response.blob()
      if (blob.size < 1000) {
        notes.push(`${attempt.via} came back empty`)
        continue
      }
      return { ok: true, blob, via: attempt.via }
    } catch {
      notes.push(`${attempt.via} was blocked by CORS or the network`)
    }
  }

  const previewUrl = sunoCdnMp4(id)
  const elementLoaded = await probeAudioElement(previewUrl)
  if (elementLoaded) {
    return {
      ok: false,
      message:
        "The link opened in an audio element, but the bytes never arrived, so Ride DJ can't beatmatch it. Add the mp3 or wav file instead.",
      detail: notes.join(" · "),
      previewUrl,
    }
  }
  const mp3Loaded = await probeAudioElement(sunoCdnMp3(id))
  if (mp3Loaded) {
    return {
      ok: false,
      message:
        "An audio element could open the mp3, but the browser blocked reading it, so it can't be mixed. Add the file from your downloads instead.",
      detail: notes.join(" · "),
      previewUrl: sunoCdnMp3(id),
    }
  }
  return {
    ok: false,
    message: "This Suno link couldn't be loaded. Check the URL, or add the audio file directly.",
    detail: notes.join(" · ") || "No CDN response.",
  }
}
