import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { SkipBack, Play, Pause, SkipForward, Minus, X } from "lucide-react"
import { createAudioSessionId, requestExclusiveAudio, subscribeExclusiveAudio } from "./audioSession"
import { apiUrl } from "./api"
import { pickSequentialTtsVoice } from "./ttsVoices"

interface Article {
  title: string
  summary?: string
  source?: string
  keyPoints?: string[]
  link?: string
  time?: string
  category?: string
}

interface ArticleContent {
  subtitle?: string
  paragraphs: string[]
}

interface WeatherContext {
  greeting: string
  dateLine: string
  weatherLine: string
}

interface WeatherResolution {
  context: WeatherContext
  source: 'gps' | 'ip' | 'none'
}

interface Props {
  articles: Article[]
  startIdx?: number
  mode?: 'queue' | 'single'
  autoPlayToken?: number
  onClose: () => void
}

const WEATHER_RESOLVE_TIMEOUT_MS = 1800
const AUDIO_START_TIMEOUT_MS = 4000

function clipText(text: string, max = 220) {
  const value = String(text || "").replace(/\s+/g, " ").trim()
  if (!value) return ""
  if (value.length <= max) return value
  return value.slice(0, max).replace(/[\s,;:.!?-]+$/, "") + "..."
}

function normalizeSpeechText(text: string, max = 220) {
  return clipText(text, max)
    .replace(/^[-•\s]+/, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function lowercaseLead(text: string) {
  const value = String(text || "").trim()
  if (!value) return ""
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function toSentence(text: string) {
  const value = String(text || "").trim().replace(/[\s,;:]+$/, "")
  if (!value) return ""
  return /[.!?]$/.test(value) ? value : `${value}.`
}

function hashText(text: string) {
  return Array.from(String(text || "")).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

function pickVariant(seed: string, options: string[]) {
  if (!options.length) return ""
  return options[hashText(seed) % options.length]
}

function getListenTone(category?: string) {
  const value = String(category || "").toLowerCase()

  if (/sports/.test(value)) {
    return {
      opening: [
        "This one is worth a closer listen",
        "There is a lot packed into this one",
        "Let me walk you through this sports story",
      ],
      detail: [
        "The turning point here is that",
        "What really shifted is that",
        "The part that changes the feel of the story is that",
      ],
      closing: [
        "That is the part that gives this story its momentum.",
        "That is the piece to keep in mind as this keeps moving.",
      ],
      max: 1650,
    }
  }

  if (/business|market|finance/.test(value)) {
    return {
      opening: [
        "Here is the business story in plain English",
        "This one gets interesting pretty quickly",
        "The clearest way into this business story is this",
      ],
      detail: [
        "What matters underneath that is",
        "The practical takeaway here is that",
        "The next layer to understand is that",
      ],
      closing: [
        "That is the part likely to shape what happens next.",
        "That is the takeaway that really lingers after the headline.",
      ],
      max: 1780,
    }
  }

  if (/tech|science/.test(value)) {
    return {
      opening: [
        "The clearest way into this story is this",
        "Once you strip away the noise, here is what changed",
        "The real story here starts with this shift",
        "This one sounds technical, but the core idea is pretty direct",
        "Let us start with the part that actually matters",
        "Under the headline, this is the change to pay attention to",
        "The interesting part of this story is not the headline, it is this",
      ],
      detail: [
        "The detail that matters most is that",
        "What makes this more interesting is that",
        "The deeper point underneath all of this is that",
      ],
      closing: [
        "That is the part that matters long after the headline fades.",
        "That is the thread worth carrying with you into the next update.",
      ],
      max: 1920,
    }
  }

  return {
    opening: [
      "The clearest way into this story is this",
      "Here is what really stands out once you get into it",
      "The story starts to make sense when you look at it this way",
      "What jumps out first is this",
      "The useful way to hear this story is as follows",
      "Let us start with the part doing most of the work here",
    ],
    detail: [
      "What matters here is that",
      "Put simply,",
      "What this starts to mean in practice is that",
    ],
    closing: [
      "That is the thread worth keeping in mind from here.",
      "That is the angle that stays with the story going forward.",
    ],
    max: 1820,
  }
}

function formatFriendlyDate() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

function buildGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

function weatherCodeLabel(code: number) {
  const labels: Record<number, string> = {
    0: "clear",
    1: "mostly clear",
    2: "partly cloudy",
    3: "cloudy",
    45: "foggy",
    48: "misty",
    51: "light drizzle",
    53: "drizzle",
    55: "steady drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "rain showers",
    81: "showers",
    82: "heavy showers",
    95: "thunderstorms",
  }
  return labels[code] || "mixed weather"
}

function buildWeatherContext(city?: string, temperature?: number, weatherCode?: number): WeatherContext {
  const dateLine = `Today is ${formatFriendlyDate()}.`
  const greeting = buildGreeting()

  if (typeof temperature === "number" && typeof weatherCode === "number") {
    const tempC = Math.round(temperature)
    const tempF = Math.round((temperature * 9) / 5 + 32)
    const place = city ? `in ${city}` : "around you"
    return {
      greeting,
      dateLine,
      weatherLine: `Right now ${place}, it is ${tempF} degrees Fahrenheit, or ${tempC} degrees Celsius, and ${weatherCodeLabel(weatherCode)}.`,
    }
  }

  return {
    greeting,
    dateLine,
    weatherLine: "",
  }
}

function buildIntroLine(context: WeatherContext) {
  const pieces = [
    `${context.greeting}.`,
    context.dateLine,
    context.weatherLine,
    "Now, here is your first story.",
  ].filter(Boolean)

  return pieces.join(" ")
}

async function fetchWeatherForCoordinates(latitude: number, longitude: number, city = ""): Promise<WeatherContext> {
  const weatherResponse = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`,
  )

  if (!weatherResponse.ok) {
    throw new Error("weather lookup failed")
  }

  const weatherData = await weatherResponse.json()
  const temperature = weatherData?.current?.temperature_2m
  const weatherCode = weatherData?.current?.weather_code

  return buildWeatherContext(city, temperature, weatherCode)
}

async function fetchWeatherFromIp(): Promise<WeatherResolution> {
  const ipResponse = await fetch("https://ipwho.is/")
  if (!ipResponse.ok) throw new Error("ip lookup failed")

  const ipData = await ipResponse.json()
  if (!ipData?.success || typeof ipData?.latitude !== "number" || typeof ipData?.longitude !== "number") {
    throw new Error("ip lookup returned no coordinates")
  }

  const city = ipData?.city || ipData?.region || ipData?.country || ""
  const context = await fetchWeatherForCoordinates(ipData.latitude, ipData.longitude, city)
  return { context, source: 'ip' }
}

function buildTransitionLine(seed: string, isLast: boolean, currentVoiceName?: string, nextVoiceName?: string) {
  if (isLast) {
    return pickVariant(`${seed}:end`, [
      "That wraps up the listen for now.",
      "That is the last story in this listen.",
      "That is your final story for this round.",
      currentVoiceName ? `${currentVoiceName}, that is where we leave this roundup for now.` : "That is where we leave this roundup for now.",
    ])
  }

  return pickVariant(`${seed}:next`, [
    nextVoiceName ? `${nextVoiceName}, take us into the next story.` : "Next story.",
    nextVoiceName ? `Stay with us. ${nextVoiceName}, what matters in the next headline?` : "Moving to the next one.",
    nextVoiceName ? `Over to you, ${nextVoiceName}. Bring us the next update.` : "Here is the next story.",
    nextVoiceName ? `${nextVoiceName}, tell us more about the next news.` : "Up next, another story to know.",
    nextVoiceName ? `Let us keep the bulletin moving. ${nextVoiceName}, what should we watch next?` : "Now to the next item in the rundown.",
    nextVoiceName ? `And now a handoff to ${nextVoiceName} for the next story.` : "Here comes the next story in the lineup.",
  ])
}

function buildOpeningLine(seed: string, opening: string, lead: string, title: string) {
  const spokenLead = toSentence(lead || title)

  return pickVariant(`${seed}:opening-line`, [
    `${opening}. ${spokenLead}`,
    `${opening}, and the headline is straightforward. ${spokenLead}`,
    `${opening}. What stands out first is this. ${spokenLead}`,
    `${opening}. Here is the clean read. ${spokenLead}`,
    `${opening}. At the center of it is this. ${spokenLead}`,
  ])
}

function buildContextLine(seed: string, detailLead: string, text: string) {
  const spokenText = toSentence(lowercaseLead(text))
  if (!spokenText) return ""

  return pickVariant(`${seed}:context-line`, [
    `${detailLead} ${spokenText}`,
    `${detailLead} one layer deeper, ${lowercaseLead(spokenText)}`,
    `Another important detail is this. ${spokenText}`,
    `A little more context helps here. ${spokenText}`,
  ])
}

function buildBridgeLine(seed: string, text: string) {
  const spokenText = toSentence(lowercaseLead(text))
  if (!spokenText) return ""

  return pickVariant(`${seed}:bridge-line`, [
    `What makes this more interesting is the next part. ${spokenText}`,
    `A more complete read sounds like this. ${spokenText}`,
    `The fuller picture comes into focus here. ${spokenText}`,
    `That story becomes clearer with one more detail. ${spokenText}`,
  ])
}

function buildArticleNarration(
  article: Article,
  content: ArticleContent | null,
  index: number,
  total: number,
  weatherContext: WeatherContext,
  includeIntro: boolean,
  includeTransition: boolean,
  currentVoiceName?: string,
  nextVoiceName?: string,
) {
  const seed = `${article.title}|${article.source || ""}|${article.category || ""}`
  const tone = getListenTone(article.category)
  const bodyParagraphs = (content?.paragraphs || [])
    .map((paragraph) => normalizeSpeechText(paragraph, 220))
    .filter((paragraph) => paragraph.length > 45)

  const lead = normalizeSpeechText(content?.subtitle || bodyParagraphs[0] || article.summary || article.title, 190)
  const paragraphs = (content?.paragraphs || [])
    .map((paragraph) => normalizeSpeechText(paragraph, 220))
    .filter(Boolean)

  const detail = bodyParagraphs.find((paragraph) => paragraph !== lead && paragraph.length > 85)
    || paragraphs.find((paragraph) => paragraph.length > 90)
    || normalizeSpeechText(article.keyPoints?.[0] || "", 170)
  const supporting = bodyParagraphs.find((paragraph) => paragraph !== lead && paragraph !== detail && paragraph.length > 75)
    || paragraphs.find((paragraph) => paragraph !== detail && paragraph.length > 70)
    || normalizeSpeechText(article.keyPoints?.[1] || "", 160)
  const contextDetail = bodyParagraphs.find((paragraph) => paragraph !== lead && paragraph !== detail && paragraph !== supporting && paragraph.length > 65)
    || normalizeSpeechText(article.summary || "", 170)
  const opening = pickVariant(`${seed}:opening`, tone.opening)
  const detailLead = pickVariant(`${seed}:detail`, tone.detail)
  const closing = pickVariant(`${seed}:closing`, [
    "That is the thread worth watching next.",
    "That is the angle to keep in mind going forward.",
    "That is why this update matters more than it first appears.",
    "That is the part that gives the story its weight.",
    ...tone.closing,
  ])
  const openingLine = buildOpeningLine(seed, opening, lead, article.title)
  const contextLine = contextDetail ? buildContextLine(seed, detailLead, contextDetail) : ""
  const bridgeLine = supporting ? buildBridgeLine(seed, supporting) : ""

  const lines = [
    includeIntro ? buildIntroLine(weatherContext) : "",
    openingLine,
    detail ? `${detailLead} ${toSentence(lowercaseLead(detail))}` : "",
    bridgeLine,
    contextLine,
    closing,
    includeTransition ? buildTransitionLine(seed, index === total - 1, currentVoiceName, nextVoiceName) : "",
  ].filter(Boolean)

  return clipText(lines.join(" "), tone.max)
}

export default function PodcastPlayer({ articles, startIdx = 0, mode = 'single', autoPlayToken = 0, onClose }: Props) {
  const [idx, setIdx] = useState(startIdx)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [expanded, setExpanded] = useState(true)
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 768 : false,
  )
  const [weatherContext, setWeatherContext] = useState<WeatherContext>(() => buildWeatherContext())
  const [weatherResolved, setWeatherResolved] = useState(false)
  const [weatherSource, setWeatherSource] = useState<'gps' | 'ip' | 'none'>('none')
  const [usingSpeechFallback, setUsingSpeechFallback] = useState(false)
  const [contentByLink, setContentByLink] = useState<Record<string, ArticleContent>>({})
  const [loadingByLink, setLoadingByLink] = useState<Record<string, boolean>>({})
  const [failedByLink, setFailedByLink] = useState<Record<string, boolean>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioStartTimerRef = useRef<number | null>(null)
  const playbackRequestIdRef = useRef(0)
  const pendingAutoPlayIdxRef = useRef<number | null>(null)
  const pendingContentRequestsRef = useRef<Record<string, Promise<ArticleContent | null>>>({})
  const audioUrlCacheRef = useRef<Record<string, string>>({})
  const pendingAudioUrlRef = useRef<Record<string, Promise<string | null>>>({})
  const sessionIdRef = useRef(createAudioSessionId("listen"))

  const current = articles[idx]
  const isQueueMode = mode === 'queue'
  const visibleCount = isQueueMode ? articles.length : (current ? 1 : 0)
  const shouldPreferBrowserSpeech = String(import.meta.env.VITE_PREFER_BROWSER_TTS || '').toLowerCase() === 'true'
  const currentContent = current?.link ? contentByLink[current.link] || null : null

  function buildVoiceForIndex(targetIndex: number) {
    const article = articles[targetIndex]
    if (!article) return null

    return pickSequentialTtsVoice(
      `${articles[startIdx]?.title || article.title}|${articles[startIdx]?.source || ""}|${startIdx}`,
      targetIndex - startIdx,
      "listen",
    )
  }

  function shouldAllowGreeting(targetIndex: number) {
    return isQueueMode && targetIndex === startIdx
  }

  function buildTtsRequestUrl(text: string, voiceId?: string, allowGreeting = false) {
    return apiUrl(
      "/api/tts?rewrite=1&mode=listen&allowGreeting=" + (allowGreeting ? "1" : "0") + "&text=" + encodeURIComponent(text.slice(0, 2000)) + (voiceId ? "&voice=" + encodeURIComponent(voiceId) : "")
    )
  }

  function buildAudioCacheKey(text: string, voiceId?: string, allowGreeting = false) {
    return `${voiceId || 'default'}::${allowGreeting ? 'greet' : 'plain'}::${text.slice(0, 2000)}`
  }

  async function ensureArticleContent(article?: Article | null) {
    if (!article?.link) return null
    if (contentByLink[article.link]) return contentByLink[article.link]
    if (pendingContentRequestsRef.current[article.link]) return pendingContentRequestsRef.current[article.link]

    setLoadingByLink((state) => ({ ...state, [article.link!]: true }))

    const request = fetch(apiUrl(`/api/article-content?link=${encodeURIComponent(article.link)}`))
      .then((response) => response.json())
      .then((content: ArticleContent) => {
        setContentByLink((state) => ({ ...state, [article.link!]: content }))
        return content
      })
      .catch(() => {
        setFailedByLink((state) => ({ ...state, [article.link!]: true }))
        return null
      })
      .finally(() => {
        delete pendingContentRequestsRef.current[article.link!]
        setLoadingByLink((state) => ({ ...state, [article.link!]: false }))
      })

    pendingContentRequestsRef.current[article.link] = request
    return request
  }

  async function preloadAudio(text: string, voiceId?: string, allowGreeting = false) {
    if (shouldPreferBrowserSpeech || !text.trim()) return null

    const cacheKey = buildAudioCacheKey(text, voiceId, allowGreeting)
    if (audioUrlCacheRef.current[cacheKey]) return audioUrlCacheRef.current[cacheKey]
    if (pendingAudioUrlRef.current[cacheKey]) return pendingAudioUrlRef.current[cacheKey]

    pendingAudioUrlRef.current[cacheKey] = fetch(buildTtsRequestUrl(text, voiceId, allowGreeting))
      .then(async (response) => {
        if (!response.ok) return null
        const audioBlob = await response.blob()
        const objectUrl = URL.createObjectURL(audioBlob)
        audioUrlCacheRef.current[cacheKey] = objectUrl
        return objectUrl
      })
      .catch(() => null)
      .finally(() => {
        delete pendingAudioUrlRef.current[cacheKey]
      })

    return pendingAudioUrlRef.current[cacheKey]
  }
  useEffect(() => {
    let cancelled = false
    const weatherTimeoutId = window.setTimeout(() => {
      if (cancelled) return
      setWeatherContext((current) => current.weatherLine ? current : buildWeatherContext())
      setWeatherSource('none')
      setWeatherResolved(true)
    }, WEATHER_RESOLVE_TIMEOUT_MS)

    async function applyIpFallback() {
      try {
        const nextWeather = await fetchWeatherFromIp()
        if (!cancelled) {
          setWeatherContext(nextWeather.context)
          setWeatherSource(nextWeather.source)
          setWeatherResolved(true)
        }
      } catch {
        if (!cancelled) {
          setWeatherContext(buildWeatherContext())
          setWeatherSource('none')
          setWeatherResolved(true)
        }
      }
    }

    if (!navigator.geolocation) {
      void applyIpFallback()
      return
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          let city = ""

          try {
            const reverseResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${coords.latitude}&longitude=${coords.longitude}&language=en&format=json`)
            if (reverseResponse.ok) {
              const reverseData = await reverseResponse.json()
              city = reverseData?.results?.[0]?.city || reverseData?.results?.[0]?.name || ""
            }
          } catch {
            city = ""
          }

          const nextContext = await fetchWeatherForCoordinates(coords.latitude, coords.longitude, city)

          if (!cancelled) {
            setWeatherContext(nextContext)
            setWeatherSource('gps')
            setWeatherResolved(true)
          }
        } catch {
          void applyIpFallback()
        }
      },
      () => {
        void applyIpFallback()
      },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 10 * 60 * 1000 },
    )

    return () => {
      cancelled = true
      window.clearTimeout(weatherTimeoutId)
    }
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return

    const updateViewport = () => {
      setIsMobileViewport(window.innerWidth <= 768)
    }

    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [])

  useEffect(() => {
    setExpanded(true)
    setIdx(startIdx)
    setProgress(0)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    pendingAutoPlayIdxRef.current = startIdx
    setPlaying(true)
  }, [startIdx, autoPlayToken])

  useEffect(() => {
    void ensureArticleContent(current)
  }, [current?.link])

  const currentVoice = useMemo(() => {
    if (!current) return null
    return pickSequentialTtsVoice(
      `${articles[startIdx]?.title || current.title}|${articles[startIdx]?.source || ""}|${startIdx}`,
      idx - startIdx,
      "listen",
    )
  }, [articles, current, idx, startIdx])
  const nextVoice = useMemo(() => {
    if (!isQueueMode || !current || idx >= articles.length - 1) return null
    return pickSequentialTtsVoice(
      `${articles[startIdx]?.title || current.title}|${articles[startIdx]?.source || ""}|${startIdx}`,
      idx + 1 - startIdx,
      "listen",
    )
  }, [articles, current, idx, isQueueMode, startIdx])
  const script = current
    ? buildArticleNarration(
        current,
        currentContent,
        idx,
        isQueueMode ? articles.length : 1,
        weatherContext,
        isQueueMode && idx === startIdx,
        isQueueMode,
        currentVoice?.label,
        nextVoice?.label,
      )
    : ""

  useEffect(() => {
    return () => {
      Object.values(audioUrlCacheRef.current).forEach((url) => {
        URL.revokeObjectURL(url)
      })
      audioUrlCacheRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (shouldPreferBrowserSpeech) return
    if (!current || !script.trim()) return
    if (isQueueMode && idx === startIdx && !weatherResolved) return

    void preloadAudio(script, currentVoice?.id, shouldAllowGreeting(idx))
  }, [current?.link, currentVoice?.id, idx, isQueueMode, script, shouldPreferBrowserSpeech, startIdx, weatherResolved])

  useEffect(() => {
    if (!isQueueMode || shouldPreferBrowserSpeech) return

    const nextIndex = idx + 1
    const nextArticle = articles[nextIndex]
    if (!nextArticle) return

    let cancelled = false

    void ensureArticleContent(nextArticle).then((nextContent) => {
      if (cancelled) return

      const nextCurrentVoice = buildVoiceForIndex(nextIndex)
      const nextFollowingVoice = buildVoiceForIndex(nextIndex + 1)
      const nextScript = buildArticleNarration(
        nextArticle,
        nextContent,
        nextIndex,
        articles.length,
        weatherContext,
        false,
        true,
        nextCurrentVoice?.label,
        nextFollowingVoice?.label,
      )

      void preloadAudio(nextScript, nextCurrentVoice?.id, shouldAllowGreeting(nextIndex))
    })

    return () => {
      cancelled = true
    }
  }, [articles, idx, isQueueMode, shouldPreferBrowserSpeech, startIdx, weatherContext])

  useEffect(() => {
    if (!playing) return
    if (pendingAutoPlayIdxRef.current !== null && pendingAutoPlayIdxRef.current !== idx) return
    if (isQueueMode && idx === startIdx && !weatherResolved) return
    pendingAutoPlayIdxRef.current = null
    doPlay()
  }, [idx, playing, autoPlayToken, startIdx, weatherResolved, isQueueMode])

  useEffect(() => subscribeExclusiveAudio(sessionIdRef.current, () => {
    playbackRequestIdRef.current += 1
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setPlaying(false)
    setUsingSpeechFallback(false)
  }), [])

  if (!current) return null

  function doStop() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setPlaying(false)
    setUsingSpeechFallback(false)
  }

  function advanceToNextStory() {
    setProgress(100)
    if (isQueueMode && idx < articles.length - 1) {
      pendingAutoPlayIdxRef.current = idx + 1
      setIdx((value) => value + 1)
    } else {
      setPlaying(false)
      setUsingSpeechFallback(false)
    }
  }

  function playWithSpeechFallback() {
    if (!('speechSynthesis' in window) || !script.trim()) {
      setPlaying(false)
      setUsingSpeechFallback(false)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(script)
    const availableVoices = window.speechSynthesis.getVoices()
    const englishVoice = availableVoices.find((voice) => /en-/i.test(voice.lang)) || availableVoices[0]
    if (englishVoice) utterance.voice = englishVoice
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onend = () => {
      advanceToNextStory()
    }
    utterance.onerror = () => {
      setPlaying(false)
      setUsingSpeechFallback(false)
    }

    setUsingSpeechFallback(true)
    setPlaying(true)
    setProgress(12)
    window.speechSynthesis.speak(utterance)
  }

  function doPlay() {
    if (shouldPreferBrowserSpeech) {
      requestExclusiveAudio({ ownerId: sessionIdRef.current, source: "listen" })
      playWithSpeechFallback()
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    requestExclusiveAudio({ ownerId: sessionIdRef.current, source: "listen" })
    setPlaying(true)
    setUsingSpeechFallback(false)
    setProgress(0)
    const playbackRequestId = playbackRequestIdRef.current + 1
    playbackRequestIdRef.current = playbackRequestId
    const fallbackToSpeech = () => {
      if (playbackRequestIdRef.current !== playbackRequestId) return
      playWithSpeechFallback()
    }
    const allowGreeting = shouldAllowGreeting(idx)
    const requestUrl = buildTtsRequestUrl(script, currentVoice?.id, allowGreeting)
    const cacheKey = buildAudioCacheKey(script, currentVoice?.id, allowGreeting)

    const startAudio = (sourceUrl: string) => {
      if (playbackRequestIdRef.current !== playbackRequestId) return

      const audio = new Audio(sourceUrl)
      audioRef.current = audio
      audio.oncanplay = () => {
        if (audioStartTimerRef.current !== null) {
          window.clearTimeout(audioStartTimerRef.current)
          audioStartTimerRef.current = null
        }
      }
      audio.onended = () => {
        advanceToNextStory()
      }
      audio.ontimeupdate = () => {
        if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100)
      }
      audio.onerror = () => {
        fallbackToSpeech()
      }
      audioStartTimerRef.current = window.setTimeout(() => {
        fallbackToSpeech()
      }, AUDIO_START_TIMEOUT_MS)
      audio.play().catch(() => fallbackToSpeech())
    }

    const cachedAudioUrl = audioUrlCacheRef.current[cacheKey]
    if (cachedAudioUrl) {
      startAudio(cachedAudioUrl)
      return
    }

    audioStartTimerRef.current = window.setTimeout(() => {
      fallbackToSpeech()
    }, AUDIO_START_TIMEOUT_MS)

    void (pendingAudioUrlRef.current[cacheKey] || preloadAudio(script, currentVoice?.id, allowGreeting))
      .then((preloadedUrl) => {
        if (audioStartTimerRef.current !== null) {
          window.clearTimeout(audioStartTimerRef.current)
          audioStartTimerRef.current = null
        }
        startAudio(preloadedUrl || requestUrl)
      })
      .catch(() => {
        fallbackToSpeech()
      })
  }

  function togglePlay() {
    if (playing) {
      doStop()
      return
    }

    pendingAutoPlayIdxRef.current = null
    doPlay()
  }

  function next() {
    if (!isQueueMode) return
    doStop()
    setProgress(0)
    if (idx < articles.length - 1) setIdx((value) => value + 1)
  }

  function prev() {
    if (!isQueueMode) return
    doStop()
    setProgress(0)
    if (idx > 0) setIdx((value) => value - 1)
  }

  const panelBg = "#f7f1eb"
  const panelBorder = "rgba(26,26,26,0.12)"
  const panelText = "#1a1a1a"
  const panelMuted = "rgba(26,26,26,0.5)"
  const panelSoft = "rgba(26,26,26,0.08)"
  const accent = "#b8472a"
  const collapsedStyle: CSSProperties = isMobileViewport
    ? {
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        width: 60,
        height: 60,
        borderRadius: "50%",
      }
    : {
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        width: 60,
        height: 60,
        borderRadius: "50%",
      }
  const panelStyle: CSSProperties = isMobileViewport
    ? {
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        width: "min(320px, calc(100vw - 24px))",
        borderRadius: 20,
        background: panelBg,
        color: panelText,
        padding: "16px 20px",
        border: `1px solid ${panelBorder}`,
        boxShadow: "0 16px 40px rgba(76,51,39,0.16)",
        fontFamily: "Outfit,sans-serif",
        backdropFilter: "blur(10px)",
      }
    : {
        position: "fixed",
        bottom: 20,
        right: 20,
        zIndex: 9999,
        width: 320,
        borderRadius: 20,
        background: panelBg,
        color: panelText,
        padding: "16px 20px",
        border: `1px solid ${panelBorder}`,
        boxShadow: "0 16px 40px rgba(76,51,39,0.16)",
        fontFamily: "Outfit,sans-serif",
        backdropFilter: "blur(10px)",
      }
  const mb: CSSProperties = { background: "none", border: "none", color: panelMuted, cursor: "pointer", fontSize: 14, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }
  const cb: CSSProperties = { background: panelSoft, border: `1px solid ${panelBorder}`, color: panelText, width: 36, height: 36, borderRadius: "50%", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }

  if (!expanded) {
    return (
      <div onClick={() => setExpanded(true)} style={{
        ...collapsedStyle,
        background: playing ? "linear-gradient(135deg,#c85738,#a63f24)" : panelBg,
        border: `1px solid ${playing ? "rgba(184,71,42,0.35)" : panelBorder}`,
        color: playing ? "#fff" : panelText, display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", boxShadow: "0 10px 28px rgba(76,51,39,0.16)", fontSize: 14, fontWeight: 600
      }}>
        {playing ? "ON" : "TTS"}
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: panelMuted, textTransform: "uppercase", letterSpacing: 2 }}>NewsFlow Radio</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setExpanded(false)} style={mb}><Minus size={14} /></button>
          <button onClick={() => { doStop(); onClose() }} style={mb}><X size={14} /></button>
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.title}</div>
      <div style={{ fontSize: 11, color: panelMuted, marginBottom: 10 }}>{isQueueMode ? `${idx + 1} / ${articles.length}` : `1 / ${visibleCount || 1}`}</div>
      <div style={{ height: 4, background: panelSoft, borderRadius: 999, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ height: "100%", width: progress + "%", background: accent, borderRadius: 999, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, alignItems: "center" }}>
        <button onClick={prev} style={{ ...cb, opacity: isQueueMode ? 1 : 0.4, cursor: isQueueMode ? 'pointer' : 'default' }}><SkipBack size={16} /></button>
        <button onClick={togglePlay} style={{ ...cb, width: 44, height: 44, fontSize: 14, background: accent, color: "#fff", border: "none", boxShadow: "0 8px 20px rgba(184,71,42,0.28)" }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button onClick={next} style={{ ...cb, opacity: isQueueMode ? 1 : 0.4, cursor: isQueueMode ? 'pointer' : 'default' }}><SkipForward size={16} /></button>
      </div>
    </div>
  )
}