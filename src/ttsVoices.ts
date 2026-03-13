export interface TtsVoiceOption {
  id: string
  label: string
}

const LISTEN_VOICES: TtsVoiceOption[] = [
  { id: 'en-US-JennyNeural', label: 'Jenny' },
  { id: 'en-US-GuyNeural', label: 'Guy' },
  { id: 'en-US-AriaNeural', label: 'Aria' },
  { id: 'en-US-DavisNeural', label: 'Davis' },
]

const WATCH_VOICES: TtsVoiceOption[] = [
  { id: 'en-US-JaneNeural', label: 'Jane' },
  { id: 'en-US-TonyNeural', label: 'Tony' },
  { id: 'en-US-SaraNeural', label: 'Sara' },
  { id: 'en-US-JasonNeural', label: 'Jason' },
]

function hashText(text: string) {
  return Array.from(String(text || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export function getTtsVoiceOptions(mode: 'listen' | 'watch') {
  return mode === 'watch' ? WATCH_VOICES : LISTEN_VOICES
}

export function pickTtsVoice(seed: string, mode: 'listen' | 'watch') {
  const options = getTtsVoiceOptions(mode)
  return options[hashText(`${mode}:${seed}`) % options.length]
}

export function pickSequentialTtsVoice(seed: string, sequenceIndex: number, mode: 'listen' | 'watch') {
  const options = getTtsVoiceOptions(mode)
  if (options.length <= 1) return options[0]

  const baseIndex = hashText(`${mode}:${seed}`) % options.length
  const normalizedSequenceIndex = Math.max(0, sequenceIndex)
  return options[(baseIndex + normalizedSequenceIndex) % options.length]
}
