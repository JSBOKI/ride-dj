import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { analyzeSamples, audioBufferToMono } from "../lib/analyze.ts"
import { defaultPlaylists } from "../config/playlists.ts"
import {
  deletePlaylistRecord,
  deleteSessionRecord,
  deleteSongRecord,
  getAudioBlob,
  isMemoryOnly,
  listPlaylists,
  listSessions,
  listSongs,
  openDatabase,
  putPlaylist,
  putSession,
  putSong,
} from "../lib/db.ts"
import { fetchSunoAudio, parseSunoLinks, resolveSunoPlaylist } from "../lib/suno.ts"
import { DEMO_TRACKS, renderClickTrack } from "../lib/synth.ts"
import type { IntensityShape, PlaylistRecord, SessionRecord, SongRecord } from "../lib/types.ts"
import { wavBlob } from "../lib/wav.ts"

interface ImportSong {
  id: string
  title: string
  pageUrl: string
}

interface LibraryContextValue {
  ready: boolean
  songs: SongRecord[]
  playlists: PlaylistRecord[]
  sessions: SessionRecord[]
  selectedIds: string[]
  busy: string | null
  notice: string | null
  error: string | null
  memoryOnly: boolean
  toggleSelected: (id: string) => void
  selectOnly: (ids: string[]) => void
  rememberSetup: (minutes: number, shape: IntensityShape) => void
  dismissMessage: () => void
  addFiles: (files: File[]) => Promise<void>
  addSunoText: (text: string) => Promise<void>
  loadDefaultPlaylist: (id: string) => Promise<void>
  generateDemo: () => Promise<void>
  deleteSong: (id: string) => Promise<void>
  savePlaylist: (name: string) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  saveSession: (input: { targetSeconds: number; shape: IntensityShape }) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  audioFor: (id: string) => Promise<Blob | null>
}

const LibraryContext = createContext<LibraryContextValue | null>(null)
const SETUP_KEY = "ride-dj-setup"

function songIdFromUrl(url: string): string | null {
  return parseSunoLinks(url).songs[0]?.id ?? null
}

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext()
  try {
    const bytes = await blob.arrayBuffer()
    return await context.decodeAudioData(bytes)
  } finally {
    await context.close()
  }
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [songs, setSongs] = useState<SongRecord[]>([])
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [memoryOnly, setMemoryOnly] = useState(false)

  const refresh = useCallback(async () => {
    await openDatabase()
    setMemoryOnly(isMemoryOnly())
    const [storedSongs, storedPlaylists, storedSessions] = await Promise.all([
      listSongs(),
      listPlaylists(),
      listSessions(),
    ])
    const nextPlaylists = [...storedPlaylists]
    for (const preset of defaultPlaylists) {
      const index = nextPlaylists.findIndex((playlist) => playlist.id === preset.id)
      const record: PlaylistRecord = {
        id: preset.id,
        name: preset.name,
        songIds: index >= 0 ? nextPlaylists[index].songIds : [],
        sunoUrl: preset.url || undefined,
        builtin: true,
        note: preset.note,
      }
      await putPlaylist(record)
      if (index >= 0) nextPlaylists[index] = record
      else nextPlaylists.push(record)
    }
    setSongs(storedSongs)
    setPlaylists(nextPlaylists)
    setSessions(storedSessions)
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(SETUP_KEY)
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { selectedIds?: string[] }
          if (Array.isArray(parsed.selectedIds)) {
            const known = new Set(storedSongs.map((song) => song.id))
            setSelectedIds(parsed.selectedIds.filter((id) => known.has(id)))
          }
        } catch {
          // Ignore a corrupt setup blob.
        }
      }
    }
    setReady(true)
  }, [])

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "The library didn't open.")
      setReady(true)
    })
  }, [refresh])

  useEffect(() => {
    if (!ready || typeof localStorage === "undefined") return
    const previous = localStorage.getItem(SETUP_KEY)
    let minutes = 30
    let shape: IntensityShape = "full-ride"
    if (previous) {
      try {
        const parsed = JSON.parse(previous) as { minutes?: number; shape?: IntensityShape }
        if (parsed.minutes) minutes = parsed.minutes
        if (parsed.shape) shape = parsed.shape
      } catch {
        // Keep defaults.
      }
    }
    localStorage.setItem(SETUP_KEY, JSON.stringify({ selectedIds, minutes, shape }))
  }, [ready, selectedIds])

  const rememberSetup = useCallback((minutes: number, shape: IntensityShape) => {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(SETUP_KEY, JSON.stringify({ selectedIds, minutes, shape }))
  }, [selectedIds])

  const importSongs = useCallback(async (incoming: ImportSong[], sourceNote: string) => {
    const loaded: string[] = []
    const problems: string[] = []
    for (let index = 0; index < incoming.length; index++) {
      const item = incoming[index]
      setBusy(`Loading ${index + 1} of ${incoming.length}: ${item.title}`)
      const existing = (await listSongs()).find((song) => song.sunoUrl === item.pageUrl && !song.error)
      if (existing) {
        loaded.push(existing.id)
        continue
      }
      const fetched = await fetchSunoAudio(item.id)
      if (!fetched.ok) {
        problems.push(`${item.title}: ${fetched.message}`)
        const failed: SongRecord = {
          id: crypto.randomUUID(),
          name: item.title,
          source: "suno",
          sunoUrl: item.pageUrl,
          error: fetched.message,
          loadNote: fetched.detail,
          createdAt: Date.now(),
          duration: 0,
          bpm: 0,
          beatOffset: 0,
          energy: 0,
          sections: [],
        }
        await putSong(failed)
        continue
      }
      try {
        const buffer = await decodeBlob(fetched.blob)
        const analysis = analyzeSamples(audioBufferToMono(buffer), buffer.sampleRate, crypto.randomUUID(), item.title)
        const record: SongRecord = {
          ...analysis,
          source: "suno",
          sunoUrl: item.pageUrl,
          loadNote:
            fetched.via === "cdn-mp4"
              ? "Decoded the Suno mp4. The mp3 URL returned an error, and the mp4 allows cross-origin audio."
              : "Decoded the Suno mp3.",
          createdAt: Date.now(),
        }
        await putSong(record, fetched.blob)
        loaded.push(record.id)
      } catch {
        problems.push(
          `${item.title}: the file downloaded, but this browser couldn't decode it for beatmatching.`,
        )
      }
    }
    await refresh()
    setSelectedIds((current) => [...new Set([...current, ...loaded])])
    if (problems.length > 0) {
      setError(problems.join(" "))
      setNotice(loaded.length > 0 ? `${sourceNote} ${loaded.length} song${loaded.length === 1 ? "" : "s"} ready.` : null)
    } else {
      setError(null)
      setNotice(`${sourceNote} ${loaded.length} song${loaded.length === 1 ? "" : "s"} ready to ride.`)
    }
  }, [refresh])

  const addSunoText = useCallback(async (text: string) => {
    const parsed = parseSunoLinks(text)
    if (parsed.songs.length === 0 && parsed.playlists.length === 0) {
      setError("No Suno song or playlist links in that text.")
      return
    }
    setError(null)
    const queue: ImportSong[] = parsed.songs.map((song) => ({
      id: song.id,
      title: "Suno song",
      pageUrl: song.url,
    }))
    const notes: string[] = []
    for (const playlist of parsed.playlists) {
      setBusy("Asking Suno for the playlist…")
      const resolved = await resolveSunoPlaylist(playlist.id)
      if (resolved.ok) {
        queue.push(...resolved.songs.map((song) => ({ id: song.id, title: song.title, pageUrl: song.pageUrl })))
        if (resolved.name) notes.push(resolved.name)
        continue
      }
      const preset = defaultPlaylists.find((item) => item.url.includes(playlist.id))
      if (preset && preset.songs.length > 0) {
        for (const song of preset.songs) {
          const id = songIdFromUrl(song.url)
          if (id) queue.push({ id, title: song.title, pageUrl: song.url })
        }
        notes.push(`${preset.name}: ${resolved.message} Loaded the song list from the config file.`)
      } else {
        notes.push(resolved.message)
      }
    }
    if (queue.length === 0) {
      setBusy(null)
      setError(notes.join(" ") || "Paste the individual song links from that playlist.")
      return
    }
    try {
      await importSongs(queue, notes[0] ? `${notes[0]} ` : "Added")
    } finally {
      setBusy(null)
    }
  }, [importSongs])

  const loadDefaultPlaylist = useCallback(async (id: string) => {
    const preset = defaultPlaylists.find((item) => item.id === id)
    if (!preset) return
    if (!preset.url && preset.songs.length === 0) {
      setError(preset.note ?? "This playlist doesn't have a URL yet.")
      return
    }
    const lines = [preset.url, ...preset.songs.map((song) => song.url)].filter(Boolean)
    setError(null)
    try {
      await addSunoText(lines.join("\n"))
      const titles = new Map(preset.songs.map((song) => [song.url, song.title]))
      const stored = await listSongs()
      for (const song of stored) {
        const title = song.sunoUrl ? titles.get(song.sunoUrl) : undefined
        if (title && song.name === "Suno song") {
          await putSong({ ...song, name: title })
        }
      }
      setSongs(await listSongs())
      const playlistSongs = (await listSongs()).filter((song) => song.sunoUrl && titles.has(song.sunoUrl))
      const record: PlaylistRecord = {
        id: preset.id,
        name: preset.name,
        songIds: playlistSongs.map((song) => song.id),
        sunoUrl: preset.url || undefined,
        builtin: true,
        note: preset.note,
      }
      await putPlaylist(record)
      setPlaylists(await listPlaylists())
    } finally {
      setBusy(null)
    }
  }, [addSunoText])

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setError(null)
    const problems: string[] = []
    const ids: string[] = []
    for (let index = 0; index < files.length; index++) {
      const file = files[index]
      setBusy(`Reading ${index + 1} of ${files.length}: ${file.name}`)
      if (file.size > 80 * 1024 * 1024) {
        problems.push(`${file.name} is over 80 MB.`)
        continue
      }
      try {
        const buffer = await decodeBlob(file)
        const name = file.name.replace(/\.[^.]+$/, "") || file.name
        const analysis = analyzeSamples(audioBufferToMono(buffer), buffer.sampleRate, crypto.randomUUID(), name)
        const record: SongRecord = { ...analysis, source: "file", createdAt: Date.now() }
        await putSong(record, file)
        ids.push(record.id)
      } catch {
        problems.push(`${file.name} couldn't be decoded. Use mp3, m4a, or wav.`)
      }
    }
    await refresh()
    setSelectedIds((current) => [...new Set([...current, ...ids])])
    setBusy(null)
    if (problems.length > 0) setError(problems.join(" "))
    else setNotice(`${ids.length} file${ids.length === 1 ? "" : "s"} added.`)
  }, [refresh])

  const generateDemo = useCallback(async () => {
    setError(null)
    setBusy("Building click tracks…")
    const ids: string[] = []
    for (const spec of DEMO_TRACKS) {
      const existing = (await listSongs()).find((song) => song.source === "demo" && song.name === spec.name)
      if (existing) {
        ids.push(existing.id)
        continue
      }
      const samples = renderClickTrack({ bpm: spec.bpm, sections: spec.sections, sampleRate: 22050 })
      const id = crypto.randomUUID()
      const analysis = analyzeSamples(samples, 22050, id, spec.name)
      const record: SongRecord = {
        ...analysis,
        source: "demo",
        loadNote: "Synthetic click track. Not a recording.",
        createdAt: Date.now(),
      }
      await putSong(record, wavBlob(samples, 22050))
      ids.push(id)
    }
    await refresh()
    setSelectedIds(ids)
    setBusy(null)
    setNotice("Demo ride is in the library. Four click tracks, different tempos, ready to mix.")
  }, [refresh])

  const deleteSong = useCallback(async (id: string) => {
    await deleteSongRecord(id)
    const nextPlaylists = await listPlaylists()
    for (const playlist of nextPlaylists) {
      if (!playlist.songIds.includes(id)) continue
      await putPlaylist({ ...playlist, songIds: playlist.songIds.filter((songId) => songId !== id) })
    }
    setSelectedIds((current) => current.filter((songId) => songId !== id))
    await refresh()
  }, [refresh])

  const value = useMemo<LibraryContextValue>(() => ({
    ready,
    songs,
    playlists,
    sessions,
    selectedIds,
    busy,
    notice,
    error,
    memoryOnly,
    toggleSelected: (id) => {
      setSelectedIds((current) => current.includes(id) ? current.filter((songId) => songId !== id) : [...current, id])
    },
    selectOnly: (ids) => setSelectedIds(ids),
    rememberSetup,
    dismissMessage: () => {
      setNotice(null)
      setError(null)
    },
    addFiles,
    addSunoText,
    loadDefaultPlaylist,
    generateDemo,
    deleteSong,
    savePlaylist: async (name) => {
      const playlist: PlaylistRecord = {
        id: crypto.randomUUID(),
        name: name.trim() || "Untitled playlist",
        songIds: selectedIds,
        builtin: false,
      }
      await putPlaylist(playlist)
      setPlaylists(await listPlaylists())
      setNotice(`Saved “${playlist.name}”.`)
    },
    deletePlaylist: async (id) => {
      const playlist = playlists.find((item) => item.id === id)
      if (playlist?.builtin) return
      await deletePlaylistRecord(id)
      setPlaylists(await listPlaylists())
    },
    saveSession: async ({ targetSeconds, shape }) => {
      const session: SessionRecord = {
        id: crypto.randomUUID(),
        name: `${Math.round(targetSeconds / 60)} min`,
        createdAt: Date.now(),
        targetSeconds,
        shape,
        songIds: selectedIds,
      }
      await putSession(session)
      setSessions(await listSessions())
      rememberSetup(targetSeconds / 60, shape)
      setNotice("Session saved on this phone.")
    },
    deleteSession: async (id) => {
      await deleteSessionRecord(id)
      setSessions(await listSessions())
    },
    audioFor: getAudioBlob,
  }), [
    addFiles,
    addSunoText,
    busy,
    deleteSong,
    error,
    generateDemo,
    loadDefaultPlaylist,
    memoryOnly,
    rememberSetup,
    notice,
    playlists,
    ready,
    selectedIds,
    sessions,
    songs,
  ])

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext)
  if (!value) throw new Error("useLibrary must be used inside LibraryProvider")
  return value
}

export function readStoredSetup(): { minutes: number; shape: IntensityShape } {
  if (typeof localStorage === "undefined") return { minutes: 30, shape: "full-ride" }
  const raw = localStorage.getItem(SETUP_KEY)
  if (!raw) return { minutes: 30, shape: "full-ride" }
  try {
    const parsed = JSON.parse(raw) as { minutes?: number; shape?: IntensityShape }
    return {
      minutes: parsed.minutes && parsed.minutes >= 10 ? parsed.minutes : 30,
      shape: parsed.shape ?? "full-ride",
    }
  } catch {
    return { minutes: 30, shape: "full-ride" }
  }
}
