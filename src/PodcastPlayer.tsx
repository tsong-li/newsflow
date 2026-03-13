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
  autoPlayToken?: number
  onClose: () => void
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
        "Here is the quick read on this one",
        "This one moved fast",
        "The short sports version is this",
      ],
      detail: [
        "The swing point is that",
        "What changed quickly is that",
        "The key turn is that",
      ],
      closing: [
        "That is the part to watch going into the next phase.",
        "That is the part carrying the momentum now.",
      ],
      max: 1500,
    }
  }

  if (/business|market|finance/.test(value)) {
    return {
      opening: [
        "The market read is this",
        "Here is the business version in plain English",
        "The core signal here is this",
      ],
      detail: [
        "What matters underneath that is",
        "The practical read-through is that",
        "What investors would hear in that is",
      ],
      closing: [
        "That is the part likely to shape the next reaction.",
        "That is the key read-through from here.",
      ],
      max: 1600,
    }
  }

  if (/tech|science/.test(value)) {
    return {
      opening: [
        "The main development here is this",
        "At a high level, this is what changed",
        "The calm read on this story is this",
        "The clearest way into this story is this",
        "If you strip away the noise, this is the core update",
        "The important shift underneath the headline is this",
        "Start with the central development",
      ],
      detail: [
        "The important detail is that",
        "What matters structurally is that",
        "The deeper point here is that",
      ],
      closing: [
        "That is the part that matters beyond the headline.",
        "That is the thread worth carrying into the next update.",
      ],
      max: 1750,
    }
  }

  return {
    opening: [
      "The short version is this",
      "What is happening here is fairly direct",
      "Here is what stands out in this story",
      "The cleanest way to read this is as follows",
      "The first thing to know here is this",
      "The story really starts here",
    ],
    detail: [
      "What matters is that",
      "In practical terms,",
      "What this seems to mean is",
    ],
    closing: [
      "That is the thread worth watching next.",
      "That is the angle to keep in mind going forward.",
    ],
    max: 1700,
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

function buildArticleNarration(
  article: Article,
  content: ArticleContent | null,
  index: number,
  total: number,
  weatherContext: WeatherContext,
  includeIntro: boolean,
  currentVoiceName?: string,
  nextVoiceName?: string,
) {
  const seed = `${article.title}|${article.source || ""}|${article.category || ""}`
  const tone = getListenTone(article.category)
  const lead = normalizeSpeechText(content?.subtitle || article.summary || article.title, 170)
  const paragraphs = (content?.paragraphs || [])
    .map((paragraph) => normalizeSpeechText(paragraph, 190))
    .filter(Boolean)

  const detail = paragraphs.find((paragraph) => paragraph.length > 90) || normalizeSpeechText(article.keyPoints?.[0] || "", 150)
  const supporting = paragraphs.find((paragraph) => paragraph !== detail && paragraph.length > 70) || normalizeSpeechText(article.keyPoints?.[1] || "", 140)
  const opening = pickVariant(`${seed}:opening`, tone.opening)
  const detailLead = pickVariant(`${seed}:detail`, tone.detail)
  const closing = pickVariant(`${seed}:closing`, [
    article.source ? `${article.source} is treating this as the important thread to watch.` : "That is the thread worth watching next.",
    article.source ? `That is the angle ${article.source} keeps bringing forward.` : "That is the angle to keep in mind going forward.",
    article.source ? `That is why ${article.source} is paying attention to this update.` : "That is why this update matters more than it first appears.",
    ...tone.closing,
  ])
  const openingLine = buildOpeningLine(seed, opening, lead, article.title)

  const lines = [
    includeIntro ? buildIntroLine(weatherContext) : "",
    openingLine,
    detail ? `${detailLead} ${toSentence(lowercaseLead(detail))}` : "",
    supporting ? toSentence(supporting) : "",
    closing,
    buildTransitionLine(seed, index === total - 1, currentVoiceName, nextVoiceName),
  ].filter(Boolean)

  return clipText(lines.join(" "), tone.max)
}

export default function PodcastPlayer({ articles, startIdx = 0, autoPlayToken = 0, onClose }: Props) {
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
  const [contentByLink, setContentByLink] = useState<Record<string, ArticleContent>>({})
  const [loadingByLink, setLoadingByLink] = useState<Record<string, boolean>>({})
  const [failedByLink, setFailedByLink] = useState<Record<string, boolean>>({})
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingAutoPlayIdxRef = useRef<number | null>(null)
  const sessionIdRef = useRef(createAudioSessionId("listen"))

  const current = articles[idx]
  const currentContent = current?.link ? contentByLink[current.link] || null : null
  useEffect(() => {
    let cancelled = false

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
    if (!current?.link) return
    if (contentByLink[current.link] || loadingByLink[current.link] || failedByLink[current.link]) return

    let cancelled = false
    setLoadingByLink((state) => ({ ...state, [current.link!]: true }))

    fetch(`/api/article-content?link=${encodeURIComponent(current.link)}`)
      .then((response) => response.json())
      .then((content: ArticleContent) => {
        if (cancelled) return
        setContentByLink((state) => ({ ...state, [current.link!]: content }))
      })
      .catch(() => {
        if (cancelled) return
        setFailedByLink((state) => ({ ...state, [current.link!]: true }))
      })
      .finally(() => {
        if (cancelled) return
        setLoadingByLink((state) => ({ ...state, [current.link!]: false }))
      })

    return () => {
      cancelled = true
    }
  }, [current?.link, contentByLink, loadingByLink, failedByLink])

  const currentVoice = useMemo(() => {
    if (!current) return null
    return pickSequentialTtsVoice(
      `${articles[startIdx]?.title || current.title}|${articles[startIdx]?.source || ""}|${startIdx}`,
      idx - startIdx,
      "listen",
    )
  }, [articles, current, idx, startIdx])
  const nextVoice = useMemo(() => {
    if (!current || idx >= articles.length - 1) return null
    return pickSequentialTtsVoice(
      `${articles[startIdx]?.title || current.title}|${articles[startIdx]?.source || ""}|${startIdx}`,
      idx + 1 - startIdx,
      "listen",
    )
  }, [articles, current, idx, startIdx])
  const script = current
    ? buildArticleNarration(
        current,
        currentContent,
        idx,
        articles.length,
        weatherContext,
        idx === startIdx,
        currentVoice?.label,
        nextVoice?.label,
      )
    : ""

  useEffect(() => {
    if (!playing) return
    if (pendingAutoPlayIdxRef.current !== null && pendingAutoPlayIdxRef.current !== idx) return
    if (idx === startIdx && !weatherResolved) return
    pendingAutoPlayIdxRef.current = null
    doPlay()
  }, [idx, playing, autoPlayToken, startIdx, weatherResolved])

  useEffect(() => subscribeExclusiveAudio(sessionIdRef.current, () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlaying(false)
  }), [])

  if (!current) return null

  function doStop() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlaying(false)
  }

  function doPlay() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    requestExclusiveAudio({ ownerId: sessionIdRef.current, source: "listen" })
    setPlaying(true)
    setProgress(0)
    const url = apiUrl("/api/tts?text=" + encodeURIComponent(script.slice(0, 2000)) + (currentVoice ? "&voice=" + encodeURIComponent(currentVoice.id) : ""))
    const audio = new Audio(url)
    audioRef.current = audio
    audio.onended = () => {
      setProgress(100)
      if (idx < articles.length - 1) {
        pendingAutoPlayIdxRef.current = idx + 1
        setIdx((value) => value + 1)
      } else {
        setPlaying(false)
      }
    }
    audio.ontimeupdate = () => {
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100)
    }
    audio.play().catch(() => setPlaying(false))
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
    doStop()
    setProgress(0)
    if (idx < articles.length - 1) setIdx((value) => value + 1)
  }

  function prev() {
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
      <div style={{ fontSize: 11, color: panelMuted, marginBottom: 10 }}>{idx + 1} / {articles.length}</div>
      <div style={{ height: 4, background: panelSoft, borderRadius: 999, marginBottom: 12, overflow: "hidden" }}>
        <div style={{ height: "100%", width: progress + "%", background: accent, borderRadius: 999, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 16, alignItems: "center" }}>
        <button onClick={prev} style={cb}><SkipBack size={16} /></button>
        <button onClick={togglePlay} style={{ ...cb, width: 44, height: 44, fontSize: 14, background: accent, color: "#fff", border: "none", boxShadow: "0 8px 20px rgba(184,71,42,0.28)" }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
        <button onClick={next} style={cb}><SkipForward size={16} /></button>
      </div>
    </div>
  )
}