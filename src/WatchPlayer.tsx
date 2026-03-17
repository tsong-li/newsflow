import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { createAudioSessionId, requestExclusiveAudio, subscribeExclusiveAudio } from './audioSession'
import { apiUrl, preloadAudioUrl, proxiedImageUrl } from './api'
import { pickTtsVoice } from './ttsVoices'
import type { CSSProperties } from 'react'

const AUDIO_START_TIMEOUT_MS = 15000

interface WatchArticle {
  title: string
  summary?: string
  source?: string
  category?: string
  time?: string
}

interface WatchAnalysis {
  loading?: boolean
  tldr?: string
  keyPoints?: string[]
  context?: string
  readTime?: string
}

interface WatchContent {
  subtitle?: string
  paragraphs: string[]
}

interface WatchPlayerProps {
  article: WatchArticle
  analysis: WatchAnalysis | null
  content: WatchContent | null
  contentLoading?: boolean
  mediaImages?: string[]
  video?: WatchVideo | null
  videoLoading?: boolean
  image: string
  onClose: () => void
}

interface WatchVideo {
  url: string
  kind: 'iframe' | 'video'
  provider?: string
  poster?: string
  title?: string
  source?: 'article' | 'youtube-search'
}

interface WatchScene {
  id: string
  label: string
  title: string
  narration: string
  accent: string
  durationMs: number
  captions: WatchCaption[]
}

interface WatchCaption {
  text: string
  startMs: number
  endMs: number
  startChar: number
  endChar: number
}

function clipText(text: string, max = 180) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (!value) return ''
  if (value.length <= max) return value
  return value.slice(0, max).replace(/[\s,;:.!?-]+$/, '') + '...'
}

function normalizeSpokenText(text: string, max = 180) {
  return clipText(text, max).replace(/^[-•\s]+/, '').trim()
}

function toSentence(text: string) {
  const value = String(text || '').trim().replace(/[\s,;:]+$/, '')
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

function buildSpokenNarration(opening: string, segments: string[], closing?: string, max = 240) {
  const uniqueSegments = segments
    .map((segment) => normalizeSpokenText(segment, 150))
    .filter(Boolean)
    .filter((segment, index, collection) => collection.findIndex((entry) => entry.toLowerCase() === segment.toLowerCase()) === index)

  const sentenceParts = [opening, ...uniqueSegments, closing]
    .map((part) => toSentence(part || ''))
    .filter(Boolean)

  return clipText(sentenceParts.join(' '), max)
}

function hashText(text: string) {
  return Array.from(String(text || '')).reduce((total, char) => total + char.charCodeAt(0), 0)
}

function pickVariant(seed: string, options: string[]) {
  if (!options.length) return ''
  return options[hashText(seed) % options.length]
}

function getWatchTone(category?: string) {
  const value = String(category || '').toLowerCase()

  if (/sports/.test(value)) {
    return {
      intro: [
        'Quick run-through',
        'Here is the fast read',
        'The big swing in this story is this',
      ],
      hookClose: [
        'So the momentum in this story changed quickly.',
        'That is why this one feels like a real shift, not just a small update.',
      ],
      pointOne: ['The first turning point is this', 'The first real swing is this'],
      pointTwo: ['The next thing to watch is what this sets up', 'The next angle is where this could go'],
      closer: ['The takeaway right now is this', 'The quick takeaway is this'],
      max: 240,
    }
  }

  if (/business|market|finance/.test(value)) {
    return {
      intro: [
        'Start with the market read',
        'The core signal here is this',
        'Here is the business read on this update',
      ],
      hookClose: [
        'That is why this update changes the read-through from here.',
        'That is why markets would pay attention to this move.',
      ],
      pointOne: ['The first material shift is this', 'The first important move is this'],
      pointTwo: ['The next layer is what this may trigger', 'The next thing to watch is the knock-on effect'],
      closer: ['The practical market takeaway is this', 'The bottom line for now is this'],
      max: 250,
    }
  }

  if (/tech|science/.test(value)) {
    return {
      intro: [
        'Here is the broader read',
        'Start with the main frame',
        'At a high level, here is the story',
      ],
      hookClose: [
        'So the significance is in what this changes structurally, not just what it announces.',
        'That is why this matters beyond the headline itself.',
      ],
      pointOne: ['The first important development is this', 'The first thing to note is this'],
      pointTwo: ['The next layer is what this could lead to', 'The next question is what this changes downstream'],
      closer: ['The clearest takeaway right now is this', 'The key point to carry forward is this'],
      max: 290,
    }
  }

  return {
    intro: [
      'Here is the bigger picture',
      'The broad read is this',
      'At the top level, here is the story',
    ],
    hookClose: [
      'So this is more than a headline change. It shifts where the story points next.',
      'That is why this update matters. It changes the way the rest of the story reads.',
    ],
    pointOne: ['The first important shift is this', 'The first move to notice is this'],
    pointTwo: ['What matters next is where this leads', 'The follow-on question is what this changes next'],
    closer: ['The practical takeaway is this', 'The useful bottom line is this'],
    max: 280,
  }
}

function estimateDurationMs(text: string) {
  const words = clipText(text, 400).split(/\s+/).filter(Boolean).length
  return Math.min(16000, Math.max(4200, words * 430))
}

function splitCaptionChunks(text: string) {
  const normalized = clipText(text, 320)
  const sentenceChunks = normalized
    .split(/(?<=[.!?])\s+|,\s+|;\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)

  const chunks = sentenceChunks.flatMap((chunk) => {
    const words = chunk.split(/\s+/).filter(Boolean)
    if (words.length <= 6) return [chunk]

    const parts: string[] = []
    for (let index = 0; index < words.length; index += 4) {
      parts.push(words.slice(index, index + 4).join(' '))
    }
    return parts
  })

  return chunks.length ? chunks : [normalized]
}

function buildCaptions(narration: string, durationMs: number): WatchCaption[] {
  const chunks = splitCaptionChunks(narration)
  const totalWords = chunks.reduce((count, chunk) => count + chunk.split(/\s+/).filter(Boolean).length, 0) || 1
  let elapsed = 0
  let searchStart = 0

  return chunks.map((chunk, index) => {
    const words = chunk.split(/\s+/).filter(Boolean).length || 1
    const remaining = durationMs - elapsed
    const sliceMs = index === chunks.length - 1
      ? remaining
      : Math.max(900, Math.round(durationMs * (words / totalWords)))
    const startChar = Math.max(0, narration.indexOf(chunk, searchStart))
    const endChar = startChar + chunk.length
    const caption = {
      text: chunk,
      startMs: elapsed,
      endMs: Math.min(durationMs, elapsed + sliceMs),
      startChar,
      endChar,
    }

    elapsed = caption.endMs
    searchStart = endChar
    return caption
  })
}

function formatPlaybackTime(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function resolveTimelinePosition(scenes: WatchScene[], progressPercent: number) {
  const clampedProgress = Math.max(0, Math.min(100, progressPercent))
  const totalDurationMs = scenes.reduce((total, scene) => total + scene.durationMs, 0)
  const targetElapsedMs = Math.round((clampedProgress / 100) * totalDurationMs)
  let accumulatedMs = 0
  let targetSceneIndex = 0
  let targetSceneElapsedMs = 0

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index]
    const sceneEndMs = accumulatedMs + scene.durationMs
    if (targetElapsedMs <= sceneEndMs || index === scenes.length - 1) {
      targetSceneIndex = index
      targetSceneElapsedMs = Math.max(0, Math.min(scene.durationMs, targetElapsedMs - accumulatedMs))
      break
    }
    accumulatedMs = sceneEndMs
  }

  const scene = scenes[targetSceneIndex]
  const sceneProgress = scene?.durationMs ? Math.min(100, (targetSceneElapsedMs / scene.durationMs) * 100) : 0

  return {
    totalDurationMs,
    targetElapsedMs,
    targetSceneIndex,
    targetSceneElapsedMs,
    targetSceneProgress: sceneProgress,
  }
}

function isUnavailableAnalysisText(text?: string) {
  const value = String(text || '').trim().toLowerCase()
  if (!value) return false
  return value.includes('ai analysis temporarily unavailable') || value.includes('unable to load analysis right now')
}

function activeCaptionIndexForElapsed(scene: WatchScene, sceneElapsedMs: number) {
  const nextIndex = scene.captions.findIndex((caption) => sceneElapsedMs >= caption.startMs && sceneElapsedMs < caption.endMs)
  if (nextIndex >= 0) return nextIndex
  return Math.max(0, scene.captions.length - 1)
}

function getSceneImageIndex(scene: WatchScene | undefined, sceneIndex: number, sceneCount: number, imageCount: number) {
  if (imageCount <= 1) return 0
  if (sceneCount <= 1) return 0

  if (scene?.id === 'hook') return 0
  if (scene?.id === 'point-2') return Math.min(1, imageCount - 1)
  if (scene?.id === 'closer') return imageCount - 1
  if (scene?.id === 'point-1') return Math.min(Math.max(1, Math.floor((imageCount - 1) / 2)), imageCount - 1)

  const ratio = sceneIndex / Math.max(sceneCount - 1, 1)
  return Math.min(imageCount - 1, Math.round(ratio * (imageCount - 1)))
}

function buildScenes(article: WatchArticle, analysis: WatchAnalysis | null, content: WatchContent | null): WatchScene[] {
  const toneSeed = `${article.title}|${article.source || ''}|${article.category || ''}`
  const tone = getWatchTone(article.category)
  const analysisTldr = !analysis?.loading && !isUnavailableAnalysisText(analysis?.tldr) ? analysis?.tldr : ''
  const analysisContext = !analysis?.loading && !isUnavailableAnalysisText(analysis?.context) ? analysis?.context : ''
  const analysisPoints = !analysis?.loading
    ? (analysis?.keyPoints || []).filter((point) => !isUnavailableAnalysisText(point))
    : []
  const lead = normalizeSpokenText(analysisTldr || content?.subtitle || article.summary || article.title, 170)
  const points = analysisPoints
    .map((point) => normalizeSpokenText(point, 150))
    .filter(Boolean)
    .slice(0, 2)
  const supportingParagraph = normalizeSpokenText(content?.paragraphs?.find((paragraph) => paragraph.length > 110) || analysisContext || '', 180)
  const closer = normalizeSpokenText(analysisContext || content?.paragraphs?.[1] || article.summary || '', 180)
  const articleSummary = normalizeSpokenText(article.summary || article.title, 160)
  const backgroundParagraph = normalizeSpokenText(content?.paragraphs?.find((paragraph) => paragraph.length > 80 && paragraph !== supportingParagraph) || '', 170)
  const sourceLine = article.source ? `${article.source} is framing it this way` : 'This is the line the story is moving on'
  const timingLine = article.time ? `The update landed ${article.time.toLowerCase()}` : 'This is still a developing update'
  const hookClosing = pickVariant(`${toneSeed}:hook-closing`, tone.hookClose)
  const pointOneOpening = pickVariant(`${toneSeed}:point-1-opening`, tone.pointOne)
  const pointOneClosing = pickVariant(`${toneSeed}:point-1-closing`, [
    'That is the move that gives the rest of the coverage its shape.',
    'That is the change that sets the pace for everything that follows.',
    'That is the move that makes the rest of the story make sense.',
  ])
  const pointTwoOpening = pickVariant(`${toneSeed}:point-2-opening`, tone.pointTwo)
  const pointTwoClosing = pickVariant(`${toneSeed}:point-2-closing`, [
    'That is where the implications become more concrete.',
    'That is where the consequences stop being abstract.',
    'That is the point where the story starts to widen out.',
  ])
  const closerOpening = pickVariant(`${toneSeed}:closer-opening`, tone.closer)
  const closerClosing = pickVariant(`${toneSeed}:closer-closing`, [
    'The details may keep moving, but this is the part to remember going into the next update.',
    'That is the piece to hold onto as the next update comes in.',
    'Even if the details shift again, this is the thread worth remembering.',
  ])

  const hookNarration = buildSpokenNarration(
    '',
    [lead, points[0] || articleSummary, timingLine],
    hookClosing,
    tone.max,
  )

  const pointOneNarration = buildSpokenNarration(
    pointOneOpening,
    [points[0] || articleSummary, supportingParagraph || backgroundParagraph],
    pointOneClosing,
    tone.max,
  )

  const pointTwoNarration = buildSpokenNarration(
    pointTwoOpening,
    [points[1] || supportingParagraph || lead, backgroundParagraph || closer, sourceLine],
    pointTwoClosing,
    tone.max,
  )

  const closerNarration = buildSpokenNarration(
    closerOpening,
    [closer || lead, sourceLine, timingLine],
    closerClosing,
    tone.max + 20,
  )

  const sceneSeeds = [
    {
      id: 'hook',
      label: article.category ? `${article.category} Brief` : 'Opening',
      title: 'Why this story matters',
      narration: hookNarration || lead || article.title,
      accent: 'rgba(184,71,42,0.92)',
    },
    {
      id: 'point-1',
      label: 'Key Shift',
      title: points[0] ? 'What changed' : 'Main development',
      narration: pointOneNarration || points[0] || articleSummary || article.title,
      accent: 'rgba(124,84,62,0.9)',
    },
    {
      id: 'point-2',
      label: 'Details',
      title: points[1] ? 'What to notice' : 'Inside the story',
      narration: pointTwoNarration || points[1] || supportingParagraph || lead || article.title,
      accent: 'rgba(111,141,122,0.92)',
    },
    {
      id: 'closer',
      label: article.source ? `From ${article.source}` : 'Takeaway',
      title: 'The takeaway',
      narration: closerNarration || closer || lead || article.title,
      accent: 'rgba(95,70,60,0.9)',
    },
  ]

  return sceneSeeds
    .filter((scene, index, collection) => Boolean(scene.narration) && collection.findIndex((entry) => entry.narration === scene.narration) === index)
    .map((scene) => {
      const durationMs = estimateDurationMs(scene.narration)
      return {
        ...scene,
        durationMs,
        captions: buildCaptions(scene.narration, durationMs),
      }
    })
}

export default function WatchPlayer({ article, analysis, content, contentLoading = false, mediaImages = [], video = null, videoLoading = false, image, onClose }: WatchPlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [audioPreparing, setAudioPreparing] = useState(false)
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [sliderProgress, setSliderProgress] = useState(0)
  const [sceneDurationOverrides, setSceneDurationOverrides] = useState<Record<string, number>>({})
  const [sceneIndex, setSceneIndex] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [sceneElapsedMs, setSceneElapsedMs] = useState(0)
  const [activeCaptionIndex, setActiveCaptionIndex] = useState(0)
  const [displayImage, setDisplayImage] = useState(image)
  const [previousImage, setPreviousImage] = useState<string | null>(null)
  const [imageTransitioning, setImageTransitioning] = useState(false)
  const [frozenImageTransform, setFrozenImageTransform] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioStartTimerRef = useRef<number | null>(null)
  const playbackRequestIdRef = useRef(0)
  const audioUrlCacheRef = useRef<Record<string, string>>({})
  const pendingAudioUrlRef = useRef<Record<string, Promise<string | null>>>({})
  const audioDurationMsRef = useRef<Record<string, number>>({})
  const sceneResumeMsRef = useRef(0)
  const imageTransitionTimerRef = useRef<number | null>(null)
  const liveImageTransformRef = useRef('translate3d(0px, 0, 0) scale(1.03)')
  const autoplayStartedRef = useRef(false)
  const sliderProgressRef = useRef(0)
  const isScrubbingRef = useRef(false)
  const shouldResumeAfterScrubRef = useRef(false)
  const sessionIdRef = useRef(createAudioSessionId('watch'))

  const baseScenes = useMemo(() => buildScenes(article, analysis, content), [article, analysis, content])
  const watchVoice = useMemo(
    () => pickTtsVoice(`${article.title}|${article.source || ''}|${article.category || ''}`, 'watch'),
    [article],
  )

  const scenes = useMemo(() => baseScenes.map((scene) => {
    const durationMs = sceneDurationOverrides[scene.id] || scene.durationMs
    if (durationMs === scene.durationMs) return scene

    return {
      ...scene,
      durationMs,
      captions: buildCaptions(scene.narration, durationMs),
    }
  }), [baseScenes, sceneDurationOverrides])

  function buildTtsRequestUrl(narration: string) {
    return apiUrl(`/api/tts?rewrite=0&mode=watch&strictAzure=1&text=${encodeURIComponent(narration.slice(0, 2000))}&voice=${encodeURIComponent(watchVoice.id)}`)
  }

  function buildAudioCacheKey(narration: string) {
    return `${watchVoice.id}::${narration.slice(0, 2000)}`
  }

  async function preloadSceneAudio(narration: string) {
    if (!narration.trim()) return null

    const cacheKey = buildAudioCacheKey(narration)
    if (audioUrlCacheRef.current[cacheKey]) return audioUrlCacheRef.current[cacheKey]
    if (pendingAudioUrlRef.current[cacheKey]) return pendingAudioUrlRef.current[cacheKey]

    const requestUrl = buildTtsRequestUrl(narration)

    pendingAudioUrlRef.current[cacheKey] = preloadAudioUrl(requestUrl)
      .then((ok) => {
        if (!ok) return null
        audioUrlCacheRef.current[cacheKey] = requestUrl
        return requestUrl
      })
      .catch(() => null)
      .finally(() => {
        delete pendingAudioUrlRef.current[cacheKey]
      })

    return pendingAudioUrlRef.current[cacheKey]
  }

  const sceneStarts = scenes.map((_, index) => scenes.slice(0, index).reduce((total, scene) => total + scene.durationMs, 0))
  const totalMs = scenes.reduce((total, scene) => total + scene.durationMs, 0)
  const currentScene = scenes[sceneIndex] || scenes[0]
  const scriptKey = scenes.map((scene) => scene.narration).join('|')
  const hasOriginalVideo = Boolean(video?.url)
  const usingArticleVideo = video?.source !== 'youtube-search'
  const visualImages = useMemo(() => {
    const primaryImage = /picsum\.photos\/seed\//i.test(String(image || '')) && mediaImages.length
      ? ''
      : image
    const nextImages = [primaryImage, ...mediaImages].filter(Boolean)
    return nextImages.filter((url, index) => nextImages.indexOf(url) === index)
  }, [image, mediaImages])

  useEffect(() => {
    return () => {
      audioUrlCacheRef.current = {}
    }
  }, [])

  useEffect(() => {
    autoplayStartedRef.current = false
    setSceneDurationOverrides({})
    audioDurationMsRef.current = {}
  }, [article.title, article.source, article.category])

  useEffect(() => {
    if (!currentScene) return
    void preloadSceneAudio(currentScene.narration)
  }, [currentScene?.id, currentScene?.narration, watchVoice.id])

  useEffect(() => {
    if (hasOriginalVideo || !scenes.length) return

    let cancelled = false

    void (async () => {
      for (const scene of scenes) {
        if (cancelled) return
        await preloadSceneAudio(scene.narration)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [hasOriginalVideo, scenes, scriptKey, watchVoice.id])

  useEffect(() => {
    const nextScene = scenes[sceneIndex + 1]
    if (!nextScene) return

    void preloadSceneAudio(nextScene.narration)
  }, [sceneIndex, scenes, watchVoice.id])

  function stopNarration() {
    playbackRequestIdRef.current += 1
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
  }

  function syncSceneProgress(nextSceneIndex: number, nextSceneElapsedMs: number, nextCaptionIndex?: number) {
    const scene = scenes[nextSceneIndex]
    if (!scene) return

    const boundedSceneElapsed = Math.max(0, Math.min(scene.durationMs, nextSceneElapsedMs))
    sceneResumeMsRef.current = boundedSceneElapsed
    setSceneIndex(nextSceneIndex)
    setSceneElapsedMs(boundedSceneElapsed)
    setElapsedMs((sceneStarts[nextSceneIndex] || 0) + boundedSceneElapsed)
    setActiveCaptionIndex(typeof nextCaptionIndex === 'number' ? nextCaptionIndex : activeCaptionIndexForElapsed(scene, boundedSceneElapsed))
  }

  function finishPlayback() {
    stopNarration()
    if (!hasOriginalVideo && scenes.length && firstVisualImage && firstVisualImage !== displayImage) {
      if (imageTransitionTimerRef.current !== null) {
        window.clearTimeout(imageTransitionTimerRef.current)
        imageTransitionTimerRef.current = null
      }

      setPreviousImage(displayImage)
      setDisplayImage(firstVisualImage)
      setImageTransitioning(true)
      setFrozenImageTransform(liveImageTransformRef.current)

      imageTransitionTimerRef.current = window.setTimeout(() => {
        setPreviousImage(null)
        setImageTransitioning(false)
        setFrozenImageTransform(null)
        syncSceneProgress(0, 0, 0)
        imageTransitionTimerRef.current = null
      }, 520)
    } else {
      syncSceneProgress(0, 0, 0)
    }

    setPlaying(false)
    setAudioPreparing(false)
  }

  function advanceFromScene(startIndex: number, scene: WatchScene) {
    syncSceneProgress(startIndex, scene.durationMs, Math.max(0, scene.captions.length - 1))
    if (startIndex < scenes.length - 1) {
      playScene(startIndex + 1, 0)
    } else {
      finishPlayback()
    }
  }

  function stopAzureScenePlayback(playbackRequestId: number) {
    if (playbackRequestIdRef.current !== playbackRequestId) return
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlaying(false)
    setAudioPreparing(false)
  }

  function playScene(startIndex: number, resumeMs = 0) {
    const scene = scenes[startIndex]
    if (!scene) return

    stopNarration()
    requestExclusiveAudio({ ownerId: sessionIdRef.current, source: 'watch' })
    setAudioPreparing(true)
    const playbackRequestId = playbackRequestIdRef.current + 1
    playbackRequestIdRef.current = playbackRequestId
    const boundedResume = Math.max(0, Math.min(scene.durationMs, resumeMs))
    const resumeCaptionIndex = activeCaptionIndexForElapsed(scene, boundedResume)

    syncSceneProgress(startIndex, boundedResume, resumeCaptionIndex)

    const startAudio = (sourceUrl: string) => {
      if (playbackRequestIdRef.current !== playbackRequestId) return
      const audio = new Audio(sourceUrl)
      audio.preload = 'auto'
      audioRef.current = audio
      audio.currentTime = 0
      audio.onloadedmetadata = () => {
        if (audio.duration && Number.isFinite(audio.duration)) {
          const durationMs = Math.max(1, Math.round(audio.duration * 1000))
          audioDurationMsRef.current[scene.id] = durationMs
          setSceneDurationOverrides((current) => current[scene.id] === durationMs ? current : { ...current, [scene.id]: durationMs })
        }
      }
      audio.oncanplay = () => {
        if (audioStartTimerRef.current !== null) {
          window.clearTimeout(audioStartTimerRef.current)
          audioStartTimerRef.current = null
        }
        setAudioPreparing(false)
      }
      audio.onplaying = () => {
        setAudioPreparing(false)
        setPlaying(true)
      }
      audio.ontimeupdate = () => {
        const actualDurationMs = audioDurationMsRef.current[scene.id] || (audio.duration && Number.isFinite(audio.duration) ? audio.duration * 1000 : scene.durationMs)
        const progressRatio = actualDurationMs > 0 ? (audio.currentTime * 1000) / actualDurationMs : 0
        const nextSceneElapsed = Math.min(scene.durationMs, Math.round(progressRatio * scene.durationMs))
        syncSceneProgress(startIndex, nextSceneElapsed)
      }
      audio.onended = () => {
        if (audioStartTimerRef.current !== null) {
          window.clearTimeout(audioStartTimerRef.current)
          audioStartTimerRef.current = null
        }
        setAudioPreparing(false)
        advanceFromScene(startIndex, scene)
      }
      audio.onerror = () => {
        setAudioPreparing(false)
        stopAzureScenePlayback(playbackRequestId)
      }
      audioStartTimerRef.current = window.setTimeout(() => {
        stopAzureScenePlayback(playbackRequestId)
      }, AUDIO_START_TIMEOUT_MS)
      audio.play().catch(() => {
        stopAzureScenePlayback(playbackRequestId)
      })
    }

    const cacheKey = buildAudioCacheKey(scene.narration)
    const cachedAudioUrl = audioUrlCacheRef.current[cacheKey]
    if (cachedAudioUrl) {
      startAudio(cachedAudioUrl)
      return
    }

    audioStartTimerRef.current = window.setTimeout(() => {
      stopAzureScenePlayback(playbackRequestId)
    }, AUDIO_START_TIMEOUT_MS)

    void (pendingAudioUrlRef.current[cacheKey] || preloadSceneAudio(scene.narration))
      .then((preloadedUrl) => {
        if (playbackRequestIdRef.current !== playbackRequestId) return
        if (audioStartTimerRef.current !== null) {
          window.clearTimeout(audioStartTimerRef.current)
          audioStartTimerRef.current = null
        }
        startAudio(preloadedUrl || buildTtsRequestUrl(scene.narration))
      })
      .catch(() => {
        stopAzureScenePlayback(playbackRequestId)
      })
  }

  function pausePlayback() {
    stopNarration()
    setPlaying(false)
    setAudioPreparing(false)
  }

  function togglePlayback() {
    if (playing || audioPreparing) {
      pausePlayback()
      return
    }

    playScene(sceneIndex, sceneResumeMsRef.current)
  }

  function jumpToScene(index: number) {
    sceneResumeMsRef.current = 0
    syncSceneProgress(index, 0, 0)
    playScene(index, 0)
  }

  function stepScene(direction: -1 | 1) {
    const nextIndex = Math.min(Math.max(sceneIndex + direction, 0), scenes.length - 1)
    if (nextIndex === sceneIndex) return
    jumpToScene(nextIndex)
  }

  function seekToProgress(nextProgress: number, shouldResumePlayback = playing || audioPreparing) {
    if (hasOriginalVideo || !scenes.length || totalMs <= 0) return

    const timelinePosition = resolveTimelinePosition(scenes, nextProgress)
    const targetSceneIndex = timelinePosition.targetSceneIndex
    const targetSceneElapsedMs = timelinePosition.targetSceneElapsedMs

    sceneResumeMsRef.current = targetSceneElapsedMs
    syncSceneProgress(targetSceneIndex, targetSceneElapsedMs)

    if (shouldResumePlayback) {
      playScene(targetSceneIndex, targetSceneElapsedMs)
    }
  }

  function beginScrub(currentProgress = progress) {
    if (isScrubbingRef.current) return
    shouldResumeAfterScrubRef.current = playing || audioPreparing
    if (shouldResumeAfterScrubRef.current) {
      pausePlayback()
    }
    const clampedProgress = Math.max(0, Math.min(100, currentProgress))
    isScrubbingRef.current = true
    setIsScrubbing(true)
    setSliderProgress(clampedProgress)
    sliderProgressRef.current = clampedProgress
  }

  function updateScrub(nextProgress: number) {
    const clampedProgress = Math.max(0, Math.min(100, nextProgress))
    setSliderProgress(clampedProgress)
    sliderProgressRef.current = clampedProgress
  }

  function commitScrub(finalProgress = sliderProgressRef.current) {
    if (!isScrubbingRef.current) return
    const shouldResumePlayback = shouldResumeAfterScrubRef.current
    const clampedProgress = Math.max(0, Math.min(100, finalProgress))
    isScrubbingRef.current = false
    shouldResumeAfterScrubRef.current = false
    setIsScrubbing(false)
    setSliderProgress(clampedProgress)
    sliderProgressRef.current = clampedProgress
    seekToProgress(clampedProgress, shouldResumePlayback)
  }

  useEffect(() => {
    if (hasOriginalVideo || videoLoading) {
      stopNarration()
      setPlaying(false)
      setAudioPreparing(false)
      autoplayStartedRef.current = false
      return
    }

    if (!scenes.length) return
    if (autoplayStartedRef.current) return

    let cancelled = false
    autoplayStartedRef.current = true
    sceneResumeMsRef.current = 0
    syncSceneProgress(0, 0, 0)

    setAudioPreparing(true)
    void preloadSceneAudio(baseScenes[0].narration)
      .then(() => {
        if (cancelled) return
        playScene(0, 0)
      })
      .catch(() => {
        if (cancelled) return
        playScene(0, 0)
      })

    return () => {
      cancelled = true
      stopNarration()
      setAudioPreparing(false)
    }
  }, [article.title, article.source, article.category, hasOriginalVideo, videoLoading, scenes.length])

  useEffect(() => subscribeExclusiveAudio(sessionIdRef.current, () => {
    stopNarration()
    setPlaying(false)
    setAudioPreparing(false)
  }), [])

  const progress = totalMs ? Math.min(100, (elapsedMs / totalMs) * 100) : 0
  useEffect(() => {
    if (isScrubbingRef.current) return
    setSliderProgress(progress)
    sliderProgressRef.current = progress
  }, [progress])

  const displayedProgress = sliderProgress
  const scrubTimelinePosition = isScrubbing ? resolveTimelinePosition(scenes, displayedProgress) : null
  const displayedSceneIndex = scrubTimelinePosition?.targetSceneIndex ?? sceneIndex
  const displayedSceneProgress = scrubTimelinePosition?.targetSceneProgress ?? (currentScene?.durationMs ? Math.min(100, (sceneElapsedMs / currentScene.durationMs) * 100) : 0)
  const displayedElapsedMs = Math.round((Math.max(0, Math.min(displayedProgress, 100)) / 100) * totalMs)
  const activeCaption = currentScene?.captions?.[activeCaptionIndex]
  const currentMotionProgress = currentScene?.durationMs ? (sceneElapsedMs / currentScene.durationMs) : 0
  const motionProfiles = [
    {
      origin: 'center center',
      startScale: 1.18,
      scaleDelta: 0.18,
      shiftX: 22,
      shiftY: -14,
      rotate: 0.6,
    },
    {
      origin: 'left center',
      startScale: 1.16,
      scaleDelta: 0.13,
      shiftX: 74,
      shiftY: 18,
      rotate: -1.1,
    },
    {
      origin: 'right top',
      startScale: 1.28,
      scaleDelta: -0.08,
      shiftX: -52,
      shiftY: 34,
      rotate: 1.4,
    },
    {
      origin: 'center top',
      startScale: 1.14,
      scaleDelta: 0.12,
      shiftX: 34,
      shiftY: -22,
      rotate: -0.8,
    },
  ] as const
  const motionProfile = motionProfiles[sceneIndex % motionProfiles.length]
  const easedMotionProgress = 1 - Math.pow(1 - currentMotionProgress, 1.45)
  const currentMotionShiftX = motionProfile.shiftX * easedMotionProgress
  const currentMotionShiftY = motionProfile.shiftY * easedMotionProgress
  const currentMotionRotate = motionProfile.rotate * easedMotionProgress
  const currentMotionScale = motionProfile.startScale + motionProfile.scaleDelta * easedMotionProgress
  const imageTransformOrigin = motionProfile.origin
  const liveImageTransform = `translate3d(${currentMotionShiftX}px, ${currentMotionShiftY}px, 0) scale(${currentMotionScale}) rotate(${currentMotionRotate}deg)`
  const visualIndex = !hasOriginalVideo && visualImages.length > 1
    ? getSceneImageIndex(currentScene, sceneIndex, scenes.length, visualImages.length)
    : 0
  const currentVisualImage = visualImages[visualIndex] || image
  const firstScene = scenes[0]
  const firstVisualIndex = !hasOriginalVideo && visualImages.length > 1
    ? getSceneImageIndex(firstScene, 0, scenes.length, visualImages.length)
    : 0
  const firstVisualImage = visualImages[firstVisualIndex] || image
  const shellBg = 'linear-gradient(180deg, rgba(255,255,255,0.84), rgba(247,241,235,0.98))'
  const shellBorder = '1px solid rgba(26,26,26,0.09)'
  const shellShadow = '0 26px 64px rgba(76,51,39,0.18)'
  const shellText = '#1a1a1a'
  const shellMuted = 'rgba(26,26,26,0.55)'
  const shellSoft = 'rgba(255,255,255,0.48)'
  const chipBorder = '1px solid rgba(26,26,26,0.06)'

  useEffect(() => {
    liveImageTransformRef.current = liveImageTransform
  }, [liveImageTransform])

  useEffect(() => {
    if (hasOriginalVideo) return
    if (currentVisualImage === displayImage) return

    if (imageTransitionTimerRef.current !== null) {
      window.clearTimeout(imageTransitionTimerRef.current)
      imageTransitionTimerRef.current = null
    }

    setPreviousImage(displayImage)
    setDisplayImage(currentVisualImage)
    setImageTransitioning(true)
    setFrozenImageTransform(liveImageTransformRef.current)

    imageTransitionTimerRef.current = window.setTimeout(() => {
      setPreviousImage(null)
      setImageTransitioning(false)
      setFrozenImageTransform(null)
      imageTransitionTimerRef.current = null
    }, 520)

    return () => {
      if (imageTransitionTimerRef.current !== null) {
        window.clearTimeout(imageTransitionTimerRef.current)
        imageTransitionTimerRef.current = null
      }
    }
  }, [currentVisualImage, displayImage, hasOriginalVideo])

  useEffect(() => {
    if (hasOriginalVideo) return
    setDisplayImage(currentVisualImage)
    setPreviousImage(null)
    setImageTransitioning(false)
    setFrozenImageTransform(null)
  }, [hasOriginalVideo])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(72,49,37,0.18)', backdropFilter: 'blur(12px)', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ position: 'relative', width: 'min(1080px, 100%)', borderRadius: 28, overflow: 'hidden', background: shellBg, color: shellText, boxShadow: shellShadow, border: shellBorder, padding: 18 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: -46, right: -34, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(184,71,42,0.14), rgba(184,71,42,0) 72%)' }} />
          <div style={{ position: 'absolute', top: 48, left: -52, width: 168, height: 168, borderRadius: '50%', background: 'radial-gradient(circle, rgba(111,141,122,0.12), rgba(111,141,122,0) 72%)' }} />
        </div>

        <div style={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden', background: '#201916', borderRadius: 22, border: '1px solid rgba(26,26,26,0.08)' }}>
          {hasOriginalVideo ? (
            video?.kind === 'iframe' ? (
              <iframe
                src={video.url}
                title={video.title || article.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#000' }}
              />
            ) : (
              <video
                src={video.url}
                poster={proxiedImageUrl(video.poster || '') || image}
                controls
                playsInline
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#000' }}
              />
            )
          ) : (
            <>
              {previousImage && (
                <img src={previousImage} alt="" decoding="async" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transformOrigin: imageTransformOrigin, willChange: 'transform, opacity', filter: 'brightness(0.62) saturate(1.05)', transform: frozenImageTransform || liveImageTransform, opacity: imageTransitioning ? 0 : 1, transition: 'opacity 560ms ease, transform 220ms linear' }} />
              )}
              <img src={displayImage} alt="" decoding="async" fetchPriority="high" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transformOrigin: imageTransformOrigin, willChange: 'transform, opacity', filter: 'brightness(0.62) saturate(1.05)', transform: frozenImageTransform || liveImageTransform, opacity: 1, transition: 'opacity 560ms ease, transform 220ms linear' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', background: 'linear-gradient(180deg, rgba(17,13,11,0) 0%, rgba(17,13,11,0.10) 28%, rgba(17,13,11,0.34) 62%, rgba(17,13,11,0.72) 100%)' }} />
            </>
          )}
          <div style={{ position: 'absolute', top: 24, left: 24, right: 24, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
            <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.12)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} aria-label="Close watch player">
              <X size={16} />
            </button>
          </div>

          <div style={{ position: 'absolute', left: 28, right: 28, bottom: 20, display: 'grid', gap: 14 }}>
            {hasOriginalVideo ? (
              usingArticleVideo ? null : (
                <div style={{ maxWidth: 760, display: 'grid', gap: 10 }}>
                  <h2 style={{ fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.02em', color: '#fff', textShadow: '0 6px 24px rgba(0,0,0,0.24)' }}>{video?.title || article.title}</h2>
                  <p style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(255,255,255,0.88)', textShadow: '0 4px 18px rgba(0,0,0,0.2)', maxWidth: 640 }}>Watch could not find an embedded source video, so it is using the closest official YouTube result for this story. Click play inside the player to start audio with sound.</p>
                </div>
              )
            ) : (
              <>
                <div style={{ width: '100%', maxWidth: 760, margin: '0 auto' }}>
                    <div style={{ width: '100%', display: 'grid', gap: 10, maxWidth: 720, margin: '0 auto', justifyItems: 'center' }}>
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                      <p style={{ margin: 0, display: 'inline-block', width: 'fit-content', maxWidth: 'min(100%, 700px)', fontSize: 22, lineHeight: 1.35, color: '#fff', textShadow: '0 8px 24px rgba(0,0,0,0.34)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {activeCaption?.text || currentScene?.narration || article.summary || article.title}
                      </p>
                    </div>
                    <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
                      <div style={{ height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden', maxWidth: 520 }}>
                        <div style={{ height: '100%', width: `${displayedSceneProgress}%`, borderRadius: 999, background: currentScene?.accent || 'rgba(184,71,42,0.92)', transition: 'width 160ms linear' }} />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', padding: '18px 4px 4px' }}>
          {!hasOriginalVideo && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
              <input
                className="podcast-progress-slider"
                type="range"
                min={0}
                max={100}
                step={0.1}
                value={displayedProgress}
                onPointerDown={(event) => beginScrub(Number((event.currentTarget as HTMLInputElement).value))}
                onPointerUp={(event) => commitScrub(Number((event.currentTarget as HTMLInputElement).value))}
                onPointerCancel={() => commitScrub()}
                onInput={(event) => updateScrub(Number((event.currentTarget as HTMLInputElement).value))}
                onKeyDown={(event) => {
                  if (!isScrubbingRef.current) {
                    beginScrub(Number((event.currentTarget as HTMLInputElement).value))
                  }
                }}
                onKeyUp={(event) => commitScrub(Number((event.currentTarget as HTMLInputElement).value))}
                onBlur={() => commitScrub()}
                aria-label="Seek watch playback"
                style={{ ['--progress' as string]: `${displayedProgress}%`, ['--accent-start' as string]: '#e74c3c', ['--accent-end' as string]: '#c0392b', ['--track' as string]: 'rgba(26,26,26,0.08)' } as CSSProperties}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: shellMuted, letterSpacing: 0.2, padding: '0 2px' }}>
                <span>{formatPlaybackTime(displayedElapsedMs)}</span>
                <span>{formatPlaybackTime(totalMs)}</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {hasOriginalVideo ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 999, background: shellSoft, border: chipBorder, color: shellMuted, fontSize: 12 }}>
                  <Play size={14} />
                  <span>{usingArticleVideo ? 'Playing the embedded source video' : 'Playing a related YouTube result'}</span>
                </div>
              ) : (
                scenes.map((scene, index) => (
                  <button
                    key={scene.id}
                    onClick={() => jumpToScene(index)}
                    style={{ padding: '9px 12px', borderRadius: 14, border: index === displayedSceneIndex ? '1px solid rgba(231,76,60,0.18)' : chipBorder, background: index === displayedSceneIndex ? 'rgba(231,76,60,0.08)' : shellSoft, color: index === displayedSceneIndex ? '#6c2d1e' : '#5d534d', cursor: 'pointer', fontSize: 11, letterSpacing: 0.3, minWidth: 114, textAlign: 'left' }}
                  >
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span>{index + 1}. {scene.label}</span>
                      <span style={{ height: 2, borderRadius: 999, background: 'rgba(26,26,26,0.08)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', height: '100%', width: `${index === displayedSceneIndex ? displayedSceneProgress : index < displayedSceneIndex ? 100 : 0}%`, background: index === displayedSceneIndex ? '#e74c3c' : 'rgba(93,83,77,0.38)', transition: 'width 160ms linear' }} />
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!hasOriginalVideo && (
                <>
                  <button onClick={togglePlayback} style={{ border: 'none', borderRadius: 999, background: 'linear-gradient(135deg,#e74c3c,#c0392b)', color: '#fff', padding: '11px 16px', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', boxShadow: '0 12px 28px rgba(192,57,43,0.22)' }}>
                    {playing || audioPreparing ? <Pause size={15} /> : <Play size={15} />}
                    {playing || audioPreparing ? 'Pause' : 'Play'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}