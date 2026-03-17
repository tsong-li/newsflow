import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { SkipBack, Play, Pause, SkipForward, Minus, X, Headphones, AudioLines, Timer, ChevronDown } from "lucide-react"
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
const SPEECH_WORD_MS = 420
const TIMER_PRESETS = [5, 15, 20, 30, 45, 60] as const
const TTS_CHARS_PER_MINUTE = 900
const COMFORTABLE_CHAR_FLOOR = 650
const TIGHT_CHAR_FLOOR = 430
const TIMER_OPTION_COPY: Record<string, { title: string; note: string }> = {
  full: { title: "Full edit", note: "Sunday paper energy" },
  "5": { title: "5 min", note: "Mercifully brief" },
  "15": { title: "15 min", note: "A crisp little brief" },
  "20": { title: "20 min", note: "Lean, with plot" },
  "30": { title: "30 min", note: "The well-cut edition" },
  "45": { title: "45 min", note: "A generous telling" },
  "60": { title: "60 min", note: "Positively novelistic" },
}

function getTimerOptionCopy(minutes: number | null) {
  return TIMER_OPTION_COPY[minutes === null ? "full" : String(minutes)] || { title: `${minutes} min`, note: "Well paced" }
}

function calcCharBudget(totalMinutes: number, articleCount: number): number {
  if (articleCount <= 0) return 2000
  const perArticle = Math.floor((totalMinutes * TTS_CHARS_PER_MINUTE) / Math.max(1, articleCount))
  return Math.max(200, Math.min(2000, perArticle))
}

function calcAdaptiveCharBudget(totalMinutes: number, elapsedMs: number, remainingArticles: number, completedArticles: number) {
  if (remainingArticles <= 0) return 2000

  const totalMs = totalMinutes * 60 * 1000
  const remainingMs = Math.max(30_000, totalMs - elapsedMs)
  const remainingMinutes = remainingMs / 60_000
  const rawPerArticle = calcCharBudget(remainingMinutes, remainingArticles)
  const remainingCapacity = Math.floor(remainingMinutes * TTS_CHARS_PER_MINUTE)
  let adjusted = rawPerArticle

  if (remainingCapacity < remainingArticles * COMFORTABLE_CHAR_FLOOR) {
    adjusted = Math.floor(adjusted * 0.86)
  }

  if (remainingCapacity < remainingArticles * TIGHT_CHAR_FLOOR) {
    adjusted = Math.floor(adjusted * 0.72)
  }

  if (completedArticles > 0) {
    const idealElapsedMs = totalMs * (completedArticles / (completedArticles + remainingArticles))
    if (elapsedMs > idealElapsedMs * 1.08) {
      adjusted = Math.floor(adjusted * 0.84)
    }
  }

  return Math.max(200, Math.min(1800, adjusted))
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

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

function formatPlaybackTime(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function estimateSpeechDurationMs(text: string) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length
  return Math.max(4000, words * SPEECH_WORD_MS)
}

function sliceSpeechFromProgress(text: string, progressRatio: number) {
  const value = String(text || "").trim()
  if (!value) return ""

  const normalizedRatio = Math.max(0, Math.min(0.98, progressRatio))
  if (normalizedRatio <= 0) return value

  const words = value.split(/\s+/).filter(Boolean)
  if (!words.length) return value

  const targetIndex = Math.min(words.length - 1, Math.floor(words.length * normalizedRatio))
  const sliced = words.slice(targetIndex).join(" ")
  const sentenceStartMatch = sliced.match(/[^.!?]*[.!?]\s+(.*)$/)
  return (sentenceStartMatch?.[1] || sliced).trim() || sliced.trim() || value
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
  charBudget?: number,
) {
  const seed = `${article.title}|${article.source || ""}|${article.category || ""}`
  const tone = getListenTone(article.category)
  const maxChars = charBudget || tone.max
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

  const effectiveIntro = includeIntro && maxChars >= 700
  const effectiveTransition = includeTransition && maxChars >= 350

  const lines: string[] = []
  if (effectiveIntro) lines.push(buildIntroLine(weatherContext))
  lines.push(openingLine)
  if (maxChars >= 350 && detail) lines.push(`${detailLead} ${toSentence(lowercaseLead(detail))}`)
  if (maxChars >= 700) { if (bridgeLine) lines.push(bridgeLine) }
  if (maxChars >= 1200) { if (contextLine) lines.push(contextLine) }
  if (maxChars >= 1500) lines.push(closing)
  if (effectiveTransition) lines.push(buildTransitionLine(seed, index === total - 1, currentVoiceName, nextVoiceName))

  return clipText(lines.filter(Boolean).join(" "), maxChars)
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
  const [audioDurationMs, setAudioDurationMs] = useState(0)
  const [contentByLink, setContentByLink] = useState<Record<string, ArticleContent>>({})
  const [loadingByLink, setLoadingByLink] = useState<Record<string, boolean>>({})
  const [failedByLink, setFailedByLink] = useState<Record<string, boolean>>({})
  const [showTimerOptions, setShowTimerOptions] = useState(false)
  const [timerMinutes, setTimerMinutes] = useState<number | null>(null)
  const [timerElapsedMs, setTimerElapsedMs] = useState(0)
  const [activeCharBudget, setActiveCharBudget] = useState<number | undefined>(undefined)
  const [handoffCue, setHandoffCue] = useState<{ targetIdx: number; text: string } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioStartTimerRef = useRef<number | null>(null)
  const speechProgressTimerRef = useRef<number | null>(null)
  const playbackRequestIdRef = useRef(0)
  const pendingAutoPlayIdxRef = useRef<number | null>(null)
  const pendingContentRequestsRef = useRef<Record<string, Promise<ArticleContent | null>>>({})
  const audioUrlCacheRef = useRef<Record<string, string>>({})
  const pendingAudioUrlRef = useRef<Record<string, Promise<string | null>>>({})
  const resumeProgressRef = useRef(0)
  const timerTickRef = useRef(0)
  const pendingTimerSwitchRef = useRef<{ targetIdx: number; startRatio: number } | null>(null)
  const sessionIdRef = useRef(createAudioSessionId("listen"))

  const current = articles[idx]
  const isQueueMode = mode === 'queue'
  const visibleCount = isQueueMode ? articles.length : (current ? 1 : 0)
  const shouldPreferBrowserSpeech = String(import.meta.env.VITE_PREFER_BROWSER_TTS || '').toLowerCase() === 'true'
  const currentContent = current?.link ? contentByLink[current.link] || null : null
  const remainingArticles = isQueueMode ? Math.max(1, articles.length - idx) : 1
  const completedArticles = isQueueMode ? Math.max(0, idx - startIdx) : 0
  const charBudget = activeCharBudget

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

  function buildTtsRequestUrl(text: string, voiceId?: string, allowGreeting = false, maxChars?: number) {
    let url = "/api/tts?rewrite=0&mode=listen&allowGreeting=" + (allowGreeting ? "1" : "0") + "&text=" + encodeURIComponent(text.slice(0, 2000)) + (voiceId ? "&voice=" + encodeURIComponent(voiceId) : "")
    if (maxChars) url += "&maxChars=" + maxChars
    return apiUrl(url)
  }

  function buildAudioCacheKey(text: string, voiceId?: string, allowGreeting = false, maxChars?: number) {
    return `${voiceId || 'default'}::${allowGreeting ? 'greet' : 'plain'}::${maxChars || 'full'}::${text.slice(0, 2000)}`
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

  async function preloadAudio(text: string, voiceId?: string, allowGreeting = false, maxChars?: number) {
    if (shouldPreferBrowserSpeech || !text.trim()) return null

    const cacheKey = buildAudioCacheKey(text, voiceId, allowGreeting, maxChars)
    if (audioUrlCacheRef.current[cacheKey]) return audioUrlCacheRef.current[cacheKey]
    if (pendingAudioUrlRef.current[cacheKey]) return pendingAudioUrlRef.current[cacheKey]

    pendingAudioUrlRef.current[cacheKey] = fetch(buildTtsRequestUrl(text, voiceId, allowGreeting, maxChars))
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
    resumeProgressRef.current = 0
    setAudioDurationMs(0)
    setUsingSpeechFallback(false)
    setExpanded(true)
    setShowTimerOptions(false)
    setIdx(startIdx)
    setProgress(0)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setTimerMinutes(null)
    setTimerElapsedMs(0)
    setActiveCharBudget(undefined)
    setHandoffCue(null)
    pendingAutoPlayIdxRef.current = startIdx
    setPlaying(true)
  }, [startIdx, autoPlayToken])

  useEffect(() => {
    if (!timerMinutes) {
      setActiveCharBudget(undefined)
      return
    }

    setActiveCharBudget(
      calcAdaptiveCharBudget(timerMinutes, timerElapsedMs, remainingArticles, completedArticles),
    )
  }, [completedArticles, idx, remainingArticles, timerMinutes])

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
        charBudget,
      )
    : ""
  const activeHandoffCue = handoffCue?.targetIdx === idx ? handoffCue.text : ""
  const playbackScript = [activeHandoffCue, script].filter(Boolean).join(" ").trim()

  useEffect(() => {
    return () => {
      if (speechProgressTimerRef.current !== null) {
        window.clearInterval(speechProgressTimerRef.current)
        speechProgressTimerRef.current = null
      }
      Object.values(audioUrlCacheRef.current).forEach((url) => {
        URL.revokeObjectURL(url)
      })
      audioUrlCacheRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (shouldPreferBrowserSpeech) return
    if (!current || !playbackScript.trim()) return
    if (isQueueMode && idx === startIdx && !weatherResolved) return

    void preloadAudio(playbackScript, currentVoice?.id, shouldAllowGreeting(idx), charBudget)
  }, [charBudget, current?.link, currentVoice?.id, idx, isQueueMode, playbackScript, shouldPreferBrowserSpeech, startIdx, weatherResolved])

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
        charBudget,
      )

      void preloadAudio(nextScript, nextCurrentVoice?.id, shouldAllowGreeting(nextIndex), charBudget)
    })

    return () => {
      cancelled = true
    }
  }, [articles, charBudget, idx, isQueueMode, shouldPreferBrowserSpeech, startIdx, weatherContext])

  useEffect(() => {
    const pendingSwitch = pendingTimerSwitchRef.current
    if (!pendingSwitch) return
    if (pendingSwitch.targetIdx !== idx) return
    if (isQueueMode && idx === startIdx && !weatherResolved) return

    pendingTimerSwitchRef.current = null
    doPlay(pendingSwitch.startRatio)
  }, [idx, startIdx, timerMinutes, weatherResolved, isQueueMode])

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
    if (speechProgressTimerRef.current !== null) {
      window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setPlaying(false)
    setUsingSpeechFallback(false)
  }), [])

  useEffect(() => {
    if (!timerMinutes || !playing) {
      timerTickRef.current = 0
      return
    }
    timerTickRef.current = Date.now()
    const id = window.setInterval(() => {
      const now = Date.now()
      const delta = now - timerTickRef.current
      timerTickRef.current = now
      setTimerElapsedMs(prev => prev + delta)
    }, 1000)
    return () => window.clearInterval(id)
  }, [timerMinutes, playing])

  const timerRemainingMs = timerMinutes ? Math.max(0, timerMinutes * 60 * 1000 - timerElapsedMs) : 0

  function applyTimerSelection(minutes: number | null) {
    const currentRatio = Math.max(0, Math.min(1, resumeProgressRef.current || (progress / 100)))
    const shouldResume = playing
    const shouldSkipCurrent = isQueueMode && currentRatio > 0.5 && idx < articles.length - 1

    doStop()
    setAudioDurationMs(0)
    setTimerMinutes(minutes)
    setShowTimerOptions(false)

    if (shouldSkipCurrent) {
      const targetIdx = idx + 1
      const cueText = buildTransitionLine(
        `${current.title}|${current.source || ""}|${current.category || ""}`,
        false,
        currentVoice?.label,
        nextVoice?.label,
      )

      setHandoffCue({ targetIdx, text: cueText })
      setProgress(0)
      resumeProgressRef.current = 0
      pendingAutoPlayIdxRef.current = targetIdx
      if (shouldResume) {
        pendingTimerSwitchRef.current = { targetIdx, startRatio: 0 }
      }
      setIdx(targetIdx)
      return
    }

    setHandoffCue(null)
    setProgress(Math.max(0, Math.min(100, currentRatio * 100)))
    resumeProgressRef.current = currentRatio
    if (shouldResume) {
      pendingTimerSwitchRef.current = { targetIdx: idx, startRatio: currentRatio }
    }
  }

  if (!current) return null

  const displayedDurationMs = audioDurationMs || estimateSpeechDurationMs(script)
  const displayedElapsedMs = Math.round((Math.max(0, Math.min(progress, 100)) / 100) * displayedDurationMs)

  function doStop() {
    resumeProgressRef.current = Math.max(0, Math.min(1, progress / 100))
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioStartTimerRef.current !== null) {
      window.clearTimeout(audioStartTimerRef.current)
      audioStartTimerRef.current = null
    }
    if (speechProgressTimerRef.current !== null) {
      window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
    setPlaying(false)
    setUsingSpeechFallback(false)
  }

  function advanceToNextStory() {
    setProgress(100)
    resumeProgressRef.current = 0
    setAudioDurationMs(0)
    if (isQueueMode && idx < articles.length - 1) {
      pendingAutoPlayIdxRef.current = idx + 1
      setIdx((value) => value + 1)
    } else {
      setPlaying(false)
      setUsingSpeechFallback(false)
    }
  }

  function playWithSpeechFallback(startRatio = resumeProgressRef.current) {
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
    if (speechProgressTimerRef.current !== null) {
      window.clearInterval(speechProgressTimerRef.current)
      speechProgressTimerRef.current = null
    }

    window.speechSynthesis.cancel()

    const boundedRatio = Math.max(0, Math.min(0.98, startRatio))
    const totalDurationMs = estimateSpeechDurationMs(playbackScript)
    const remainingDurationMs = Math.max(1200, Math.round(totalDurationMs * (1 - boundedRatio)))
    const spokenText = sliceSpeechFromProgress(playbackScript, boundedRatio)
    if (!spokenText) {
      advanceToNextStory()
      return
    }

    const utterance = new SpeechSynthesisUtterance(spokenText)
    const availableVoices = window.speechSynthesis.getVoices()
    const englishVoice = availableVoices.find((voice) => /en-/i.test(voice.lang)) || availableVoices[0]
    if (englishVoice) utterance.voice = englishVoice
    utterance.rate = 1
    utterance.pitch = 1
    setAudioDurationMs(totalDurationMs)
    setProgress(boundedRatio * 100)
    resumeProgressRef.current = boundedRatio

    const startedAt = performance.now()
    speechProgressTimerRef.current = window.setInterval(() => {
      const elapsedRatio = Math.min(1, (performance.now() - startedAt) / remainingDurationMs)
      const nextRatio = boundedRatio + ((1 - boundedRatio) * elapsedRatio)
      setProgress(nextRatio * 100)
      resumeProgressRef.current = nextRatio
    }, 120)

    utterance.onend = () => {
      if (speechProgressTimerRef.current !== null) {
        window.clearInterval(speechProgressTimerRef.current)
        speechProgressTimerRef.current = null
      }
      advanceToNextStory()
    }
    utterance.onerror = () => {
      if (speechProgressTimerRef.current !== null) {
        window.clearInterval(speechProgressTimerRef.current)
        speechProgressTimerRef.current = null
      }
      setPlaying(false)
      setUsingSpeechFallback(false)
    }

    setUsingSpeechFallback(true)
    setPlaying(true)
    setProgress(12)
    window.speechSynthesis.speak(utterance)
  }

  function doPlay(startRatio = resumeProgressRef.current) {
    const boundedRatio = Math.max(0, Math.min(0.98, startRatio))
    if (shouldPreferBrowserSpeech) {
      requestExclusiveAudio({ ownerId: sessionIdRef.current, source: "listen" })
      playWithSpeechFallback(boundedRatio)
      return
    }

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    requestExclusiveAudio({ ownerId: sessionIdRef.current, source: "listen" })
    setPlaying(true)
    setUsingSpeechFallback(false)
    setProgress(boundedRatio * 100)
    const playbackRequestId = playbackRequestIdRef.current + 1
    playbackRequestIdRef.current = playbackRequestId
    const fallbackToSpeech = () => {
      if (playbackRequestIdRef.current !== playbackRequestId) return
      playWithSpeechFallback(boundedRatio)
    }
    const allowGreeting = shouldAllowGreeting(idx)
    const requestUrl = buildTtsRequestUrl(playbackScript, currentVoice?.id, allowGreeting, charBudget)
    const cacheKey = buildAudioCacheKey(playbackScript, currentVoice?.id, allowGreeting, charBudget)

    const startAudio = (sourceUrl: string) => {
      if (playbackRequestIdRef.current !== playbackRequestId) return

      const audio = new Audio(sourceUrl)
      audioRef.current = audio
      audio.preload = "auto"
      audio.onloadedmetadata = () => {
        if (!audio.duration || !Number.isFinite(audio.duration)) return
        setAudioDurationMs(Math.round(audio.duration * 1000))
        if (boundedRatio > 0) {
          audio.currentTime = audio.duration * boundedRatio
        }
      }
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
        if (audio.duration) {
          const nextProgress = (audio.currentTime / audio.duration) * 100
          setProgress(nextProgress)
          resumeProgressRef.current = Math.max(0, Math.min(1, nextProgress / 100))
        }
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

    void (pendingAudioUrlRef.current[cacheKey] || preloadAudio(playbackScript, currentVoice?.id, allowGreeting, charBudget))
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
    doPlay(resumeProgressRef.current)
  }

  function seekToProgress(nextProgress: number) {
    const clampedProgress = Math.max(0, Math.min(100, nextProgress))
    const nextRatio = clampedProgress / 100
    setProgress(clampedProgress)
    resumeProgressRef.current = nextRatio

    if (usingSpeechFallback || shouldPreferBrowserSpeech) {
      if (playing) {
        playWithSpeechFallback(nextRatio)
      }
      return
    }

    if (audioRef.current?.duration && Number.isFinite(audioRef.current.duration)) {
      audioRef.current.currentTime = audioRef.current.duration * nextRatio
      return
    }

    if (playing) {
      doPlay(nextRatio)
    }
  }

  function next() {
    if (!isQueueMode) return
    doStop()
    resumeProgressRef.current = 0
    setAudioDurationMs(0)
    setProgress(0)
    if (idx < articles.length - 1) setIdx((value) => value + 1)
  }

  function prev() {
    if (!isQueueMode) return
    doStop()
    resumeProgressRef.current = 0
    setAudioDurationMs(0)
    setProgress(0)
    if (idx > 0) setIdx((value) => value - 1)
  }

  const panelBg = "#f7f1eb"
  const panelBorder = "rgba(26,26,26,0.12)"
  const panelText = "#1a1a1a"
  const panelMuted = "rgba(26,26,26,0.5)"
  const panelSoft = "rgba(26,26,26,0.08)"
  const accent = "#b8472a"
  const primaryButtonStart = "#e74c3c"
  const primaryButtonEnd = "#c0392b"
  const primaryButtonBackground = "linear-gradient(135deg,#e74c3c,#c0392b)"
  const primaryButtonShadow = "0 8px 20px rgba(192,57,43,0.28)"
  const collapsedStyle: CSSProperties = isMobileViewport
    ? {
        position: "fixed",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
        right: "calc(env(safe-area-inset-right, 0px) + 18px)",
        zIndex: 9999,
        width: 60,
        height: 60,
        borderRadius: "50%",
      }
    : {
        position: "fixed",
        bottom: 28,
        right: 28,
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
        width: "min(420px, calc(100vw - 40px))",
        maxWidth: "calc(100vw - 40px)",
        boxSizing: "border-box",
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

  function replayFromStart() {
    doStop()
    resumeProgressRef.current = 0
    setAudioDurationMs(0)
    setProgress(0)

    if (isQueueMode) {
      pendingAutoPlayIdxRef.current = startIdx
      setIdx(startIdx)
      setPlaying(true)
      return
    }

    pendingAutoPlayIdxRef.current = null
    setPlaying(true)
  }

  const isPausedWithResume = !playing && progress > 0 && progress < 100

  function handleCollapsedClick() {
    if (playing) {
      setExpanded(true)
      return
    }

    if (isPausedWithResume) {
      setExpanded(true)
      pendingAutoPlayIdxRef.current = null
      doPlay(resumeProgressRef.current)
      return
    }

    replayFromStart()
  }

  if (!expanded) {
    return (
      <div onClick={handleCollapsedClick} style={{
        ...collapsedStyle,
        background: primaryButtonBackground,
        border: "1px solid rgba(184,71,42,0.35)",
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", boxShadow: playing ? "0 12px 30px rgba(192,57,43,0.28)" : "0 10px 28px rgba(192,57,43,0.22)", fontSize: 14, fontWeight: 600
      }}>
        {playing ? (
          <AudioLines size={22} strokeWidth={2.1} className="podcast-floating-icon podcast-floating-icon-playing" />
        ) : isPausedWithResume ? (
          <Play size={22} strokeWidth={2.1} className="podcast-floating-icon" />
        ) : (
          <Headphones size={22} strokeWidth={2.1} className="podcast-floating-icon" />
        )}
      </div>
    )
  }

  return (
    <>
      {isQueueMode && isMobileViewport && showTimerOptions ? (
        <div className="timer-sheet-overlay" onClick={() => setShowTimerOptions(false)}>
          <div className="timer-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="timer-sheet-handle" />
            <div className="timer-sheet-title">Listen duration</div>
            <div className="timer-sheet-list" role="listbox" aria-label="Listen duration options">
              {[null, ...TIMER_PRESETS].map((minutes) => {
                const meta = getTimerOptionCopy(minutes)

                return (
                  <button
                    key={minutes === null ? "full" : minutes}
                    className={`timer-sheet-option${timerMinutes === minutes ? " active" : ""}`}
                    onClick={() => applyTimerSelection(minutes)}
                  >
                    <span className="timer-option-main">{meta.title}</span>
                    <span className="timer-option-note">{meta.note}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
      <div style={panelStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: panelMuted, textTransform: "uppercase", letterSpacing: 2 }}>NewsFlow Radio</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setExpanded(false)} style={mb}><Minus size={14} /></button>
          <button onClick={() => { doStop(); onClose() }} style={mb}><X size={14} /></button>
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.title}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: panelMuted, marginBottom: 10 }}>
        <span>{isQueueMode ? `${idx + 1} / ${articles.length}` : `1 / ${visibleCount || 1}`}</span>
        {isQueueMode ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="timer-trigger"
              onClick={() => setShowTimerOptions((value) => !value)}
              style={{
                ...mb,
                minWidth: 92,
                minHeight: 30,
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid transparent",
                background: showTimerOptions ? "rgba(26,26,26,0.05)" : "transparent",
                gap: 6,
                justifyContent: "space-between",
                color: panelMuted,
              }}
              aria-label="Adjust listen duration"
            >
              <Timer size={11} strokeWidth={2} style={{ opacity: 0.82 }} />
              <span className="timer-pill-value" style={{ fontSize: 10, color: showTimerOptions ? panelText : panelMuted }}>
                {timerMinutes ? formatCountdown(timerRemainingMs) : "Full edit"}
              </span>
              <ChevronDown size={12} strokeWidth={2} style={{ color: showTimerOptions ? panelText : panelMuted, opacity: 0.75 }} />
            </button>
          </div>
        ) : <span />}
      </div>
      {isQueueMode && showTimerOptions && !isMobileViewport ? (
        <div className="timer-dropdown" style={{ marginBottom: 12 }}>
          {[null, ...TIMER_PRESETS].map((minutes) => {
            const meta = getTimerOptionCopy(minutes)

            return (
              <button
                key={minutes === null ? "full" : minutes}
                className={`timer-dropdown-item${timerMinutes === minutes ? " active" : ""}`}
                onClick={() => applyTimerSelection(minutes)}
              >
                <span className="timer-option-main">{meta.title}</span>
                <span className="timer-option-note">{meta.note}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <input
          className="podcast-progress-slider"
          type="range"
          min={0}
          max={100}
          step={0.1}
          value={progress}
          onChange={(event) => seekToProgress(Number(event.target.value))}
          aria-label="Seek playback"
          style={{ ["--progress" as string]: `${progress}%`, ["--accent-start" as string]: primaryButtonStart, ["--accent-end" as string]: primaryButtonEnd, ["--track" as string]: panelSoft } as CSSProperties}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: panelMuted, letterSpacing: 0.2 }}>
          <span>{formatPlaybackTime(displayedElapsedMs)}</span>
          <span>{formatPlaybackTime(displayedDurationMs)}</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, alignItems: "center" }}>
        <button onClick={prev} style={{ ...cb, opacity: isQueueMode ? 1 : 0.4, cursor: isQueueMode ? 'pointer' : 'default' }}><SkipBack size={16} /></button>
        <button onClick={togglePlay} style={{ ...cb, width: 44, height: 44, fontSize: 14, background: primaryButtonBackground, color: "#fff", border: "none", boxShadow: primaryButtonShadow }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button onClick={next} style={{ ...cb, opacity: isQueueMode ? 1 : 0.4, cursor: isQueueMode ? 'pointer' : 'default' }}><SkipForward size={16} /></button>
      </div>
      </div>
    </>
  )
}