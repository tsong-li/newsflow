import PodcastPlayer from './PodcastPlayer'
import WatchPlayer from './WatchPlayer'
import { apiUrl, proxiedImageUrl } from './api'
import React, { startTransition, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, Headphones, Play, Brain, Sparkles, Loader2, X } from 'lucide-react'

interface NewsItem {
  id: string; category: string; title: string; summary: string
  keyPoints: string[]; image: string | null; imageQuality?: 'high' | 'medium' | 'low' | 'fallback'; source: string; time: string; link: string
}

interface AnalysisState {
  idx: number
  loading: boolean
  tldr?: string
  keyPoints?: string[]
  context?: string
  sentiment?: string
  readTime?: string
}

interface ReaderState {
  item: NewsItem
  idx: number
}

interface ArticleContent {
  byline?: string
  subtitle?: string
  paragraphs: string[]
}

interface ArticleVideo {
  url: string
  kind: 'iframe' | 'video'
  provider?: string
  poster?: string
  title?: string
  source?: 'article' | 'youtube-search'
}

interface ArticleMedia {
  url: string
  caption?: string
}

const WATCH_IMAGE_TARGET = 4
const DIGEST_PRELOAD_COUNT = 4
const DIGEST_PRELOAD_STAGGER_MS = 220
const WATCH_PRELOAD_COUNT = 4
const WATCH_PRELOAD_STAGGER_MS = 320
const FINANCE_SOURCES = new Set(['Bloomberg Markets', 'WSJ Markets'])
const SPORTS_SOURCES = new Set(['ESPN', 'BBC Sport'])
const ALL_VISUAL_CATEGORY_ORDER = ['Tech', 'Business', 'Sports', 'World', 'Science']
const ALL_LIST_CATEGORY_ORDER = ['Finance', 'Tech', 'Business', 'Sports', 'World', 'Science']

const CATEGORIES = ['All', 'Tech', 'Business', 'Sports', 'Finance', 'World', 'Science']
const API = apiUrl('/api')
function getRequiredWatchMediaCount(item: NewsItem) {
  return Math.max(0, WATCH_IMAGE_TARGET - (item.image ? 1 : 0))
}

function hasSourceImage(item: NewsItem | null | undefined): item is NewsItem {
  return Boolean(item?.image)
}

function getSourceImage(item: NewsItem) {
  return item.image || ''
}

function getRenderableSourceImage(item: NewsItem) {
  return proxiedImageUrl(item.image || '') || item.image || ''
}

function getImageQuality(item: NewsItem): 'high' | 'medium' | 'low' | 'fallback' {
  if (!item.image) return 'fallback'
  return item.imageQuality || 'medium'
}

function isFinanceStory(item: NewsItem) {
  return item.category === 'Finance' || FINANCE_SOURCES.has(item.source)
}

function isSportsStory(item: NewsItem) {
  return item.category === 'Sports' || SPORTS_SOURCES.has(item.source)
}

function NewsImage({ src, fallbackSrc, eager = false }: { src: string; fallbackSrc?: string; eager?: boolean }) {
  const [resolvedSrc, setResolvedSrc] = useState(src)

  useEffect(() => {
    setResolvedSrc(src)
  }, [src])

  return (
    <img
      className="news-image"
      src={resolvedSrc}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={eager ? 'high' : 'auto'}
      onError={() => {
        if (!fallbackSrc || resolvedSrc === fallbackSrc) return
        setResolvedSrc(fallbackSrc)
      }}
    />
  )
}

const TODAY = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

function Modes({ onClick, onListen, onWatch, onDeep }: { onClick?: React.MouseEventHandler; onListen?: () => void; onWatch?: () => void; onDeep?: () => void }) {
  return (
    <div className="modes" onClick={onClick}>
      <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onListen?.() }}><Headphones size={12} /> Listen</button>
      <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onWatch?.() }}><Play size={12} /> Watch</button>
     <button className="mode-btn" onClick={(e) => { e.stopPropagation(); onDeep?.() }}><Brain size={12} /> Digest</button>
    </div>
  )
}

function App() {
  const [tab, setTab] = useState('All')
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showPodcast, setShowPodcast] = useState(false)
  const [podcastIdx, setPodcastIdx] = useState(0)
  const [podcastMode, setPodcastMode] = useState<'queue' | 'single'>('queue')
  const [podcastAutoPlayToken, setPodcastAutoPlayToken] = useState(0)
  const [watch, setWatch] = useState<ReaderState | null>(null)
  const [watchAnalysis, setWatchAnalysis] = useState<AnalysisState | null>(null)
  const [watchContent, setWatchContent] = useState<ArticleContent | null>(null)
  const [watchContentLoading, setWatchContentLoading] = useState(false)
  const [watchMedia, setWatchMedia] = useState<string[]>([])
  const [watchVideo, setWatchVideo] = useState<ArticleVideo | null>(null)
  const [watchVideoLoading, setWatchVideoLoading] = useState(false)
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const [reader, setReader] = useState<ReaderState | null>(null)
  const [readerAnalysis, setReaderAnalysis] = useState<AnalysisState | null>(null)
  const [readerContent, setReaderContent] = useState<ArticleContent | null>(null)
  const [readerContentLoading, setReaderContentLoading] = useState(false)
  const readerScrollRef = useRef(0)
  const categoryCacheRef = useRef<Record<string, NewsItem[]>>({})
  const pendingRequestsRef = useRef<Record<string, Promise<NewsItem[]>>>({})
  const prefetchedRef = useRef(false)
  const analysisCacheRef = useRef<Record<string, AnalysisState>>({})
  const pendingAnalysisRef = useRef<Record<string, Promise<AnalysisState>>>({})
  const analysisPrefetchRef = useRef<Record<string, boolean>>({})
  const watchPrefetchRef = useRef<Record<string, boolean>>({})
  const contentCacheRef = useRef<Record<string, ArticleContent>>({})
  const pendingContentRef = useRef<Record<string, Promise<ArticleContent>>>({})
  const mediaCacheRef = useRef<Record<string, string[]>>({})
  const pendingMediaRef = useRef<Record<string, Promise<string[]>>>({})
  const videoCacheRef = useRef<Record<string, ArticleVideo | null>>({})
  const pendingVideoRef = useRef<Record<string, Promise<ArticleVideo | null>>>({})

  async function fetchCategory(category: string, force = false): Promise<NewsItem[]> {
    if (!force && categoryCacheRef.current[category]) return categoryCacheRef.current[category]
    if (!force && pendingRequestsRef.current[category]) return pendingRequestsRef.current[category]

    const request = fetch(`${API}/news?category=${encodeURIComponent(category)}`)
      .then(r => r.json())
      .then((items: NewsItem[]) => {
        categoryCacheRef.current[category] = items
        return items
      })
      .finally(() => {
        delete pendingRequestsRef.current[category]
      })

    pendingRequestsRef.current[category] = request
    return request
  }

  function openPodcast(startIdx: number, mode: 'queue' | 'single' = 'single') {
    setPodcastIdx(startIdx)
    setPodcastMode(mode)
    setPodcastAutoPlayToken((value) => value + 1)
    setShowPodcast(true)
  }

  function openWatch(item: NewsItem, idx: number) {
    const key = getAnalysisKey(item)
    setWatch({ item, idx })
    setWatchAnalysis(analysisCacheRef.current[key] || { idx, loading: true })
    setWatchContent(contentCacheRef.current[item.link] || null)
    setWatchContentLoading(!contentCacheRef.current[item.link])
    setWatchMedia(mediaCacheRef.current[item.link] || [])
    setWatchVideo(videoCacheRef.current[item.link] ?? null)
    setWatchVideoLoading(!(item.link in videoCacheRef.current))
  }

  function closeWatch() {
    setWatch(null)
    setWatchAnalysis(null)
    setWatchContent(null)
    setWatchContentLoading(false)
    setWatchMedia([])
    setWatchVideo(null)
    setWatchVideoLoading(false)
  }

  function getAnalysisKey(item: NewsItem) {
    return [item.title, item.summary || '', item.source || ''].join('||')
  }

  function openArticle(item: NewsItem, idx: number) {
    readerScrollRef.current = window.scrollY
    const nextReader = { item, idx }
    const nextHash = `#story-${encodeURIComponent(item.id)}`
    const nextAnalysis = analysisCacheRef.current[getAnalysisKey(item)] || { idx, loading: true }

    setReader(nextReader)
    setReaderAnalysis(nextAnalysis)
    setAnalysis(null)

    if (window.location.hash.startsWith('#story-')) {
      window.history.replaceState({ readerId: item.id }, '', nextHash)
    } else {
      window.history.pushState({ readerId: item.id }, '', nextHash)
    }

    window.scrollTo({ top: 0, behavior: 'auto' })
  }

  function closeArticle() {
    if (window.location.hash.startsWith('#story-')) {
      window.history.back()
      return
    }

    setReader(null)
    setReaderAnalysis(null)
    window.scrollTo({ top: readerScrollRef.current, behavior: 'auto' })
  }

  async function fetchAnalysis(item: NewsItem, idx: number) {
    const key = getAnalysisKey(item)

    if (analysisCacheRef.current[key]) return analysisCacheRef.current[key]
    if (pendingAnalysisRef.current[key]) return pendingAnalysisRef.current[key]

    const request = fetch(apiUrl("/api/analyze?title=" + encodeURIComponent(item.title) + "&summary=" + encodeURIComponent(item.summary || "") + "&source=" + encodeURIComponent(item.source || "")))
      .then(r => r.json())
      .then((data) => {
        const nextAnalysis = { idx, loading: false, ...data }
        analysisCacheRef.current[key] = nextAnalysis
        return nextAnalysis
      })
      .finally(() => {
        delete pendingAnalysisRef.current[key]
      })

    pendingAnalysisRef.current[key] = request
    return request
  }

  async function fetchArticleContent(item: NewsItem) {
    const key = item.link

    if (contentCacheRef.current[key]) return contentCacheRef.current[key]
    if (pendingContentRef.current[key]) return pendingContentRef.current[key]

    const request = fetch(`${API}/article-content?link=${encodeURIComponent(item.link)}`)
      .then((response) => response.json())
      .then((content: ArticleContent) => {
        contentCacheRef.current[key] = content
        return content
      })
      .finally(() => {
        delete pendingContentRef.current[key]
      })

    pendingContentRef.current[key] = request
    return request
  }

  async function fetchArticleVideo(item: NewsItem) {
    const key = item.link

    if (key in videoCacheRef.current) return videoCacheRef.current[key]
    if (pendingVideoRef.current[key]) return pendingVideoRef.current[key]

    const request = fetch(`${API}/article-video?link=${encodeURIComponent(item.link)}`)
      .then((response) => response.json())
      .then(async (video: ArticleVideo | null) => {
        if (video?.url) {
          videoCacheRef.current[key] = video
          return video
        }

        const fallbackParams = new URLSearchParams({
          title: item.title,
          category: item.category,
          source: item.source,
          limit: '1',
        })
        const fallbackResponse = await fetch(`${API}/youtube-search?${fallbackParams.toString()}`)
        const fallbackResults = await fallbackResponse.json()
        const fallbackVideo = Array.isArray(fallbackResults) ? (fallbackResults[0] || null) : null

        videoCacheRef.current[key] = fallbackVideo
        return fallbackVideo
      })
      .finally(() => {
        delete pendingVideoRef.current[key]
      })

    pendingVideoRef.current[key] = request
    return request
  }

  async function fetchArticleMedia(item: NewsItem) {
    const key = item.link
    const requiredMediaCount = getRequiredWatchMediaCount(item)
    const cachedMedia = mediaCacheRef.current[key]

    if (cachedMedia && cachedMedia.length >= requiredMediaCount) return cachedMedia
    if (pendingMediaRef.current[key]) return pendingMediaRef.current[key]

    const params = new URLSearchParams({
      link: item.link,
      title: item.title,
      category: item.category,
      primaryImage: item.image || '',
    })

    const request = fetch(`${API}/article-media?${params.toString()}`)
      .then((response) => response.json())
      .then((media: ArticleMedia[]) => {
        const nextMedia = (Array.isArray(media) ? media : [])
          .map((entry) => proxiedImageUrl(entry?.url || ''))
          .filter((url): url is string => Boolean(url))
        mediaCacheRef.current[key] = nextMedia
        return nextMedia
      })
      .finally(() => {
        delete pendingMediaRef.current[key]
      })

    pendingMediaRef.current[key] = request
    return request
  }

  async function preloadWatchAssets(item: NewsItem, idx: number) {
    const key = item.link

    if (watchPrefetchRef.current[key]) return
    watchPrefetchRef.current[key] = true

    const tasks = [
      fetchAnalysis(item, idx),
      fetchArticleContent(item),
      fetchArticleMedia(item),
      fetchArticleVideo(item),
    ]

    const results = await Promise.allSettled(tasks)
    const allFailed = results.every((result) => result.status === 'rejected')
    if (allFailed) {
      delete watchPrefetchRef.current[key]
    }
  }

  async function deepAnalyze(item: NewsItem, idx: number) {
    const key = getAnalysisKey(item)
    setAnalysis(analysisCacheRef.current[key] || { idx, loading: true })

    try {
      const nextAnalysis = await fetchAnalysis(item, idx)
      setAnalysis(nextAnalysis)
    } catch (e) {
      console.error(e)
      setAnalysis({ idx, loading: false, tldr: 'AI analysis temporarily unavailable.', keyPoints: [], context: 'Unable to load analysis right now.', sentiment: 'Neutral', readTime: '1 min read' })
    }
  }

  useEffect(() => {
    let cancelled = false

    if (categoryCacheRef.current[tab]) {
      startTransition(() => setNews(categoryCacheRef.current[tab]))
      setLoading(false)
      return
    }

    setLoading(true)
    fetchCategory(tab)
      .then((items) => {
        if (cancelled) return
        startTransition(() => setNews(items))
      })
      .catch(() => {
        if (!cancelled) setNews([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tab])

  useEffect(() => {
    if (prefetchedRef.current) return
    if (!categoryCacheRef.current[tab]?.length) return

    prefetchedRef.current = true
    const timers = CATEGORIES.filter((category) => category !== tab).map((category, index) => (
      window.setTimeout(() => {
        fetchCategory(category).catch(() => {})
      }, 180 * (index + 1))
    ))

    return () => timers.forEach(window.clearTimeout)
  }, [tab, news.length])

  useEffect(() => {
    if (!news.length) return

    const preloadItems = news.slice(0, DIGEST_PRELOAD_COUNT)
    const timers = preloadItems.map((item, index) => window.setTimeout(() => {
      const key = getAnalysisKey(item)

      if (analysisPrefetchRef.current[key]) return
      analysisPrefetchRef.current[key] = true
      fetchAnalysis(item, index).catch(() => {
        delete analysisPrefetchRef.current[key]
      })
    }, DIGEST_PRELOAD_STAGGER_MS * index))

    return () => timers.forEach(window.clearTimeout)
  }, [news])

  useEffect(() => {
    if (!news.length) return

    const preloadItems = news.slice(0, WATCH_PRELOAD_COUNT)
    const timers = preloadItems.map((item, index) => window.setTimeout(() => {
      void preloadWatchAssets(item, index).catch(() => {})
    }, WATCH_PRELOAD_STAGGER_MS * index))

    return () => timers.forEach(window.clearTimeout)
  }, [news])

  useEffect(() => {
    const handlePopState = () => {
      if (!window.location.hash.startsWith('#story-')) {
        setReader(null)
        setReaderAnalysis(null)
        window.scrollTo({ top: readerScrollRef.current, behavior: 'auto' })
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (!reader) return

    let cancelled = false
    fetchAnalysis(reader.item, reader.idx)
      .then((nextAnalysis) => {
        if (!cancelled) setReaderAnalysis(nextAnalysis)
      })
      .catch(() => {
        if (!cancelled) {
          setReaderAnalysis({ idx: reader.idx, loading: false, tldr: 'AI analysis temporarily unavailable.', keyPoints: [], context: 'Unable to load analysis right now.', sentiment: 'Neutral', readTime: '1 min read' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [reader])

  useEffect(() => {
    if (!watch) {
      setWatchAnalysis(null)
      return
    }

    let cancelled = false
    fetchAnalysis(watch.item, watch.idx)
      .then((nextAnalysis) => {
        if (!cancelled) setWatchAnalysis(nextAnalysis)
      })
      .catch(() => {
        if (!cancelled) {
          setWatchAnalysis({ idx: watch.idx, loading: false, tldr: 'AI analysis temporarily unavailable.', keyPoints: [], context: 'Unable to load analysis right now.', sentiment: 'Neutral', readTime: '1 min read' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [watch])

  useEffect(() => {
    if (!reader) {
      setReaderContent(null)
      setReaderContentLoading(false)
      return
    }
  }, [reader])

  useEffect(() => {
    if (!reader) return

    let cancelled = false
    const cachedContent = contentCacheRef.current[reader.item.link]

    setReaderContent(cachedContent || null)
    setReaderContentLoading(!cachedContent)

    fetchArticleContent(reader.item)
      .then((content) => {
        if (!cancelled) setReaderContent(content)
      })
      .catch(() => {
        if (!cancelled) setReaderContent({ byline: '', subtitle: '', paragraphs: [] })
      })
      .finally(() => {
        if (!cancelled) setReaderContentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reader])

  useEffect(() => {
    if (!watch) {
      setWatchContent(null)
      setWatchContentLoading(false)
      return
    }

    let cancelled = false
    const cachedContent = contentCacheRef.current[watch.item.link]

    setWatchContent(cachedContent || null)
    setWatchContentLoading(!cachedContent)

    fetchArticleContent(watch.item)
      .then((content) => {
        if (!cancelled) setWatchContent(content)
      })
      .catch(() => {
        if (!cancelled) setWatchContent({ byline: '', subtitle: '', paragraphs: [] })
      })
      .finally(() => {
        if (!cancelled) setWatchContentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [watch])

  useEffect(() => {
    if (!watch) {
      setWatchMedia([])
      return
    }

    let cancelled = false
    const cachedMedia = mediaCacheRef.current[watch.item.link] || []
    setWatchMedia(cachedMedia)

    fetchArticleMedia(watch.item)
      .then((media) => {
        if (!cancelled) setWatchMedia(media)
      })
      .catch(() => {
        if (!cancelled) setWatchMedia([])
      })

    return () => {
      cancelled = true
    }
  }, [watch])

  useEffect(() => {
    if (!watch) {
      setWatchVideo(null)
      setWatchVideoLoading(false)
      return
    }

    let cancelled = false
    const cachedVideo = Object.prototype.hasOwnProperty.call(videoCacheRef.current, watch.item.link)
      ? videoCacheRef.current[watch.item.link]
      : null

    setWatchVideo(cachedVideo)
    setWatchVideoLoading(!Object.prototype.hasOwnProperty.call(videoCacheRef.current, watch.item.link))

    fetchArticleVideo(watch.item)
      .then((video) => {
        if (!cancelled) setWatchVideo(video)
      })
      .catch(() => {
        if (!cancelled) setWatchVideo(null)
      })
      .finally(() => {
        if (!cancelled) setWatchVideoLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [watch])

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')
  const indexedNews = news.map((item, index) => ({ item, index }))
  let heroRef = indexedNews[0]
  let pairRefs = indexedNews.slice(1, 3)
  let middleRefs = indexedNews.slice(3, 7)
  let listRefs = indexedNews.slice(7, 17)

  if (tab === 'All') {
    const visualRefs: Array<{ item: NewsItem; index: number }> = []
    const selectedVisualIds = new Set<string>()

    for (let round = 0; round < 2; round += 1) {
      for (const category of ALL_VISUAL_CATEGORY_ORDER) {
        const nextItem = indexedNews
          .filter(({ item }) => item.category === category && !isFinanceStory(item) && hasSourceImage(item) && !selectedVisualIds.has(item.id))[0]
        if (!nextItem) continue
        visualRefs.push(nextItem)
        selectedVisualIds.add(nextItem.item.id)
      }
    }

    if (visualRefs.length < 10) {
      const fallbackRefs = indexedNews
        .filter(({ item }) => !isFinanceStory(item) && hasSourceImage(item) && !selectedVisualIds.has(item.id))
        .slice(0, 10 - visualRefs.length)
      for (const itemRef of fallbackRefs) {
        visualRefs.push(itemRef)
        selectedVisualIds.add(itemRef.item.id)
      }
    }

    const visualIds = new Set(visualRefs.map(({ item }) => item.id))
    heroRef = visualRefs[0] || indexedNews.find(({ item }) => !isFinanceStory(item)) || indexedNews[0]
    pairRefs = visualRefs.slice(1, 3)
    middleRefs = visualRefs.slice(3, 10)
    const remainingRefs = indexedNews.filter(({ item }) => !visualIds.has(item.id))
    const selectedListIds = new Set<string>()
    const nextListRefs: Array<{ item: NewsItem; index: number }> = []

    for (let round = 0; round < 2 && nextListRefs.length < 10; round += 1) {
      for (const category of ALL_LIST_CATEGORY_ORDER) {
        if (nextListRefs.length >= 10) break
        const nextItem = remainingRefs.find(({ item }) => item.category === category && !selectedListIds.has(item.id))
        if (!nextItem) continue
        nextListRefs.push(nextItem)
        selectedListIds.add(nextItem.item.id)
      }
    }

    if (nextListRefs.length < 10) {
      const fallbackRefs = remainingRefs
        .filter(({ item }) => !selectedListIds.has(item.id))
        .slice(0, 10 - nextListRefs.length)
      for (const itemRef of fallbackRefs) {
        nextListRefs.push(itemRef)
        selectedListIds.add(itemRef.item.id)
      }
    }

    listRefs = nextListRefs
  }

  const hero = heroRef?.item
  const heroIndex = heroRef?.index ?? 0
  const pair = pairRefs
  const middle = middleRefs
  const rest = listRefs
  const readerItem = reader?.item || null
  const readerQuote = readerAnalysis?.keyPoints?.[0] || readerAnalysis?.tldr || readerItem?.summary || ''
  const relatedStories = readerItem ? news.filter((item) => item.id !== readerItem.id).slice(0, 3) : []
  const readerParagraphs = readerContent?.paragraphs || []
  const hasFullArticle = readerParagraphs.length >= 4

  // Find a good editorial quote from keyPoints
  const quoteItem = news.find(n => n.keyPoints?.[0]?.length > 20)

  return (
    <div>
      {readerItem ? (
        <article className="reader-shell">
          <div className="reader-topbar">
            <button className="reader-back" onClick={closeArticle}>
              <ArrowLeft size={16} />
              <span>Back to NewsFlow</span>
            </button>
            <button className="reader-source-link" onClick={() => open(readerItem.link)}>
              <span>Original Story</span>
              <ArrowUpRight size={15} />
            </button>
          </div>

          <div className="reader-headline">
            <p className="reader-kicker">{readerItem.category} · {readerItem.source}</p>
            <h1 className="reader-title-display">{readerItem.title}</h1>
            <p className="reader-deck">{readerContent?.subtitle || readerAnalysis?.tldr || readerItem.summary}</p>
            <div className="reader-meta-row">
              <span>{readerItem.time}</span>
              <span>{readerAnalysis?.readTime || '2 min brief'}</span>
            </div>
          </div>

          {hasSourceImage(readerItem) && (
            <div className="reader-visual" data-quality={getImageQuality(readerItem)}>
              <NewsImage src={getRenderableSourceImage(readerItem)} fallbackSrc={getSourceImage(readerItem)} eager />
            </div>
          )}

          <div className="reader-layout">
            <aside className="reader-aside">
              <div className="reader-aside-block">
                <div className="reader-label">Filed Under</div>
                <p>{readerItem.category}</p>
              </div>
              <div className="reader-aside-block">
                <div className="reader-label">Source</div>
                <p>{readerItem.source}</p>
              </div>
              <div className="reader-aside-block">
                <div className="reader-label">Published</div>
                <p>{readerItem.time}</p>
              </div>
              <div className="reader-actions">
                <button className="reader-action" onClick={() => openPodcast(reader.idx, 'single')}><Headphones size={15} /> Listen</button>
                <button className="reader-action" onClick={() => openWatch(readerItem, reader.idx)}><Play size={15} /> Watch</button>
                <button className="reader-action" onClick={() => deepAnalyze(readerItem, reader.idx)}><Brain size={15} /> Digest</button>
                <button className="reader-action" onClick={() => open(readerItem.link)}><ArrowUpRight size={15} /> Original</button>
              </div>
            </aside>

            <div className="reader-body">
              <section className="reader-section">
                <p className="reader-lede">{readerItem.summary}</p>
                {!!readerContent?.byline && <p className="reader-byline">By {readerContent.byline}</p>}
              </section>

              {readerQuote && (
                <blockquote className="reader-quote">“{readerQuote}”</blockquote>
              )}

              {readerContentLoading && (
                <div className="reader-content-loading">Pulling the full story from the original article…</div>
              )}

              {hasFullArticle && (
                <section className="reader-section reader-full-story">
                  <h2>Full Story</h2>
                  <div className="reader-prose">
                    {readerParagraphs.map((paragraph, index) => (
                      <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                    ))}
                  </div>
                </section>
              )}

              {readerAnalysis?.loading ? (
                <div className="reader-loading">
                  <Loader2 size={22} style={{ animation: 'spin 1.2s linear infinite', color: '#b8472a' }} />
                  <p>Preparing the full brief...</p>
                </div>
              ) : (
                <>
                  <section className="reader-section">
                    <h2>At a Glance</h2>
                    <p>{readerAnalysis?.tldr || readerItem.summary}</p>
                  </section>

                  {!!readerAnalysis?.keyPoints?.length && (
                    <section className="reader-section reader-notes">
                      <h2>Field Notes</h2>
                      <ul>
                        {readerAnalysis.keyPoints.map((point, index) => (
                          <li key={index}>{point}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="reader-section">
                    <h2>Context</h2>
                    <p>{readerAnalysis?.context || 'This story is part of the current NewsFlow brief and links back to the broader developments shaping today’s cycle.'}</p>
                  </section>
                </>
              )}

              <section className="reader-section reader-source-note">
                <h2>Source Note</h2>
                <p>This article card is curated from {readerItem.source}. For the full reported piece, source detail and any live updates, continue to the original publication.</p>
              </section>
            </div>
          </div>

          {relatedStories.length > 0 && (
            <section className="reader-related">
              <div className="reader-related-head">
                <p className="reader-kicker">Continue Reading</p>
                <h2>More from today’s brief</h2>
              </div>
              <div className="reader-related-grid">
                {relatedStories.map((item) => (
                  <button key={item.id} className="reader-related-card" onClick={() => openArticle(item, news.indexOf(item))}>
                    <span className="reader-related-cat">{item.category}</span>
                    <span className="reader-related-title">{item.title}</span>
                    <span className="reader-related-meta">{item.source} · {item.time}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </article>
      ) : (
        <>
      {/* Masthead */}
      <header className="masthead">
        <h1 className="masthead-title">NEWSFLOW</h1>
        <p className="masthead-date">{TODAY}</p>
        {!showPodcast && (
          <button
            className="listen-fab"
            onClick={() => openPodcast(0, 'queue')}
            title="Listen"
            aria-label="Listen"
          >
            <Headphones size={22} strokeWidth={2.2} />
          </button>
        )}
      </header>

      {/* Nav */}
      <nav className="nav">
        {CATEGORIES.map(c => (
          <button key={c} className={`nav-item ${tab === c ? 'active' : ''}`} onMouseEnter={() => { void fetchCategory(c) }} onFocus={() => { void fetchCategory(c) }} onClick={() => setTab(c)}>
            {c}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="loading-center">
          <Loader2 size={24} style={{ animation: 'spin 1.2s linear infinite', color: '#999' }} />
          <p>Loading</p>
        </div>
      ) : (
        <>
          {/* HERO */}
          {hero && (
            <div className="wrapper">
              <section className="hero-section" onClick={() => openArticle(hero, heroIndex)}>
                {hasSourceImage(hero) && (
                  <div className="hero-img" data-quality={getImageQuality(hero)}><NewsImage src={getRenderableSourceImage(hero)} fallbackSrc={getSourceImage(hero)} eager /></div>
                )}
                <div className="hero-text">
                  <p className="hero-cat">{hero.category}</p>
                  <h2 className="hero-title">{hero.title}</h2>
                  <p className="hero-summary">{hero.summary?.slice(0, 180)}</p>
                  <Modes onClick={e => e.stopPropagation()} onListen={() => openPodcast(heroIndex, 'single')} onWatch={() => openWatch(hero, heroIndex)} onDeep={() => deepAnalyze(hero, heroIndex)} />
                </div>
              </section>
            </div>
          )}

          <hr className="section-rule" />

          {/* TWO-UP */}
          {pair.length > 0 && (
            <div className="wrapper">
              <div className="two-up">
                {pair.map(({ item, index }) => (
                  <article key={item.id} className="two-up-item" onClick={() => openArticle(item, index)}>
                    {hasSourceImage(item) && (
                      <div className="two-up-img" data-quality={getImageQuality(item)}><NewsImage src={getRenderableSourceImage(item)} fallbackSrc={getSourceImage(item)} /></div>
                    )}
                    <p className="item-cat">{item.category}</p>
                    <h3 className="item-title">{item.title}</h3>
                    <p className="item-excerpt">{item.summary?.slice(0, 120)}</p>
                    <Modes onClick={e => e.stopPropagation()} onListen={() => openPodcast(index, 'single')} onWatch={() => openWatch(item, index)} onDeep={() => deepAnalyze(item, index)} />
                  </article>
                ))}
              </div>
            </div>
          )}

          {/* Editorial Break */}
          {quoteItem && (
            <div className="editorial-break">
              <p className="editorial-break-text">"{quoteItem.keyPoints[0]}"</p>
              <p className="editorial-break-attr">— {quoteItem.source} · AI Summary</p>
            </div>
          )}

          {/* Story Rows (alternating image side) */}
          {middle.length > 0 && (
            <div className="wrapper story-list">
              {middle.map(({ item, index }) => (
                <article key={item.id} className="story-row" onClick={() => openArticle(item, index)}>
                  {hasSourceImage(item) ? (
                    <div className="story-row-img" data-quality={getImageQuality(item)}><NewsImage src={getRenderableSourceImage(item)} fallbackSrc={getSourceImage(item)} /></div>
                  ) : <div />}
                  <div className="story-row-text">
                    <p className="item-cat">{item.category}</p>
                    <h3 className="item-title">{item.title}</h3>
                    <p className="item-excerpt">{item.summary?.slice(0, 140)}</p>
                    <Modes onClick={e => e.stopPropagation()} onListen={() => openPodcast(index, 'single')} onWatch={() => openWatch(item, index)} onDeep={() => deepAnalyze(item, index)} />
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Tail List */}
          {rest.length > 0 && (
            <div className="tail-list">
              {rest.map(({ item, index }, i) => (
                <article key={item.id} className="tail-item" onClick={() => openArticle(item, index)}>
                  <p className="tail-number">{String(i + 1).padStart(2, '0')}</p>
                  <p className="item-cat">{item.category}</p>
                  <h3 className="item-title" style={{ fontSize: 22 }}>{item.title}</h3>
                  <p className="item-excerpt">{item.summary?.slice(0, 100)}</p>
                  <Modes onClick={e => e.stopPropagation()} onListen={() => openPodcast(index, 'single')} onWatch={() => openWatch(item, index)} onDeep={() => deepAnalyze(item, index)} />
                </article>
              ))}
            </div>
          )}
        </>
      )}
        </>
      )}
    {analysis && (
      <div
        style={{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(72,49,37,0.18)", zIndex:9998, display:"flex", alignItems:"center", justifyContent:"center", padding:20, backdropFilter:"blur(10px)" }}
        onClick={() => setAnalysis(null)}
      >
        <div
          style={{ position:"relative", overflow:"hidden", background:"linear-gradient(180deg, rgba(255,255,255,0.72), rgba(247,241,235,0.98))", color:"#1a1a1a", borderRadius:24, padding:32, maxWidth:540, width:"100%", fontFamily:"Outfit,sans-serif", border:"1px solid rgba(26,26,26,0.10)", boxShadow:"0 20px 44px rgba(76,51,39,0.16)", minHeight:320 }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
            <div style={{ position:"absolute", top:-42, right:-36, width:180, height:180, borderRadius:"50%", background:"radial-gradient(circle, rgba(184,71,42,0.13), rgba(184,71,42,0) 72%)" }} />
            <div style={{ position:"absolute", top:34, left:-48, width:150, height:150, borderRadius:"50%", background:"radial-gradient(circle, rgba(111,141,122,0.11), rgba(111,141,122,0) 72%)" }} />
          </div>

          <div style={{ position:"relative", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <div style={{ fontSize:11, color:"rgba(26,26,26,0.55)", textTransform:"uppercase", letterSpacing:2 }}>AI Digest</div>
            <button onClick={() => setAnalysis(null)} style={{ background:"none", border:"none", color:"rgba(26,26,26,0.5)", cursor:"pointer", padding:0, display:"flex", alignItems:"center", justifyContent:"center" }} aria-label="Close digest"><X size={14} /></button>
          </div>

          <div style={{ position:"relative", fontSize:18, fontWeight:700, marginBottom:16, lineHeight:1.35 }}>{news[analysis.idx]?.title}</div>

          {analysis.loading ? (
            <div style={{ position:"relative", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, minHeight:180, color:"#7a6e67" }}>
              <Loader2 size={26} style={{ animation: 'spin 1.2s linear infinite', color: '#b8472a' }} />
              <div style={{ fontSize:13, letterSpacing:0.2 }}>Generating analysis...</div>
            </div>
          ) : (
            <>
              <div style={{ position:"relative", display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
                <span style={{ background:analysis.sentiment === 'Positive' ? 'rgba(84, 130, 53, 0.09)' : analysis.sentiment === 'Negative' ? 'rgba(165, 74, 55, 0.09)' : 'rgba(26,26,26,0.035)', padding:"4px 10px", borderRadius:999, fontSize:11, fontWeight:400, color:analysis.sentiment === 'Positive' ? 'rgba(84, 130, 53, 0.88)' : analysis.sentiment === 'Negative' ? 'rgba(138, 63, 46, 0.88)' : 'rgba(61,54,50,0.72)', border:analysis.sentiment === 'Positive' ? '1px solid rgba(84, 130, 53, 0.10)' : analysis.sentiment === 'Negative' ? '1px solid rgba(165, 74, 55, 0.10)' : '1px solid rgba(26,26,26,0.05)' }}>{analysis.sentiment}</span>
                <span style={{ background:"rgba(255,255,255,0.34)", padding:"4px 10px", borderRadius:999, fontSize:11, fontWeight:400, color:"rgba(61,54,50,0.72)", border:"1px solid rgba(26,26,26,0.05)" }}>{analysis.readTime}</span>
              </div>

              <div style={{ position:"relative", fontSize:13, color:"#514741", marginBottom:16, lineHeight:1.8 }}>{analysis.tldr}</div>

              <div style={{ position:"relative", marginBottom:18, padding:"14px 16px 12px", borderRadius:16, background:"linear-gradient(180deg, rgba(255,255,255,0.36), rgba(255,255,255,0.18))", border:"1px solid rgba(26,26,26,0.05)" }}>
                <div style={{ fontSize:12, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:1, color:"#7a6e67" }}>Key Points</div>
                <div style={{ display:"grid", gap:8 }}>
                  {analysis.keyPoints?.map((p: string, i: number) => (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"8px minmax(0, 1fr)", alignItems:"start", columnGap:10 }}>
                      <span style={{ width:5, height:5, borderRadius:"999px", background:"#b8472a", marginTop:8, marginLeft:1 }} />
                      <span style={{ fontSize:13, color:"#3d3632", lineHeight:1.7 }}>{p}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ position:"relative", padding:"14px 16px 12px", borderRadius:16, background:"linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0.12))", border:"1px solid rgba(26,26,26,0.04)" }}>
                <div style={{ fontSize:12, fontWeight:600, marginBottom:10, textTransform:"uppercase", letterSpacing:1, color:"#7a6e67" }}>Context</div>
                <div style={{ fontSize:13, color:"#514741", lineHeight:1.8 }}>{analysis.context}</div>
              </div>

              {!!news[analysis.idx] && (
                <button
                  onClick={() => openArticle(news[analysis.idx], analysis.idx)}
                  style={{ marginTop:18, border:"none", borderRadius:999, background:"linear-gradient(135deg,#e74c3c,#c0392b)", color:"#fff", padding:"11px 16px", fontSize:12, fontWeight:600, letterSpacing:0.3, cursor:"pointer", boxShadow:"0 10px 24px rgba(192,57,43,0.18)", alignSelf:"flex-start", display:"inline-flex", alignItems:"center", justifyContent:"center", gap:6 }}
                >
                  <span>Deep Dive</span>
                  <ArrowRight size={13} strokeWidth={2.2} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )}
    {watch && <WatchPlayer article={watch.item} analysis={watchAnalysis} content={watchContent} contentLoading={watchContentLoading} mediaImages={watchMedia} video={watchVideo} videoLoading={watchVideoLoading} image={getRenderableSourceImage(watch.item)} onClose={closeWatch} />}
    {showPodcast && <PodcastPlayer articles={news} startIdx={podcastIdx} mode={podcastMode} autoPlayToken={podcastAutoPlayToken} onClose={() => setShowPodcast(false)} />}
    </div>
  )
}

export default App
