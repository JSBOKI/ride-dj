# Ride DJ

A static, mobile-first DJ for stationary-bike workouts. Add songs, pick a length (20, 30, 45 minutes, or anything from 10 to 90), and Ride DJ builds a continuous mix that lands on that length.

Everything runs in the browser. Audio files live in IndexedDB. There is no account and no API server. It is meant to be installed on an iPhone home screen and hosted as a [Render static site](https://render.com/docs/static-sites).

## Run locally

```bash
npm install
npm test
npm run dev
```

The dev server listens on [http://127.0.0.1:4179](http://127.0.0.1:4179).

```bash
npm run build    # static files in dist/
npm run preview  # serve the production build
```

`npm test` checks BPM detection on synthetic click tracks and checks that the planner hits each target length within ±2 seconds.

## What a ride does

1. Each track gets a BPM and beat grid from an onset autocorrelation, and section boundaries from bar-by-bar energy changes.
2. Songs are ordered by energy to match the intensity shape: full ride (warm-up, build, peak, cool-down), or a single shape.
3. The planner fills the target with phrase-aligned 8, 16, and 32 bar sections. Short crates loop the phrases that fit the phase (high-energy loops in the peak). Long crates drop sections.
4. Neighboring tracks crossfade over 8 or 16 bars, beat-aligned. The outgoing track loses its low end during the blend. Playback rate stays within ±6% of the original so tempos can meet without sounding warped.
5. While a ride is playing, −1 / +1 minute replans whatever is left. Skip jumps to the next segment. The screen wake lock and the media session keep the lock screen useful.

The demo button writes four original click tracks (different BPMs and energy curves). No recorded music is stored in this repo.

## Default playlists

Edit `src/config/playlists.ts`.

- **こころ Ride** — `https://suno.com/playlist/314b51fd-aa1f-4cd8-b761-596a93fb5458`, with song links filled in so it still loads when Suno blocks playlist lookup.
- **Hamlet Trance Ride** — `https://suno.com/playlist/3854dc2f-1430-43a7-ae0d-8b7668a2cd3f`. Five songs, about 6 minutes each (1,798 seconds, 30 minutes). A 20-minute target trims the set. Song links are filled in for the same CORS fallback.

## Suno, from a browser

Checked against the こころ Ride songs on 20 Oct 2026, including a headless Chrome `fetch` + `decodeAudioData`.

| URL | What happens |
| --- | --- |
| `https://cdn1.suno.ai/<uuid>.mp3` | **Not usable.** HTTP 403. The error response is not CORS-readable, so `fetch` from another origin fails. |
| `https://cdn1.suno.ai/<uuid>.mp4` | **CORS-accessible.** HTTP 200, `Access-Control-Allow-Origin: *`, AAC-LC audio inside a video file. Chrome decoded it with the Web Audio API (about 302s, 44.1 kHz, stereo). An `<audio crossorigin="anonymous">` element also loads it. Ride DJ uses this when the mp3 fails. |
| `https://studio-api.prod.suno.com/api/playlist/<uuid>/` | JSON is public from a server, but `Access-Control-Allow-Origin` is only `https://suno.com`. A page on any other origin cannot read the playlist. The HTML playlist page sends no CORS header either. |
| CloudFront `media_urls` m4a | Sends `Access-Control-Allow-Origin: *`, but the body is not a normal m4a and the link expires. Not used. |

Ride DJ tries the playlist API, then the song list in the config file, then asks you to paste `suno.com/song/…` links. For each song it tries the mp3, then the mp4, then an `<audio crossorigin="anonymous">` probe. If the bytes never arrive, the track is kept in the library with a clear error and is left out of the mix.

## iPhone

Safari needs a tap before audio starts. The Play / Start controls resume the `AudioContext` inside that tap. Add to Home Screen uses the web manifest, apple touch icon, and `apple-mobile-web-app-capable`. Wake Lock needs a recent Safari (16.4+). If the browser refuses the lock, the ride still plays.

## Deploy on Render

`render.yaml` is a static site:

- Build: `npm ci && npm run build`
- Publish: `dist`
- SPA rewrite: every path serves `index.html`

Push the repo and create a Blueprint from the dashboard, or connect the repo as a static site with those two settings. No environment variables.

## Project layout

- `src/lib/planner.ts` — timeline math (unit tested)
- `src/lib/bpm.ts`, `src/lib/sections.ts` — analysis
- `src/audio/engine.ts` — Web Audio scheduling, EQ swap, loops
- `src/config/playlists.ts` — default Suno playlists
- `src/lib/db.ts` — IndexedDB for songs, audio blobs, playlists, and sessions
