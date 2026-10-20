import type { PlaylistRecord, SessionRecord, SongRecord } from "./types.ts"

const DB_NAME = "ride-dj"
const DB_VERSION = 1

interface MemoryDb {
  songs: Map<string, SongRecord>
  audio: Map<string, Blob>
  playlists: Map<string, PlaylistRecord>
  sessions: Map<string, SessionRecord>
}

const memory: MemoryDb = {
  songs: new Map(),
  audio: new Map(),
  playlists: new Map(),
  sessions: new Map(),
}

let database: IDBDatabase | null = null
let memoryOnly = false
let opening: Promise<void> | null = null

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function isMemoryOnly(): boolean {
  return memoryOnly
}

export async function openDatabase(): Promise<void> {
  if (database || memoryOnly) return
  if (opening) return opening
  opening = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      memoryOnly = true
      resolve()
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" })
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio")
      if (!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists", { keyPath: "id" })
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" })
    }
    request.onsuccess = () => {
      database = request.result
      database.onversionchange = () => database?.close()
      resolve()
    }
    request.onerror = () => {
      memoryOnly = true
      database = null
      resolve()
    }
  })
  return opening
}

async function ready(): Promise<IDBDatabase | null> {
  await openDatabase()
  return database
}

export async function listSongs(): Promise<SongRecord[]> {
  const db = await ready()
  if (!db) return [...memory.songs.values()]
  const rows = await requestToPromise(db.transaction("songs").objectStore("songs").getAll())
  return (rows as SongRecord[]).sort((a, b) => a.createdAt - b.createdAt)
}

export async function putSong(song: SongRecord, audio?: Blob): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.songs.set(song.id, song)
    if (audio) memory.audio.set(song.id, audio)
    return
  }
  const tx = db.transaction(["songs", "audio"], "readwrite")
  tx.objectStore("songs").put(song)
  if (audio) tx.objectStore("audio").put(audio, song.id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function deleteSongRecord(id: string): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.songs.delete(id)
    memory.audio.delete(id)
    return
  }
  const tx = db.transaction(["songs", "audio"], "readwrite")
  tx.objectStore("songs").delete(id)
  tx.objectStore("audio").delete(id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getAudioBlob(id: string): Promise<Blob | null> {
  const db = await ready()
  if (!db) return memory.audio.get(id) ?? null
  const blob = await requestToPromise(db.transaction("audio").objectStore("audio").get(id))
  return (blob as Blob | undefined) ?? null
}

export async function listPlaylists(): Promise<PlaylistRecord[]> {
  const db = await ready()
  if (!db) return [...memory.playlists.values()]
  return (await requestToPromise(db.transaction("playlists").objectStore("playlists").getAll())) as PlaylistRecord[]
}

export async function putPlaylist(playlist: PlaylistRecord): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.playlists.set(playlist.id, playlist)
    return
  }
  await requestToPromise(db.transaction("playlists", "readwrite").objectStore("playlists").put(playlist))
}

export async function deletePlaylistRecord(id: string): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.playlists.delete(id)
    return
  }
  await requestToPromise(db.transaction("playlists", "readwrite").objectStore("playlists").delete(id))
}

export async function listSessions(): Promise<SessionRecord[]> {
  const db = await ready()
  if (!db) return [...memory.sessions.values()]
  const rows = (await requestToPromise(
    db.transaction("sessions").objectStore("sessions").getAll(),
  )) as SessionRecord[]
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

export async function putSession(session: SessionRecord): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.sessions.set(session.id, session)
    return
  }
  await requestToPromise(db.transaction("sessions", "readwrite").objectStore("sessions").put(session))
}

export async function deleteSessionRecord(id: string): Promise<void> {
  const db = await ready()
  if (!db) {
    memory.sessions.delete(id)
    return
  }
  await requestToPromise(db.transaction("sessions", "readwrite").objectStore("sessions").delete(id))
}
