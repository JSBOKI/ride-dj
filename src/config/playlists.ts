/**
 * Default Suno playlists.
 *
 * Edit this file to add a playlist URL or to pin song links. Browsers cannot
 * read Suno's playlist API (CORS is limited to suno.com), so `songs` is what
 * Ride DJ loads when live resolution fails.
 */
export interface DefaultPlaylistSong {
  /** Public page, https://suno.com/song/<uuid> */
  url: string
  title: string
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
    id: "earnest-hair-musical",
    name: "Earnest! – a Hair-style musical",
    url: "https://suno.com/playlist/74f508a5-6e1f-45b1-ac2f-aa4868b3425b",
    note: "Five songs, about 3¾ minutes each (about 19 minutes).",
    songs: [
      {
        title: "Bunburying",
        url: "https://suno.com/song/d012d177-6d21-4177-b9f0-a690a67286ea",
      },
      {
        title: "A Handbag",
        url: "https://suno.com/song/f9074f80-ee2e-4a1c-b612-5a3bc4772703",
      },
      {
        title: "Cucumber Sandwiches",
        url: "https://suno.com/song/715db9e3-2558-410d-9c76-17d81840f486",
      },
      {
        title: "Gwendolen, I Must Propose",
        url: "https://suno.com/song/3a0759b2-2441-4473-85d8-a99f07c54b38",
      },
      {
        title: "The Line Is Immaterial",
        url: "https://suno.com/song/95afc1b6-c757-4dea-9178-8d84e05a3904",
      },
    ],
  },
]
