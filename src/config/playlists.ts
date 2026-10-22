/**
 * Default playlists (Suno links, or built-in mp3s served from /audio).
 *
 * Edit this file to add a playlist URL or to pin song links. Browsers cannot
 * read Suno's playlist API (CORS is limited to suno.com), so `songs` is what
 * Ride DJ loads when live resolution fails.
 */
export interface DefaultPlaylistSong {
  /** Public page, https://suno.com/song/<uuid>, or the song's page in another app */
  url: string
  title: string
  /** Direct mp3 the browser can fetch (same origin or CORS-enabled). Skips Suno resolution. */
  audioUrl?: string
}

export interface DefaultPlaylist {
  id: string
  name: string
  url: string
  songs: DefaultPlaylistSong[]
  note?: string
}

export const defaultPlaylists: DefaultPlaylist[] = [
  {
    id: "kokoro-ride",
    name: "こころ Ride",
    url: "https://suno.com/playlist/314b51fd-aa1f-4cd8-b761-596a93fb5458",
    songs: [
      {
        title: "鎌倉の海 Kamakura Sea (Stranger)",
        url: "https://suno.com/song/60854e25-c406-4cc4-8bea-f7c36bc989a7",
      },
      {
        title: "雑司ヶ谷 Zoshigaya",
        url: "https://suno.com/song/f62249a8-49ca-4183-9294-5daf5338ae1f",
      },
      {
        title: "向上心 Spirit of Ascent",
        url: "https://suno.com/song/6f08e3c2-91aa-40b7-84be-c2733e3ad7ba",
      },
      {
        title: "黒い光 Black Light",
        url: "https://suno.com/song/00ee16fc-e83b-4d5a-8046-3aa89544b424",
      },
      {
        title: "明治の精神 Spirit of Meiji",
        url: "https://suno.com/song/06d19f19-6572-45ca-b5eb-c455cbb49621",
      },
      {
        title: "遺書 The Testament",
        url: "https://suno.com/song/fc7fd801-61c6-4853-a455-a85250b70e84",
      },
    ],
  },
  {
    id: "hamlet-trance-ride",
    name: "Hamlet Trance Ride",
    url: "https://suno.com/playlist/3854dc2f-1430-43a7-ae0d-8b7668a2cd3f",
    note: "Five songs, about 6 minutes each (30 minutes). A 20-minute ride trims them.",
    songs: [
      {
        title: "Ghost on the Battlements",
        url: "https://suno.com/song/11349519-f681-41a0-bc01-5bf6c0a39dba",
      },
      {
        title: "To Be or Not To Be 生きるべきか 사느냐 죽느냐",
        url: "https://suno.com/song/439a312c-d239-4ce4-9d64-f329ff120a95",
      },
      {
        title: "The Mousetrap ねずみ取り 쥐덫",
        url: "https://suno.com/song/cc668fda-cd96-4aa3-8990-45814a0f037c",
      },
      {
        title: "Ophelia's River オフィーリア 오필리아",
        url: "https://suno.com/song/4a786f42-f050-4cc7-9bcd-d0767c9db2d4",
      },
      {
        title: "The Rest Is Silence 沈黙 침묵",
        url: "https://suno.com/song/dcc8f710-ab06-4e00-8c8d-7fdefbd6107a",
      },
    ],
  },
  {
    id: "earnest-dark-trance",
    name: "Earnest – Dark Trance Ride",
    url: "https://onna-no-inai-songs.onrender.com/",
    note: "Six code-synthesized dark trance tracks, 126 → 140 BPM, about 5–5½ minutes each (about 32 minutes). Also in 文学EDM (Workout · 真面目が肝心).",
    songs: [
      {
        title: "Bunbury バンベリー 번버리",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-1",
        audioUrl: "/audio/earnest/earnest-trance-1-workout.mp3",
      },
      {
        title: "Ernest in Town, Jack in the Country 都会ではアーネスト 도시에선 어니스트",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-2",
        audioUrl: "/audio/earnest/earnest-trance-2-workout.mp3",
      },
      {
        title: "A Handbag? ハンドバッグ？ 핸드백?",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-3",
        audioUrl: "/audio/earnest/earnest-trance-3-workout.mp3",
      },
      {
        title: "Quite Dead すっかり死んだ 완전히 죽었다",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-4",
        audioUrl: "/audio/earnest/earnest-trance-4-workout.mp3",
      },
      {
        title: "Never Simple 決して単純ではない 결코 단순하지 않다",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-5",
        audioUrl: "/audio/earnest/earnest-trance-5-workout.mp3",
      },
      {
        title: "The Vital Importance 真面目が肝心 진지함의 중요성",
        url: "https://onna-no-inai-songs.onrender.com/#earnest-trance-6",
        audioUrl: "/audio/earnest/earnest-trance-6-workout.mp3",
      },
    ],
  },
]
