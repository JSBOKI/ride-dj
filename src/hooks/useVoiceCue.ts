import { useCallback, useEffect, useRef } from "react"

/** Picks a lower, calmer voice when the device has one. */
function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("en"))
  const preferred = ["Daniel", "Alex", "Fred", "Google UK English Male", "Microsoft Guy", "Microsoft David", "Arthur", "Aaron", "Rocko", "Male"]
  for (const name of preferred) {
    const match = voices.find((voice) => voice.name.includes(name))
    if (match) return match
  }
  return voices[0] ?? null
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window
}

export function useVoiceCue(enabled: boolean) {
  const voice = useRef<SpeechSynthesisVoice | null>(null)
  useEffect(() => {
    if (!voiceSupported()) return
    const load = () => {
      voice.current = pickVoice()
    }
    load()
    speechSynthesis.addEventListener("voiceschanged", load)
    return () => speechSynthesis.removeEventListener("voiceschanged", load)
  }, [])

  return useCallback(
    (text: string) => {
      if (!enabled || !voiceSupported()) return
      try {
        speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        if (voice.current) utterance.voice = voice.current
        utterance.pitch = 0.55
        utterance.rate = 0.92
        utterance.volume = 1
        speechSynthesis.speak(utterance)
      } catch {
        // Speech is optional.
      }
    },
    [enabled],
  )
}

/** iOS only speaks after a user gesture; call from the Start tap. */
export function primeSpeech(): void {
  if (!voiceSupported()) return
  try {
    const utterance = new SpeechSynthesisUtterance(" ")
    utterance.volume = 0
    speechSynthesis.speak(utterance)
  } catch {
    // Ignore.
  }
}
