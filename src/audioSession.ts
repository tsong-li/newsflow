const EXCLUSIVE_AUDIO_EVENT = 'newsflow:exclusive-audio'

interface ExclusiveAudioDetail {
  ownerId: string
  source: 'listen' | 'watch'
}

export function createAudioSessionId(prefix: 'listen' | 'watch') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function requestExclusiveAudio(detail: ExclusiveAudioDetail) {
  window.dispatchEvent(new CustomEvent<ExclusiveAudioDetail>(EXCLUSIVE_AUDIO_EVENT, { detail }))
}

export function subscribeExclusiveAudio(ownerId: string, onInterrupt: () => void) {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<ExclusiveAudioDetail>
    if (!customEvent.detail || customEvent.detail.ownerId === ownerId) return
    onInterrupt()
  }

  window.addEventListener(EXCLUSIVE_AUDIO_EVENT, handler)
  return () => window.removeEventListener(EXCLUSIVE_AUDIO_EVENT, handler)
}
