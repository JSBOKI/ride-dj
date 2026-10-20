import { useRef, useState } from "react"
import { Disc3, Link2, Plus, Sparkles, Trash2 } from "lucide-react"
import { defaultPlaylists } from "../config/playlists.ts"
import { Badge } from "./ui/badge.tsx"
import { Button } from "./ui/button.tsx"
import { Card } from "./ui/card.tsx"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx"
import { Textarea } from "./ui/textarea.tsx"
import { formatBpm, formatClock } from "../lib/format.ts"
import { useLibrary } from "../state/library.tsx"

export function LibraryScreen() {
  const library = useLibrary()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sunoOpen, setSunoOpen] = useState(false)
  const [sunoText, setSunoText] = useState("")
  const [playlistName, setPlaylistName] = useState("")

  return (
    <div className="flex flex-col gap-5 pb-4">
      <div>
        <h1 className="font-display text-4xl leading-none tracking-wide">Library</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Files stay in this browser. Suno songs are fetched when you add them.
        </p>
      </div>

      {library.memoryOnly && (
        <p className="rounded-xl bg-destructive/15 px-3 py-2 text-sm text-destructive">
          This browser won't keep the library on disk. Tracks last until you close the tab.
        </p>
      )}
      {library.error && (
        <p className="rounded-xl bg-destructive/15 px-3 py-2 text-sm leading-relaxed text-destructive">
          {library.error}
          <button className="ml-2 underline" onClick={library.dismissMessage} type="button">
            Dismiss
          </button>
        </p>
      )}
      {library.notice && (
        <p className="rounded-xl bg-primary/15 px-3 py-2 text-sm text-foreground">
          {library.notice}
          <button className="ml-2 underline" onClick={library.dismissMessage} type="button">
            Dismiss
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button className="h-12" onClick={() => fileRef.current?.click()} disabled={Boolean(library.busy)} type="button">
          <Plus /> Add audio
        </Button>
        <Button className="h-12" variant="outline" onClick={() => setSunoOpen(true)} disabled={Boolean(library.busy)} type="button">
          <Link2 /> Suno link
        </Button>
        <Button className="h-12" variant="secondary" onClick={() => void library.generateDemo()} disabled={Boolean(library.busy)} type="button">
          <Sparkles /> Demo tracks
        </Button>
        <input
          ref={fileRef}
          className="hidden"
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/m4a,.mp3,.m4a,.wav"
          multiple
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            event.target.value = ""
            void library.addFiles(files)
          }}
        />
      </div>
      {library.busy && <p className="text-sm text-primary">{library.busy}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">Playlists</h2>
        {defaultPlaylists.map((preset) => {
          const saved = library.playlists.find((playlist) => playlist.id === preset.id)
          const ready = preset.url.length > 0 || preset.songs.length > 0
          return (
            <Card key={preset.id} className="gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{preset.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {preset.url || "No URL yet."}
                  </p>
                  {preset.note && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{preset.note}</p>
                  )}
                  {saved && saved.songIds.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{saved.songIds.length} loaded on this device</p>
                  )}
                </div>
                <Badge variant="outline">Suno</Badge>
              </div>
              <Button
                className="h-11"
                variant="outline"
                disabled={!ready || Boolean(library.busy)}
                onClick={() => void library.loadDefaultPlaylist(preset.id)}
                type="button"
              >
                {ready ? "Load songs" : "Add the URL in config"}
              </Button>
            </Card>
          )
        })}
        {library.playlists.filter((playlist) => !playlist.builtin).map((playlist) => (
          <Card key={playlist.id} className="gap-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">{playlist.name}</p>
                <p className="text-xs text-muted-foreground">{playlist.songIds.length} songs</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${playlist.name}`}
                onClick={() => void library.deletePlaylist(playlist.id)}
                type="button"
              >
                <Trash2 />
              </Button>
            </div>
            <Button
              className="h-11"
              variant="outline"
              onClick={() => library.selectOnly(playlist.songIds)}
              type="button"
            >
              Use in the ride
            </Button>
          </Card>
        ))}
        <div className="flex gap-2">
          <input
            value={playlistName}
            onChange={(event) => setPlaylistName(event.target.value)}
            placeholder="Name this selection"
            className="h-11 flex-1 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring"
          />
          <Button
            className="h-11"
            variant="secondary"
            disabled={library.selectedIds.length === 0}
            onClick={() => {
              void library.savePlaylist(playlistName)
              setPlaylistName("")
            }}
            type="button"
          >
            Save playlist
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Tracks · {library.songs.length}
        </h2>
        {library.songs.length === 0 && (
          <Card className="items-start p-4">
            <Disc3 className="text-primary" />
            <p className="font-medium">Nothing in the crate</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Add an mp3, m4a, or wav, paste a Suno song link, or generate the demo click tracks and ride those.
            </p>
          </Card>
        )}
        {library.songs.map((song) => {
          const selected = library.selectedIds.includes(song.id)
          const broken = Boolean(song.error) || song.duration <= 0
          return (
            <Card key={song.id} className="gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{song.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {broken ? "Couldn't mix" : `${formatBpm(song.bpm)} BPM · ${formatClock(song.duration)}`}
                  </p>
                </div>
                <Badge variant={song.source === "suno" ? "default" : "secondary"}>
                  {song.source}
                </Badge>
              </div>
              {!broken && (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.round(song.energy * 100)}%` }}
                  />
                </div>
              )}
              {song.error && <p className="text-xs leading-relaxed text-destructive">{song.error}</p>}
              {song.loadNote && !song.error && (
                <p className="text-xs leading-relaxed text-muted-foreground">{song.loadNote}</p>
              )}
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  variant={selected ? "default" : "outline"}
                  disabled={broken}
                  onClick={() => library.toggleSelected(song.id)}
                  type="button"
                >
                  {selected ? "In the ride" : "Add to ride"}
                </Button>
                <Button
                  className="h-11"
                  variant="ghost"
                  onClick={() => void library.deleteSong(song.id)}
                  type="button"
                >
                  Remove
                </Button>
              </div>
            </Card>
          )
        })}
      </section>

      <Dialog open={sunoOpen} onOpenChange={setSunoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a Suno link</DialogTitle>
            <DialogDescription>
              Paste one or more song links, or a playlist link. If the playlist can't be read from this site, paste the song links instead. The app tries the mp3, then the CORS-enabled mp4.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={sunoText}
            onChange={(event) => setSunoText(event.target.value)}
            rows={6}
            placeholder={"https://suno.com/song/…\nhttps://suno.com/playlist/…"}
          />
          <Button
            className="h-11"
            disabled={Boolean(library.busy) || sunoText.trim().length === 0}
            onClick={() => {
              void library.addSunoText(sunoText).then(() => {
                setSunoText("")
                setSunoOpen(false)
              })
            }}
            type="button"
          >
            Fetch and analyze
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
