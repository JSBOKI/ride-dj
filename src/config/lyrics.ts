/**
 * Exact lyric timings for self-made tracks, in LRC format ("[mm:ss.xx] line").
 * Key by Suno song id, or by the track name as it shows in the library
 * (file name without extension). Times are positions in the original audio,
 * so loops and blends stay in sync automatically.
 *
 * You can also paste LRC on a song in the Library, or drop a .lrc file with
 * the same name next to an audio file when adding it.
 */
export const lyricOverrides: Record<string, { lrc: string }> = {}
