const express = require('express')
const cors = require('cors')
const Parser = require('rss-parser')
const cheerio = require('cheerio')
const FEEDS = require('./feeds')
const GTTS = require('gtts')
const { createEtag, matchesIfNoneMatch, setCacheHeaders, sendCacheableJson } = require('./httpCache')
const { createPersistentBinaryCache } = require('./persistentCache')
const { registerNewsRoutes } = require('./registerNewsRoutes')
const { registerMediaRoutes } = require('./registerMediaRoutes')
const { registerTtsRoutes } = require('./registerTtsRoutes')
require('dotenv').config()

const PORT = Number(process.env.PORT) || 3001
const HOST = process.env.HOST || '0.0.0.0'
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const app = express()
app.use(cors(CORS_ORIGINS.length ? { origin: CORS_ORIGINS } : undefined))
const parser = new Parser({
  timeout: 7000,
  customFields: {
    item: [
      ['media:content', 'media:content', { keepArray: false }],
      ['media:thumbnail', 'media:thumbnail', { keepArray: false }],
    ]
  }
})

const cache = {}
const imageCache = {}
const imageProxyCache = {}
const mediaCache = {}
const videoCache = {}
const contentCache = {}
const stockImageCache = {}
const pageCache = {}
const pendingNewsRequests = {}
const analyzeCache = {}
const pendingAnalyzeRequests = {}
const ttsRewriteCache = {}
const pendingTtsRewriteRequests = {}
const pendingMediaRequests = {}
const pendingImageProxyRequests = {}
const pendingVideoRequests = {}
const pendingContentRequests = {}
const pendingStockImageRequests = {}
const pendingPageRequests = {}
const youtubeSearchCache = {}
const pendingYouTubeSearchRequests = {}
const backgroundWarmers = {}
let azureSpeechQueue = Promise.resolve()
let azureSpeechLastRequestAt = 0
const CACHE_TTL = 10 * 60 * 1000
const ANALYZE_CACHE_TTL = 60 * 60 * 1000
const PERSISTENT_ASSET_CACHE_TTL = 24 * 60 * 60 * 1000
const EXTERNAL_PAGE_FETCH_TIMEOUT_MS = Number(process.env.EXTERNAL_PAGE_FETCH_TIMEOUT_MS) || 2500
const OG_IMAGE_FETCH_TIMEOUT_MS = Number(process.env.OG_IMAGE_FETCH_TIMEOUT_MS) || 1500
const AZURE_SPEECH_MAX_RETRIES = Math.max(0, Number(process.env.AZURE_SPEECH_MAX_RETRIES) || 5)
const AZURE_SPEECH_RETRY_BASE_DELAY_MS = Math.max(500, Number(process.env.AZURE_SPEECH_RETRY_BASE_DELAY_MS) || 3000)
const AZURE_SPEECH_MIN_INTERVAL_MS = Math.max(0, Number(process.env.AZURE_SPEECH_MIN_INTERVAL_MS) || 3000)
const TRUE_PATTERN = /^(1|true|yes|on)$/i
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'Qwen/Qwen2.5-7B-Instruct'
const PEXELS_API_KEY = process.env.PEXELS_API_KEY
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY
const AZURE_OPENAI_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/+$/, '')
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'Cog-di-askcopilotdatadev'
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21'
const YOUTUBE_DATA_API_KEY = process.env.YOUTUBE_DATA_API_KEY
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY
const RAW_AZURE_SPEECH_REGION = String(process.env.AZURE_SPEECH_REGION || '').trim()
const RAW_AZURE_SPEECH_ENDPOINT = String(process.env.AZURE_SPEECH_ENDPOINT || '').trim()
const AZURE_SPEECH_VOICE = process.env.AZURE_SPEECH_VOICE || 'en-US-AndrewMultilingualNeural'
const DEFAULT_AZURE_SPEECH_VOICES = [
  'en-US-JennyNeural',
  'en-US-GuyNeural',
  'en-US-AriaNeural',
  'en-US-DavisNeural',
  'en-US-JaneNeural',
  'en-US-TonyNeural',
  'en-US-SaraNeural',
  'en-US-JasonNeural',
  AZURE_SPEECH_VOICE,
].filter(Boolean)
const AZURE_SPEECH_VOICES = Array.from(new Set(
  String(process.env.AZURE_SPEECH_VOICES || '')
    .split(',')
    .map((voice) => voice.trim())
    .filter(Boolean)
    .concat(DEFAULT_AZURE_SPEECH_VOICES)
))
const AZURE_SPEECH_OUTPUT_FORMAT = process.env.AZURE_SPEECH_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3'
const TTS_STRICT_AZURE = TRUE_PATTERN.test(String(process.env.TTS_STRICT_AZURE || ''))
const IMAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
}
const IMAGE_PROXY_HEADERS = {
  ...IMAGE_HEADERS,
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
}
const CATEGORY_FETCH_BUDGETS = {
  All: { feedItemLimit: 8, articleImageLimit: 4, imageFetchConcurrency: 4 },
  Tech: { feedItemLimit: 8, articleImageLimit: 4, imageFetchConcurrency: 4 },
  Business: { feedItemLimit: 10, articleImageLimit: 4, imageFetchConcurrency: 3 },
  Finance: { feedItemLimit: 10, articleImageLimit: 6, imageFetchConcurrency: 3 },
  Sports: { feedItemLimit: 8, articleImageLimit: 3, imageFetchConcurrency: 4 },
  World: { feedItemLimit: 8, articleImageLimit: 4, imageFetchConcurrency: 3 },
  Science: { feedItemLimit: 8, articleImageLimit: 4, imageFetchConcurrency: 3 },
}
const ALL_CATEGORY_ORDER = ['Tech', 'Business', 'Sports', 'World', 'Science']
const ALL_MIN_ITEMS_PER_CATEGORY = 4
const ALL_FINANCE_SOURCE_ORDER = ['Bloomberg Markets', 'WSJ Markets']
const ALL_FINANCE_MIN_ITEMS = 2
const STOCK_IMAGE_TARGET = 4
const MAX_SUPPLEMENTAL_MEDIA_WHEN_ORIGINALS_PRESENT = 2
const TITLE_STOP_WORDS = new Set([
  'about', 'after', 'amid', 'also', 'and', 'are', 'back', 'been', 'being', 'beyond', 'from', 'have', 'into', 'just', 'more',
  'news', 'over', 'said', 'says', 'still', 'than', 'that', 'their', 'them', 'then', 'they', 'this', 'what', 'when', 'where',
  'will', 'with', 'your', 'while', 'under', 'could', 'would', 'should', 'across', 'because', 'against', 'behind', 'through',
])
const persistentImageCache = createPersistentBinaryCache('images', 'bin')
const persistentTtsCache = createPersistentBinaryCache('tts', 'mp3')

function buildFallbackAnalysis(title, summary, source) {
  return {
    tldr: summary ? summary.slice(0, 150) + '...' : title,
    keyPoints: ['Reported by ' + (source || 'unknown'), 'AI analysis temporarily unavailable'],
    context: 'Unable to generate AI analysis at this time.',
    sentiment: 'Neutral',
    readTime: '1 min read',
    tags: []
  }
}

function parseAnalysisResponse(text) {
  const clean = String(text || '').replace(/```json?\n?/g, '').replace(/```/g, '').trim()
  const jsonStart = clean.indexOf('{')
  const jsonEnd = clean.lastIndexOf('}')
  const payload = jsonStart >= 0 && jsonEnd >= jsonStart ? clean.slice(jsonStart, jsonEnd + 1) : clean
  return JSON.parse(payload)
}

function cleanTtsRewriteResponse(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^['"\s]+|['"\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripWatchGreeting(text) {
  return String(text || '')
    .replace(/^\s*(?:good\s+(?:morning|afternoon|evening)\b[,.!:\-\s]*)+/i, '')
    .replace(/^\s*(?:hello|hi|hey there|welcome back|thanks for joining us)\b[,.!:\-\s]*/i, '')
    .trim()
}

function stripLeadingGreeting(text) {
  return String(text || '')
    .replace(/^\s*(?:good\s+(?:morning|afternoon|evening)\b[,.!:\-\s]*)+/i, '')
    .replace(/^\s*(?:hello|hi|hey there|welcome back|thanks for joining us|and now|now then)\b[,.!:\-\s]*/i, '')
    .trim()
}

function hasAzureOpenAIConfig() {
  return Boolean(AZURE_OPENAI_ENDPOINT && AZURE_OPENAI_API_KEY && AZURE_OPENAI_DEPLOYMENT)
}

function isTruthy(value) {
  return TRUE_PATTERN.test(String(value || ''))
}

function extractAzureSpeechRegion(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return ''

  if (!/^https?:\/\//i.test(rawValue)) {
    return rawValue
      .replace(/^https?:\/\//i, '')
      .split(/[/.]/)[0]
      .trim()
      .toLowerCase()
  }

  try {
    const parsed = new URL(rawValue)
    return parsed.hostname.split('.')[0].trim().toLowerCase()
  } catch {
    return ''
  }
}

function normalizeAzureSpeechEndpoint(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return ''

  try {
    const parsed = new URL(rawValue)
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function resolveAzureSpeechEndpoint(endpointValue, regionValue) {
  const normalizedEndpoint = normalizeAzureSpeechEndpoint(endpointValue)
  if (normalizedEndpoint) {
    return /\/cognitiveservices\/v1$/i.test(normalizedEndpoint)
      ? normalizedEndpoint
      : `${normalizedEndpoint}/cognitiveservices/v1`
  }

  const region = extractAzureSpeechRegion(regionValue)
  if (!region) return ''
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
}

const AZURE_SPEECH_REGION = extractAzureSpeechRegion(RAW_AZURE_SPEECH_REGION || RAW_AZURE_SPEECH_ENDPOINT)
const AZURE_SPEECH_ENDPOINT = resolveAzureSpeechEndpoint(RAW_AZURE_SPEECH_ENDPOINT, RAW_AZURE_SPEECH_REGION)

function hasAzureSpeechConfig() {
  return Boolean(AZURE_SPEECH_KEY && AZURE_SPEECH_ENDPOINT)
}

function hasYouTubeDataApiConfig() {
  return Boolean(YOUTUBE_DATA_API_KEY)
}

function escapeSsml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

async function requestAzureAnalysis(prompt) {
  const resp = await fetch(`${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: 'You are a precise news analyst. Return valid JSON only and no markdown.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    }),
  })

  if (!resp.ok) {
    throw new Error('Azure OpenAI request failed with status ' + resp.status)
  }

  const data = await resp.json()
  return parseAnalysisResponse(data.choices?.[0]?.message?.content || '')
}

async function requestAzureTtsRewrite(text, mode = 'listen', allowGreeting = mode === 'listen', maxChars = 2000) {
  const charLimit = Math.max(200, Math.min(2000, maxChars))
  const brevityHint = charLimit < 400 ? ' Be very concise: one or two sentences that capture only the most essential fact.' : charLimit < 800 ? ' Be brief: a few clear sentences with the key facts, no extra context.' : ''
  const styleGuide = mode === 'watch'
    ? 'Rewrite this as natural spoken narration for a short news video scene. Make it sound like a confident human presenter speaking in one take: clear, modern, lightly dynamic, and easy to follow aloud.'
    : 'Rewrite this as natural spoken narration for a podcast-style news host. Make it sound like one smart host talking conversationally: warm, fluid, lightly interpretive, and easy to stay with for a minute or two.'

  const resp = await fetch(`${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AZURE_OPENAI_API_KEY,
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: mode === 'watch'
            ? 'You rewrite existing spoken copy for text-to-speech. Preserve every factual claim. Do not add facts. Do not use lists, markdown, labels, quotes, or stage directions. Return plain text only. Prefer short-to-medium sentences with varied rhythm. Remove repetitive framing, stiff transitions, and overly formal wording. Keep it easy to say aloud in one pass.'
            : 'You rewrite existing spoken copy for text-to-speech. Preserve every factual claim. Do not add facts. Do not use lists, markdown, labels, quotes, or stage directions. Return plain text only. Make it sound like a polished podcast host speaking naturally to listeners, not reading a script. Use smooth transitions, occasional gentle emphasis, and a conversational cadence. Avoid newsroom phrasing, robotic signposting, and repetitive sentence openings. Keep it easy to say aloud in one pass.',
        },
        {
          role: 'user',
          content: mode === 'watch'
            ? `${styleGuide} Do not add any greeting, welcome line, time-of-day opener, or host intro such as "good morning" or "good evening". Start directly with the story. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article. Keep it under 2000 characters.\n\nOriginal copy:\n${text}`
            : allowGreeting
              ? `${styleGuide} If the source already starts with a greeting, date line, or weather line, preserve that opening verbatim and only smooth the rest of the narration around it. Do not change the time-of-day greeting or weather facts. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article. Keep it under 2000 characters.\n\nOriginal copy:\n${text}`
              : `${styleGuide} Do not add any greeting, welcome line, time-of-day opener, or host intro such as "good morning" or "good evening". Start directly with the story content. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article. Keep it under 2000 characters.\n\nOriginal copy:\n${text}`
            ,
        },
      ],
      temperature: 0.55,
    }),
  })

  if (!resp.ok) {
    throw new Error('Azure OpenAI TTS rewrite failed with status ' + resp.status)
  }

  const data = await resp.json()
  return cleanTtsRewriteResponse(data.choices?.[0]?.message?.content || '')
}

async function requestSiliconFlowTtsRewrite(text, mode = 'listen', allowGreeting = mode === 'listen', maxChars = 2000) {
  const charLimit = Math.max(200, Math.min(2000, maxChars))
  const brevityHint = charLimit < 400 ? ' Be very concise: one or two sentences that capture only the most essential fact.' : charLimit < 800 ? ' Be brief: a few clear sentences with the key facts, no extra context.' : ''
  const styleGuide = mode === 'watch'
    ? 'Rewrite this as natural spoken narration for a short news video scene. Make it sound like a confident human presenter speaking in one take: clear, modern, lightly dynamic, and easy to follow aloud.'
    : 'Rewrite this as natural spoken narration for a podcast-style news host. Make it sound like one smart host talking conversationally: warm, fluid, lightly interpretive, and easy to stay with for a minute or two.'

  const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [
        {
          role: 'system',
          content: mode === 'watch'
            ? 'You rewrite existing spoken copy for text-to-speech. Preserve every factual claim. Do not add facts. Do not use lists, markdown, labels, quotes, or stage directions. Return plain text only. Prefer short-to-medium sentences with varied rhythm. Remove repetitive framing, stiff transitions, and overly formal wording. Keep it easy to say aloud in one pass.'
            : 'You rewrite existing spoken copy for text-to-speech. Preserve every factual claim. Do not add facts. Do not use lists, markdown, labels, quotes, or stage directions. Return plain text only. Make it sound like a polished podcast host speaking naturally to listeners, not reading a script. Use smooth transitions, occasional gentle emphasis, and a conversational cadence. Avoid newsroom phrasing, robotic signposting, and repetitive sentence openings. Keep it easy to say aloud in one pass.',
        },
        {
          role: 'user',
          content: mode === 'watch'
            ? `${styleGuide} Do not add any greeting, welcome line, time-of-day opener, or host intro such as "good morning" or "good evening". Start directly with the story. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article.${brevityHint} Keep it under ${charLimit} characters.\n\nOriginal copy:\n${text}`
            : allowGreeting
              ? `${styleGuide} If the source already starts with a greeting, date line, or weather line, preserve that opening verbatim and only smooth the rest of the narration around it. Do not change the time-of-day greeting or weather facts. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article.${brevityHint} Keep it under ${charLimit} characters.\n\nOriginal copy:\n${text}`
              : `${styleGuide} Do not add any greeting, welcome line, time-of-day opener, or host intro such as "good morning" or "good evening". Start directly with the story content. Keep the meaning and roughly the same length, but make the phrasing more human. Avoid sounding like a template, a list, or a written article.${brevityHint} Keep it under ${charLimit} characters.\n\nOriginal copy:\n${text}`
            ,
        },
      ],
      temperature: 0.55,
    }),
  })

  if (!resp.ok) {
    throw new Error('SiliconFlow TTS rewrite failed with status ' + resp.status)
  }

  const data = await resp.json()
  return cleanTtsRewriteResponse(data.choices?.[0]?.message?.content || '')
}

async function rewriteTtsNarration(text, mode = 'listen', allowGreeting = mode === 'listen', maxChars = 2000) {
  const sourceText = String(text || '').trim()
  if (!sourceText) return ''
  if (!SILICONFLOW_API_KEY && !hasAzureOpenAIConfig()) return sourceText

  const cacheKey = `${mode}::${allowGreeting ? 'greet' : 'plain'}::${maxChars}::${sourceText}`
  if (ttsRewriteCache[cacheKey] && Date.now() - ttsRewriteCache[cacheKey].ts < ANALYZE_CACHE_TTL) {
    return ttsRewriteCache[cacheKey].data
  }
  if (pendingTtsRewriteRequests[cacheKey]) return pendingTtsRewriteRequests[cacheKey]

  pendingTtsRewriteRequests[cacheKey] = (async () => {
    try {
      let rewritten = ''

      if (SILICONFLOW_API_KEY) {
        try {
          rewritten = await requestSiliconFlowTtsRewrite(sourceText, mode, allowGreeting, maxChars)
        } catch (error) {
          console.error('Qwen TTS rewrite error:', error.message)
        }
      }

      if (!rewritten && hasAzureOpenAIConfig()) {
        rewritten = await requestAzureTtsRewrite(sourceText, mode, allowGreeting, maxChars)
      }

      const result = mode === 'watch'
        ? stripWatchGreeting(rewritten || sourceText)
        : allowGreeting
          ? (rewritten || sourceText)
          : stripLeadingGreeting(rewritten || sourceText)
      ttsRewriteCache[cacheKey] = { ts: Date.now(), data: result }
      return result
    } catch (error) {
      console.error('TTS rewrite error:', error.message)
      ttsRewriteCache[cacheKey] = { ts: Date.now(), data: sourceText }
      return sourceText
    } finally {
      delete pendingTtsRewriteRequests[cacheKey]
    }
  })()

  return pendingTtsRewriteRequests[cacheKey]
}

async function requestSiliconFlowAnalysis(prompt) {
  const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SILICONFLOW_API_KEY}`
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    })
  })

  if (!resp.ok) {
    throw new Error('SiliconFlow request failed with status ' + resp.status)
  }

  const data = await resp.json()
  return parseAnalysisResponse(data.choices?.[0]?.message?.content || '')
}

function resolveAzureSpeechVoice(requestedVoice) {
  const voice = String(requestedVoice || '').trim()
  if (voice && AZURE_SPEECH_VOICES.includes(voice)) return voice
  return AZURE_SPEECH_VOICE
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(value, fallbackMs) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return Math.max(fallbackMs, numeric * 1000)

  const timestamp = Date.parse(String(value || ''))
  if (Number.isFinite(timestamp)) {
    return Math.max(fallbackMs, timestamp - Date.now())
  }

  return fallbackMs
}

function enqueueAzureSpeech(task) {
  const run = azureSpeechQueue
    .catch(() => undefined)
    .then(async () => {
      const waitMs = Math.max(0, (azureSpeechLastRequestAt + AZURE_SPEECH_MIN_INTERVAL_MS) - Date.now())
      if (waitMs > 0) {
        await sleep(waitMs)
      }
      azureSpeechLastRequestAt = Date.now()
      return task()
    })

  azureSpeechQueue = run.catch(() => undefined)
  return run
}

async function synthesizeAzureSpeech(text, voiceName) {
  const selectedVoice = resolveAzureSpeechVoice(voiceName)
  const ssml = `<?xml version="1.0" encoding="utf-8"?><speak version="1.0" xml:lang="en-US"><voice name="${selectedVoice}"><prosody rate="0%" pitch="0%">${escapeSsml(text)}</prosody></voice></speak>`
  for (let attempt = 0; attempt <= AZURE_SPEECH_MAX_RETRIES; attempt += 1) {
    const resp = await enqueueAzureSpeech(() => fetch(AZURE_SPEECH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': AZURE_SPEECH_OUTPUT_FORMAT,
        'User-Agent': 'NewsFlow',
      },
      body: ssml,
    }))

    if (resp.ok) {
      return {
        audioBuffer: Buffer.from(await resp.arrayBuffer()),
        voiceName: selectedVoice,
      }
    }

    const shouldRetry = [429, 500, 502, 503, 504].includes(resp.status) && attempt < AZURE_SPEECH_MAX_RETRIES
    if (!shouldRetry) {
      throw new Error('Azure Speech request failed with status ' + resp.status)
    }

    const fallbackDelayMs = AZURE_SPEECH_RETRY_BASE_DELAY_MS * (attempt + 1)
    const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'), fallbackDelayMs)
    await sleep(retryAfterMs)
  }

  throw new Error('Azure Speech request failed after retries')
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

function getAttr(node, key) {
  if (!node) return undefined
  if (typeof node[key] !== 'undefined') return node[key]
  if (node.$ && typeof node.$[key] !== 'undefined') return node.$[key]
  return undefined
}

function normalizeImageUrl(url) {
  if (!url) return null

  try {
    const parsed = new URL(url)

    if (parsed.hostname.includes('bbci.co.uk') || parsed.hostname.includes('bbc.com')) {
      parsed.pathname = parsed.pathname.replace(/\/ace\/standard\/\d+\//, '/news/1024/')
      parsed.searchParams.delete('imwidth')
    }

    if (parsed.hostname.includes('futurecdn.net') || parsed.hostname.includes('vox-cdn.com')) {
      parsed.searchParams.set('w', '1600')
      parsed.searchParams.delete('h')
      parsed.searchParams.delete('fit')
      parsed.searchParams.delete('crop')
    }

    if (parsed.hostname.includes('cdn.cnn.com') || parsed.hostname.includes('image.cnbcfm.com')) {
      parsed.searchParams.set('w', '1600')
      parsed.searchParams.set('h', '900')
    }

    return parsed.toString()
  } catch {
    return url
  }
}

function resolveUrl(url, baseUrl) {
  if (!url) return null

  try {
    return new URL(url, baseUrl).toString()
  } catch {
    return null
  }
}

function scoreImageCandidate(candidate) {
  const width = Number(getAttr(candidate, 'width') || 0)
  const height = Number(getAttr(candidate, 'height') || 0)
  const url = String(candidate.url || '')
  let score = width * height

  if (!score) score = width || height || 0
  if (/thumbnail|thumb|small|square/i.test(url)) score -= 500000
  if (/webp/i.test(url)) score += 25000
  if (/og-image|social|hero|lead/i.test(url)) score += 100000

  return score
}

function getImageCandidates(item) {
  const candidates = []

  if (item.enclosure?.url) {
    candidates.push({
      url: item.enclosure.url,
      width: Number(item.enclosure.length) || 0,
      height: 0
    })
  }

  for (const node of toArray(item['media:content'])) {
    const url = getAttr(node, 'url')
    if (!url) continue
    candidates.push({
      url,
      width: Number(getAttr(node, 'width') || 0),
      height: Number(getAttr(node, 'height') || 0)
    })
  }

  for (const node of toArray(item['media:thumbnail'])) {
    const url = getAttr(node, 'url')
    if (!url) continue
    candidates.push({
      url,
      width: Number(getAttr(node, 'width') || 0),
      height: Number(getAttr(node, 'height') || 0)
    })
  }

  for (const node of toArray(item['media:group']?.['media:content'])) {
    const url = getAttr(node, 'url')
    if (!url) continue
    candidates.push({
      url,
      width: Number(getAttr(node, 'width') || 0),
      height: Number(getAttr(node, 'height') || 0)
    })
  }

  return candidates
}

function looksLowRes(url) {
  return /thumbnail|thumb|small|square|\/standard\/\d{2,4}\b|[-_/]\d{2,4}x\d{2,4}\b|(?:^|[?&])(w|width|imwidth)=\d{1,3}\b|(?:^|[?&])resize=\d{1,3},\d{1,3}\b/i.test(String(url || ''))
}

function getImageDimensionHint(url) {
  const value = String(url || '')
  const dimensionMatch = value.match(/(\d{3,4})x(\d{3,4})/i)
  if (dimensionMatch) return Math.max(Number(dimensionMatch[1]), Number(dimensionMatch[2]))

  const sizedPathMatch = value.match(/\/news\/(\d{3,4})\//i)
  if (sizedPathMatch) return Number(sizedPathMatch[1])

  const queryMatch = value.match(/[?&](?:w|width|imwidth)=(\d{3,4})\b/i) || value.match(/[?&]resize=(\d{3,4}),\d{3,4}\b/i)
  if (queryMatch) return Number(queryMatch[1])

  return 0
}

function getImageQualityMeta(url) {
  if (!url) return { label: 'fallback', score: 0 }

  const dimension = getImageDimensionHint(url)
  if (dimension >= 1100) return { label: 'high', score: 100 }
  if (dimension >= 800) return { label: 'medium', score: 70 }
  if (looksLowRes(url)) return { label: 'low', score: 25 }
  if (dimension >= 500) return { label: 'medium', score: 55 }
  return { label: 'low', score: 35 }
}

function parseSrcset(srcset, baseUrl) {
  const candidates = String(srcset || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [rawUrl, descriptor] = entry.split(/\s+/)
      return {
        url: resolveUrl(rawUrl, baseUrl),
        descriptor: descriptor || ''
      }
    })
    .filter((entry) => entry.url)

  candidates.sort((left, right) => {
    const leftWidth = Number((left.descriptor.match(/(\d+)w/i) || [])[1] || 0)
    const rightWidth = Number((right.descriptor.match(/(\d+)w/i) || [])[1] || 0)
    return rightWidth - leftWidth
  })

  return candidates[0]?.url || null
}

function sanitizeCaption(text) {
  const value = String(text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  if (!value || value.length < 12) return ''
  if (/logo|icon|avatar|advert|newsletter/i.test(value)) return ''
  return value.slice(0, 180)
}

function isEditorialImage(url) {
  const value = String(url || '')
  if (!value) return false
  if (!/^https?:/i.test(value)) return false
  if (/logo|icon|avatar|sprite|badge|emoji|pixel|favicon|apple-touch|newsletter|doubleclick|ads|banner/i.test(value)) return false
  if (/\.svg(\?|$)/i.test(value)) return false
  if (/gravatar|youtube\.com\/s\/desktop|ytimg\.com\/vi\//i.test(value)) return false
  return true
}

function dedupeMedia(items) {
  const seen = new Set()
  const result = []

  for (const item of items) {
    const url = normalizeImageUrl(item.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push({ ...item, url })
  }

  return result
}

function normalizeVideoUrl(url, baseUrl) {
  const resolved = resolveUrl(url, baseUrl)
  if (!resolved) return null

  try {
    const parsed = new URL(resolved)
    const host = parsed.hostname.toLowerCase()

    if (host.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id ? `https://www.youtube.com/embed/${id}?rel=0` : resolved
    }

    if (host.includes('youtube.com')) {
      const watchId = parsed.searchParams.get('v')
      const shortsMatch = parsed.pathname.match(/\/shorts\/([^/?]+)/i)
      const embedMatch = parsed.pathname.match(/\/embed\/([^/?]+)/i)
      const id = watchId || shortsMatch?.[1] || embedMatch?.[1]
      return id ? `https://www.youtube.com/embed/${id}?rel=0` : resolved
    }

    if (host.includes('vimeo.com') && !host.includes('player.vimeo.com')) {
      const id = parsed.pathname.replace(/^\//, '').split('/')[0]
      return id ? `https://player.vimeo.com/video/${id}` : resolved
    }

    return resolved
  } catch {
    return resolved
  }
}

function detectVideoProvider(url) {
  const value = String(url || '').toLowerCase()
  if (!value) return 'video'
  if (value.includes('youtube.com') || value.includes('youtu.be')) return 'YouTube'
  if (value.includes('vimeo.com')) return 'Vimeo'
  if (value.includes('dailymotion.com')) return 'Dailymotion'
  if (value.includes('jwplatform.com')) return 'JW Player'
  if (value.includes('brightcove')) return 'Brightcove'
  return 'video'
}

function inferVideoKind(url) {
  const value = String(url || '').toLowerCase()
  if (/\.(mp4|webm|ogg|m3u8)(\?|$)/i.test(value)) return 'video'
  if (/youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|jwplatform\.com|brightcove/i.test(value)) return 'iframe'
  return 'iframe'
}

function scoreVideoCandidate(candidate) {
  let score = 0
  const value = String(candidate.url || '')
  const kind = candidate.kind || inferVideoKind(value)

  if (kind === 'video') score += 140
  if (/youtube|youtu\.be|vimeo/i.test(value)) score += 120
  if (/og:video|videoobject|twitter:player/i.test(candidate.origin || '')) score += 90
  if (/\.mp4(\?|$)/i.test(value)) score += 60
  if (/autoplay=1/i.test(value)) score += 10
  if (/ads|doubleclick|banner/i.test(value)) score -= 180

  return score
}

function extractArticleVideoFromHtml(html, pageUrl) {
  const candidates = []
  const pushCandidate = (url, extra = {}) => {
    const normalized = normalizeVideoUrl(url, pageUrl)
    if (!normalized) return
    if (!/^https?:/i.test(normalized)) return
    candidates.push({
      url: normalized,
      kind: extra.kind || inferVideoKind(normalized),
      provider: extra.provider || detectVideoProvider(normalized),
      poster: extra.poster ? resolveUrl(extra.poster, pageUrl) : undefined,
      title: extra.title || '',
      origin: extra.origin || '',
    })
  }

  const metaTagPattern = /<meta\b[^>]*>/gi
  const videoTagPattern = /<video\b[^>]*>[\s\S]*?<\/video>/gi
  const iframeTagPattern = /<iframe\b[^>]*>/gi
  const scriptTagPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  const attr = (tag, name) => {
    const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
    return match?.[1] || ''
  }

  for (const tag of html.match(metaTagPattern) || []) {
    const property = `${attr(tag, 'property')} ${attr(tag, 'name')}`.toLowerCase()
    const content = attr(tag, 'content')
    if (!property || !content) continue
    if (/og:video|og:video:url|og:video:secure_url|twitter:player/.test(property)) {
      pushCandidate(content, { origin: property })
    }
  }

  for (const tag of html.match(videoTagPattern) || []) {
    const poster = attr(tag, 'poster')
    const directSrc = attr(tag, 'src')
    if (directSrc) {
      pushCandidate(directSrc, { kind: 'video', poster, origin: 'video-tag' })
    }

    for (const sourceTag of tag.match(/<source\b[^>]*>/gi) || []) {
      const src = attr(sourceTag, 'src')
      if (src) {
        pushCandidate(src, { kind: 'video', poster, origin: 'video-source' })
      }
    }
  }

  for (const tag of html.match(iframeTagPattern) || []) {
    const src = attr(tag, 'src')
    if (!src) continue
    if (!/youtube|youtu\.be|vimeo|dailymotion|jwplayer|brightcove|player/i.test(src)) continue
    pushCandidate(src, { kind: 'iframe', origin: 'iframe' })
  }

  for (const match of html.matchAll(scriptTagPattern)) {
    const raw = match[1]
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : node['@type']
        if (!/VideoObject/i.test(String(type || ''))) continue
        pushCandidate(node.embedUrl || node.contentUrl || node.url, {
          kind: node.contentUrl ? 'video' : 'iframe',
          poster: node.thumbnailUrl,
          title: node.name,
          origin: 'VideoObject',
        })
      }
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }

  const unique = []
  const seen = new Set()
  for (const candidate of candidates) {
    if (!candidate.url || seen.has(candidate.url)) continue
    seen.add(candidate.url)
    unique.push(candidate)
  }

  const best = unique.sort((left, right) => scoreVideoCandidate(right) - scoreVideoCandidate(left))[0]
  if (!best) return null

  return {
    url: best.url,
    kind: best.kind,
    provider: best.provider,
    poster: best.poster || '',
    title: best.title || '',
    source: 'article',
  }
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeSearchText(text) {
  return normalizeWhitespace(text)
    .replace(/["'“”‘’():!?.,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSearchTerms(title, category) {
  const tokens = sanitizeSearchText(`${title || ''} ${category || ''}`)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !TITLE_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))

  return tokens.filter((token, index) => tokens.indexOf(token) === index).slice(0, 6)
}

function buildYouTubeSearchTerms(title, category, source) {
  const sourceText = sanitizeSearchText(source || '').replace(/news|media|network|post|times|journal|press/gi, ' ').trim()
  const terms = extractSearchTerms(title, category)
  const compactTitle = sanitizeSearchText(title || '')
  const categoryText = sanitizeSearchText(category || '')

  return [
    compactTitle,
    [terms.slice(0, 4).join(' '), categoryText].filter(Boolean).join(' '),
    [terms.slice(0, 3).join(' '), sourceText].filter(Boolean).join(' '),
  ]
    .map((value) => sanitizeSearchText(value))
    .filter((value, index, collection) => value && collection.indexOf(value) === index)
}

function buildYouTubeSearchCacheKey({ title, category, source, limit }) {
  return JSON.stringify({
    title: sanitizeSearchText(title || ''),
    category: sanitizeSearchText(category || ''),
    source: sanitizeSearchText(source || ''),
    limit: Number(limit) || 1,
  })
}

function parseIso8601DurationToSeconds(value) {
  const match = String(value || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (!match) return 0

  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  return hours * 3600 + minutes * 60 + seconds
}

function scoreYouTubeCandidate(candidate, options = {}) {
  const haystack = [
    candidate.title,
    candidate.description,
    candidate.channelTitle,
    ...(candidate.tags || []),
  ].join(' ').toLowerCase()
  const tokens = extractSearchTerms(options.title, options.category)
  let score = 0

  for (const token of tokens) {
    if (haystack.includes(token.toLowerCase())) score += 20
  }

  const normalizedArticleTitle = sanitizeSearchText(options.title || '').toLowerCase()
  const normalizedVideoTitle = sanitizeSearchText(candidate.title || '').toLowerCase()
  if (normalizedArticleTitle && normalizedVideoTitle && normalizedVideoTitle.includes(normalizedArticleTitle)) {
    score += 80
  }

  if (candidate.channelTitle && options.source) {
    const normalizedChannel = sanitizeSearchText(candidate.channelTitle).toLowerCase()
    const normalizedSource = sanitizeSearchText(options.source).toLowerCase()
    if (normalizedChannel && normalizedSource && (normalizedChannel.includes(normalizedSource) || normalizedSource.includes(normalizedChannel))) {
      score += 30
    }
  }

  if (/news|live|breaking|report|analysis|update|highlights/i.test(candidate.title || '')) score += 10
  if (candidate.durationSeconds >= 45 && candidate.durationSeconds <= 900) score += 15
  if (candidate.durationSeconds > 1800) score -= 20

  return score
}

async function searchYouTubeVideos(title, category, source, limit = 1) {
  if (!hasYouTubeDataApiConfig()) return []

  const cacheKey = buildYouTubeSearchCacheKey({ title, category, source, limit })
  if (youtubeSearchCache[cacheKey] && Date.now() - youtubeSearchCache[cacheKey].ts < CACHE_TTL) {
    return youtubeSearchCache[cacheKey].data
  }
  if (pendingYouTubeSearchRequests[cacheKey]) return pendingYouTubeSearchRequests[cacheKey]

  pendingYouTubeSearchRequests[cacheKey] = (async () => {
    try {
      const queries = buildYouTubeSearchTerms(title, category, source)
      const rawCandidates = []
      const seenIds = new Set()

      for (const query of queries) {
        if (rawCandidates.length >= Math.max(8, limit * 3)) break

        const url = new URL('https://www.googleapis.com/youtube/v3/search')
        url.searchParams.set('part', 'snippet')
        url.searchParams.set('type', 'video')
        url.searchParams.set('videoEmbeddable', 'true')
        url.searchParams.set('safeSearch', 'moderate')
        url.searchParams.set('maxResults', String(Math.min(8, Math.max(limit * 3, 4))))
        url.searchParams.set('order', 'relevance')
        url.searchParams.set('q', query)
        url.searchParams.set('key', YOUTUBE_DATA_API_KEY)

        const resp = await fetch(url.toString(), { headers: IMAGE_HEADERS })
        if (!resp.ok) {
          throw new Error('YouTube search failed with status ' + resp.status)
        }

        const data = await resp.json()
        for (const item of data.items || []) {
          const videoId = item?.id?.videoId
          if (!videoId || seenIds.has(videoId)) continue

          seenIds.add(videoId)
          rawCandidates.push({
            id: videoId,
            title: item?.snippet?.title || '',
            description: item?.snippet?.description || '',
            channelTitle: item?.snippet?.channelTitle || '',
            thumbnail: item?.snippet?.thumbnails?.high?.url || item?.snippet?.thumbnails?.medium?.url || item?.snippet?.thumbnails?.default?.url || '',
          })
        }
      }

      if (!rawCandidates.length) {
        youtubeSearchCache[cacheKey] = { ts: Date.now(), data: [] }
        return []
      }

      const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos')
      detailsUrl.searchParams.set('part', 'snippet,contentDetails,status')
      detailsUrl.searchParams.set('id', rawCandidates.map((item) => item.id).join(','))
      detailsUrl.searchParams.set('key', YOUTUBE_DATA_API_KEY)

      const detailsResp = await fetch(detailsUrl.toString(), { headers: IMAGE_HEADERS })
      if (!detailsResp.ok) {
        throw new Error('YouTube video details failed with status ' + detailsResp.status)
      }

      const detailsData = await detailsResp.json()
      const detailsById = new Map((detailsData.items || []).map((item) => [item.id, item]))

      const ranked = rawCandidates
        .map((candidate) => {
          const details = detailsById.get(candidate.id)
          const tags = Array.isArray(details?.snippet?.tags) ? details.snippet.tags : []

          return {
            url: `https://www.youtube.com/embed/${candidate.id}?rel=0`,
            kind: 'iframe',
            provider: 'YouTube',
            title: candidate.title,
            poster: normalizeImageUrl(candidate.thumbnail),
            channelTitle: candidate.channelTitle,
            description: candidate.description,
            tags,
            durationSeconds: parseIso8601DurationToSeconds(details?.contentDetails?.duration),
            embeddable: details?.status?.embeddable !== false,
            source: 'youtube-search',
          }
        })
        .filter((candidate) => candidate.embeddable)
        .sort((left, right) => scoreYouTubeCandidate(right, { title, category, source }) - scoreYouTubeCandidate(left, { title, category, source }))
        .slice(0, Math.max(1, limit))
        .map(({ channelTitle, description, tags, durationSeconds, embeddable, ...video }) => video)

      youtubeSearchCache[cacheKey] = { ts: Date.now(), data: ranked }
      return ranked
    } finally {
      delete pendingYouTubeSearchRequests[cacheKey]
    }
  })()

  return pendingYouTubeSearchRequests[cacheKey]
}

function buildStockImageQueries(title, category) {
  const titleQuery = sanitizeSearchText(title || '')
  const categoryQuery = sanitizeSearchText(category || '')
  const terms = extractSearchTerms(title, category)
  const queries = [
    titleQuery,
    terms.slice(0, 4).join(' '),
    [terms[0], terms[1], categoryQuery].filter(Boolean).join(' '),
    [terms[0], categoryQuery].filter(Boolean).join(' '),
  ].filter((query) => query && query.length >= 3)

  return queries.filter((query, index) => queries.indexOf(query) === index)
}

function buildMediaCacheKey(link, options = {}) {
  return JSON.stringify({
    link: String(link || '').trim(),
    title: sanitizeSearchText(options.title || ''),
    category: sanitizeSearchText(options.category || ''),
    primaryImage: normalizeImageUrl(options.primaryImage) || '',
  })
}

function buildGuaranteedFallbackImages(title, category, count, excludeUrls = []) {
  const neededCount = Math.max(0, Number(count) || 0)
  if (!neededCount) return []

  const tags = extractSearchTerms(title, category)
  const seedBase = sanitizeSearchText([title, category, ...tags].filter(Boolean).join(' '))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'newsflow'
  const seen = new Set(
    excludeUrls
      .map((url) => normalizeImageUrl(url))
      .filter(Boolean)
  )
  const fallback = []

  for (let index = 0; fallback.length < neededCount; index += 1) {
    const candidate = `https://picsum.photos/seed/${seedBase}-${index + 1}/1600/900`
    if (seen.has(candidate)) continue
    seen.add(candidate)
    fallback.push({ url: candidate, caption: '' })
  }

  return fallback
}

function ensureDistinctMediaTarget(items, count, options = {}) {
  const neededCount = Math.max(0, Number(count) || 0)
  if (!neededCount) return []

  const excludeUrls = (options.excludeUrls || [])
    .map((url) => normalizeImageUrl(url))
    .filter(Boolean)
  const seen = new Set(excludeUrls)
  const normalizedItems = []

  for (const item of items || []) {
    const url = normalizeImageUrl(item?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    normalizedItems.push({ ...item, url })
    if (normalizedItems.length >= neededCount) break
  }

  if (normalizedItems.length >= neededCount) {
    return normalizedItems.slice(0, neededCount)
  }

  const fallbackItems = buildGuaranteedFallbackImages(
    options.title,
    options.category,
    neededCount - normalizedItems.length,
    Array.from(seen),
  )

  return normalizedItems.concat(fallbackItems).slice(0, neededCount)
}

async function searchUnsplashImages(query, limit = 8) {
  const normalizedQuery = sanitizeSearchText(query || '')
  if (!normalizedQuery) return []

  if (!UNSPLASH_ACCESS_KEY) {
    return []
  }

  const searchUrl = new URL('https://api.unsplash.com/search/photos')
  searchUrl.searchParams.set('query', normalizedQuery)
  searchUrl.searchParams.set('per_page', String(Math.max(1, Math.min(limit, 30))))
  searchUrl.searchParams.set('orientation', 'landscape')
  searchUrl.searchParams.set('content_filter', 'high')

  const resp = await fetch(searchUrl.toString(), {
    headers: {
      ...IMAGE_HEADERS,
      Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      'Accept-Version': 'v1',
    },
  })

  if (!resp.ok) {
    throw new Error('Unsplash image search failed with status ' + resp.status)
  }

  const data = await resp.json()
  return (data?.results || [])
    .map((item) => ({
      url: normalizeImageUrl(item?.urls?.regular || item?.urls?.full || item?.urls?.raw || ''),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
      title: String(item?.alt_description || item?.description || normalizedQuery),
    }))
    .filter((item) => isEditorialImage(item.url))
    .filter((item) => item.width >= 1000 || item.height >= 700)
    .filter((item) => item.width === 0 || item.height === 0 || item.width / Math.max(item.height, 1) >= 1.15)
}

async function searchPexelsImages(query, limit = 8) {
  const normalizedQuery = sanitizeSearchText(query || '')
  if (!normalizedQuery || !PEXELS_API_KEY) return []

  const searchUrl = new URL('https://api.pexels.com/v1/search')
  searchUrl.searchParams.set('query', normalizedQuery)
  searchUrl.searchParams.set('per_page', String(Math.max(1, Math.min(limit, 30))))
  searchUrl.searchParams.set('orientation', 'landscape')

  const resp = await fetch(searchUrl.toString(), {
    headers: {
      ...IMAGE_HEADERS,
      Authorization: PEXELS_API_KEY,
    },
  })

  if (!resp.ok) {
    throw new Error('Pexels image search failed with status ' + resp.status)
  }

  const data = await resp.json()
  return (data?.photos || [])
    .map((item) => ({
      url: normalizeImageUrl(item?.src?.landscape || item?.src?.large2x || item?.src?.large || item?.src?.original || ''),
      width: Number(item?.width || 0),
      height: Number(item?.height || 0),
      title: String(item?.alt || normalizedQuery),
    }))
    .filter((item) => isEditorialImage(item.url))
    .filter((item) => item.width >= 1000 || item.height >= 700)
    .filter((item) => item.width === 0 || item.height === 0 || item.width / Math.max(item.height, 1) >= 1.15)
}

async function searchWikimediaCommonsImages(query, limit = 8) {
  const normalizedQuery = sanitizeSearchText(query || '')
  if (!normalizedQuery) return []

  const resp = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(`${normalizedQuery} filetype:bitmap -logo -flag -icon -map -diagram`)}&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size&iiurlwidth=2000&format=json&origin=*`,
    { headers: IMAGE_HEADERS }
  )

  if (!resp.ok) {
    throw new Error('Wikimedia Commons image search failed with status ' + resp.status)
  }

  const data = await resp.json()
  const pages = Object.values(data?.query?.pages || {})

  return pages
    .map((page) => {
      const info = page?.imageinfo?.[0]
      const url = normalizeImageUrl(info?.thumburl || info?.url)
      return {
        url,
        width: Number(info?.thumbwidth || info?.width || 0),
        height: Number(info?.thumbheight || info?.height || 0),
        title: String(page?.title || normalizedQuery),
      }
    })
    .filter((item) => isEditorialImage(item.url))
    .filter((item) => item.width >= 1000 || item.height >= 700)
    .filter((item) => item.width === 0 || item.height === 0 || item.width / Math.max(item.height, 1) >= 1.15)
}

async function getSupplementalStockImages(title, category, count, excludeUrls = []) {
  const neededCount = Math.max(0, Math.min(Number(count) || 0, STOCK_IMAGE_TARGET))
  if (!neededCount) return []

  const normalizedExclude = excludeUrls
    .map((url) => normalizeImageUrl(url))
    .filter(Boolean)
  const cacheKey = JSON.stringify({
    title: sanitizeSearchText(title || ''),
    category: sanitizeSearchText(category || ''),
    count: neededCount,
    exclude: normalizedExclude.slice().sort(),
  })

  if (stockImageCache[cacheKey] && Date.now() - stockImageCache[cacheKey].ts < ANALYZE_CACHE_TTL) {
    return stockImageCache[cacheKey].data
  }
  if (pendingStockImageRequests[cacheKey]) return pendingStockImageRequests[cacheKey]

  pendingStockImageRequests[cacheKey] = (async () => {
    try {
      const queries = buildStockImageQueries(title, category)
      const chosen = []
      const seen = new Set(normalizedExclude)
      const providers = [
        { name: 'pexels', search: searchPexelsImages },
        { name: 'unsplash', search: searchUnsplashImages },
        { name: 'wikimedia-commons', search: searchWikimediaCommonsImages },
      ]

      for (const query of queries) {
        if (chosen.length >= neededCount) break

        for (const provider of providers) {
          if (chosen.length >= neededCount) break

          try {
            const results = await provider.search(query, 10)
            for (const result of results) {
              if (!result.url || seen.has(result.url)) continue
              seen.add(result.url)
              chosen.push({ url: result.url, caption: '' })
              if (chosen.length >= neededCount) break
            }
          } catch (error) {
            console.warn(`${provider.name} image search failed for query`, query, error.message)
          }
        }
      }

      const ensured = ensureDistinctMediaTarget(chosen, neededCount, {
        title,
        category,
        excludeUrls: normalizedExclude,
      })

      stockImageCache[cacheKey] = { ts: Date.now(), data: ensured }
      return ensured
    } finally {
      delete pendingStockImageRequests[cacheKey]
    }
  })()

  return pendingStockImageRequests[cacheKey]
}

function isBoilerplateParagraph(text) {
  const value = normalizeWhitespace(text).toLowerCase()
  if (!value) return true
  if (value.length < 70) return true
  return /newsletter|subscribe|sign up|advertisement|cookie|all rights reserved|follow us|related article|read more|watch here|click here|photo:|image source|copyright/i.test(value)
}

function scoreContentRoot($, element) {
  const root = $(element)
  const paragraphs = root.find('p').toArray()
  const textLength = paragraphs.reduce((total, paragraph) => total + normalizeWhitespace($(paragraph).text()).length, 0)
  return paragraphs.length * 140 + textLength
}

function extractArticleContentFromHtml(html) {
  const $ = cheerio.load(html)

  $('script, style, noscript, svg, iframe, form, button, nav, footer, aside').remove()
  $('[aria-hidden="true"], .ad, .ads, .advertisement, .promo, .newsletter, .related, .share, .social, .cookie, .paywall').remove()

  const rootSelectors = [
    'article',
    'main',
    '[itemprop="articleBody"]',
    '.article-body',
    '.article__body',
    '.entry-content',
    '.post-content',
    '.story-body',
    '.story-content',
    '.article-content',
    '.c-entry-content',
    '.BodyWrapper',
    '.ArticleBody-articleBody',
    '.body-copy',
    '.article__content',
  ]

  const roots = rootSelectors
    .flatMap((selector) => $(selector).toArray())
    .filter((element, index, collection) => collection.indexOf(element) === index)

  const bestRoot = roots.sort((left, right) => scoreContentRoot($, right) - scoreContentRoot($, left))[0] || $('body').get(0)
  const root = $(bestRoot)

  root.find('figure, figcaption, .caption, .credit, .related, .newsletter, .share, .social, .ad, .advertisement').remove()

  let paragraphs = root.find('p').toArray()
    .map((element) => normalizeWhitespace($(element).text()))
    .filter((text) => !isBoilerplateParagraph(text))

  if (paragraphs.length < 4) {
    paragraphs = $('body').find('p').toArray()
      .map((element) => normalizeWhitespace($(element).text()))
      .filter((text) => !isBoilerplateParagraph(text))
  }

  const dedupedParagraphs = paragraphs.filter((text, index, collection) => collection.indexOf(text) === index).slice(0, 32)
  const byline = normalizeWhitespace(
    $('[rel="author"]').first().text()
    || $('[itemprop="author"]').first().text()
    || $('.byline, .article-byline, .story-byline, .c-byline').first().text()
    || $('meta[name="author"]').attr('content')
  )
  const subtitle = normalizeWhitespace(
    $('meta[property="og:description"]').attr('content')
    || $('meta[name="description"]').attr('content')
    || $('article h2').first().text()
    || $('main h2').first().text()
  )

  return {
    byline: byline || '',
    subtitle: subtitle || '',
    paragraphs: dedupedParagraphs,
  }
}

async function getArticlePage(link) {
  if (!link) return null
  if (pageCache[link] && Date.now() - pageCache[link].ts < CACHE_TTL) {
    return pageCache[link]
  }
  if (pendingPageRequests[link]) return pendingPageRequests[link]

  pendingPageRequests[link] = (async () => {
    try {
      const resp = await fetchWithTimeout(link, { headers: IMAGE_HEADERS }, EXTERNAL_PAGE_FETCH_TIMEOUT_MS)
      if (!resp.ok) return null

      const page = {
        ts: Date.now(),
        url: resp.url || link,
        html: await resp.text(),
      }
      pageCache[link] = page
      return page
    } catch (error) {
      console.warn('article page fetch failed for', link, error.message)
      return null
    } finally {
      delete pendingPageRequests[link]
    }
  })()

  return pendingPageRequests[link]
}

async function getProxiedImage(url) {
  if (!url) return null

  const normalizedUrl = normalizeImageUrl(url)
  if (!normalizedUrl || !/^https?:/i.test(normalizedUrl)) return null

  if (imageProxyCache[normalizedUrl] && Date.now() - imageProxyCache[normalizedUrl].ts < CACHE_TTL) {
    return imageProxyCache[normalizedUrl]
  }
  if (pendingImageProxyRequests[normalizedUrl]) return pendingImageProxyRequests[normalizedUrl]

   const diskCached = await persistentImageCache.get(normalizedUrl, PERSISTENT_ASSET_CACHE_TTL)
   if (diskCached?.buffer) {
    imageProxyCache[normalizedUrl] = diskCached
    return diskCached
   }

  pendingImageProxyRequests[normalizedUrl] = (async () => {
    try {
      const response = await fetchWithTimeout(normalizedUrl, { headers: IMAGE_PROXY_HEADERS }, EXTERNAL_PAGE_FETCH_TIMEOUT_MS)
      if (!response.ok) return null

      const contentType = String(response.headers.get('content-type') || '').toLowerCase()
      if (!contentType.startsWith('image/')) return null

      const result = {
        ts: Date.now(),
        contentType,
        contentLength: response.headers.get('content-length') || '',
        buffer: Buffer.from(await response.arrayBuffer()),
        etag: response.headers.get('etag') || createEtag(`${normalizedUrl}|${contentType}|${response.headers.get('content-length') || ''}`),
        lastModified: response.headers.get('last-modified') || '',
      }

      await persistentImageCache.set(normalizedUrl, result)
      imageProxyCache[normalizedUrl] = result
      return result
    } catch (error) {
      console.warn('image proxy fetch failed for', normalizedUrl, error.message)
      return null
    } finally {
      delete pendingImageProxyRequests[normalizedUrl]
    }
  })()

  return pendingImageProxyRequests[normalizedUrl]
}

function extractArticleMediaFromHtml(html, pageUrl) {
  const media = []
  const visualTagPattern = /<(img|source)\b[^>]*>/gi
  const metaTagPattern = /<meta\b[^>]*>/gi
  const attr = (tag, name) => {
    const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, 'i'))
    return match?.[1] || ''
  }

  for (const tag of html.match(metaTagPattern) || []) {
    const property = `${attr(tag, 'property')} ${attr(tag, 'name')}`.toLowerCase()
    const content = attr(tag, 'content')
    if (!property || !content) continue
    if (!/og:image|twitter:image/.test(property)) continue

    const url = resolveUrl(content, pageUrl)
    if (!isEditorialImage(url)) continue
    media.push({ url, caption: '' })
  }

  for (const tag of html.match(visualTagPattern) || []) {
    const src = attr(tag, 'src')
    const srcset = attr(tag, 'srcset')
    const dataSrc = attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src')
    const dataSrcset = attr(tag, 'data-srcset') || attr(tag, 'data-lazy-srcset')
    const alt = sanitizeCaption(attr(tag, 'alt') || attr(tag, 'title'))
    const pickedUrl = parseSrcset(dataSrcset, pageUrl)
      || parseSrcset(srcset, pageUrl)
      || resolveUrl(dataSrc, pageUrl)
      || resolveUrl(src, pageUrl)
    if (!isEditorialImage(pickedUrl)) continue
    if (looksLowRes(pickedUrl) && getImageDimensionHint(pickedUrl) < 700) continue
    media.push({ url: pickedUrl, caption: alt })
  }

  const jsonLdImageMatches = html.match(/"image"\s*:\s*(\[[^\]]+\]|"[^"]+")/gi) || []
  for (const match of jsonLdImageMatches) {
    const arrayMatches = [...match.matchAll(/https?:[^"\]\s]+/gi)]
    for (const imageMatch of arrayMatches) {
      const url = resolveUrl(imageMatch[0], pageUrl)
      if (!isEditorialImage(url)) continue
      media.push({ url, caption: '' })
    }
  }

  return dedupeMedia(media)
    .filter((item) => getImageQualityMeta(item.url).score >= 40)
    .slice(0, 6)
}

async function getArticleMedia(link, options = {}) {
  if (!link) return []
  const cacheKey = buildMediaCacheKey(link, options)

  if (mediaCache[cacheKey] && Date.now() - mediaCache[cacheKey].ts < CACHE_TTL) {
    return mediaCache[cacheKey].data
  }
  if (pendingMediaRequests[cacheKey]) return pendingMediaRequests[cacheKey]

  pendingMediaRequests[cacheKey] = (async () => {
    try {
      const page = await getArticlePage(link)
      if (!page?.html) return []
      const media = extractArticleMediaFromHtml(page.html, page.url || link)
      const primaryImage = normalizeImageUrl(options.primaryImage)
      const dedupedOriginals = [primaryImage, ...media.map((item) => normalizeImageUrl(item.url))]
        .filter(Boolean)
        .filter((url, index, collection) => collection.indexOf(url) === index)
      const rawMissingCount = Math.max(0, STOCK_IMAGE_TARGET - dedupedOriginals.length)
      const missingCount = dedupedOriginals.length > 0
        ? Math.min(rawMissingCount, MAX_SUPPLEMENTAL_MEDIA_WHEN_ORIGINALS_PRESENT)
        : rawMissingCount
      let supplemental = []

      if (missingCount > 0 && options.title) {
        supplemental = await getSupplementalStockImages(options.title, options.category, missingCount, dedupedOriginals)
      }

      const combinedMedia = ensureDistinctMediaTarget([...media, ...supplemental], Math.max(0, STOCK_IMAGE_TARGET - (primaryImage ? 1 : 0)), {
        title: options.title,
        category: options.category,
        excludeUrls: primaryImage ? [primaryImage] : [],
      })

      mediaCache[cacheKey] = { ts: Date.now(), data: combinedMedia }
      return combinedMedia
    } catch (error) {
      console.warn('article media fetch failed for', link, error.message)
      const fallbackMedia = ensureDistinctMediaTarget([], Math.max(0, STOCK_IMAGE_TARGET - (options.primaryImage ? 1 : 0)), {
        title: options.title,
        category: options.category,
        excludeUrls: options.primaryImage ? [options.primaryImage] : [],
      })
      mediaCache[cacheKey] = { ts: Date.now(), data: fallbackMedia }
      return fallbackMedia
    } finally {
      delete pendingMediaRequests[cacheKey]
    }
  })()

  return pendingMediaRequests[cacheKey]
}

async function getArticleVideo(link) {
  if (!link) return null
  if (videoCache[link] && Date.now() - videoCache[link].ts < CACHE_TTL) {
    return videoCache[link].data
  }
  if (pendingVideoRequests[link]) return pendingVideoRequests[link]

  pendingVideoRequests[link] = (async () => {
    try {
      const page = await getArticlePage(link)
      if (!page?.html) return null
      const video = extractArticleVideoFromHtml(page.html, page.url || link)
      videoCache[link] = { ts: Date.now(), data: video }
      return video
    } catch (error) {
      console.warn('article video fetch failed for', link, error.message)
      videoCache[link] = { ts: Date.now(), data: null }
      return null
    } finally {
      delete pendingVideoRequests[link]
    }
  })()

  return pendingVideoRequests[link]
}

async function getArticleContent(link) {
  if (!link) return { byline: '', subtitle: '', paragraphs: [] }
  if (contentCache[link] && Date.now() - contentCache[link].ts < CACHE_TTL) {
    return contentCache[link].data
  }
  if (pendingContentRequests[link]) return pendingContentRequests[link]

  pendingContentRequests[link] = (async () => {
    try {
      const page = await getArticlePage(link)
      if (!page?.html) return { byline: '', subtitle: '', paragraphs: [] }

      const content = extractArticleContentFromHtml(page.html)
      contentCache[link] = { ts: Date.now(), data: content }
      return content
    } catch (error) {
      console.warn('article content fetch failed for', link, error.message)
      const fallback = { byline: '', subtitle: '', paragraphs: [] }
      contentCache[link] = { ts: Date.now(), data: fallback }
      return fallback
    } finally {
      delete pendingContentRequests[link]
    }
  })()

  return pendingContentRequests[link]
}

function extractImage(item) {
  const candidates = getImageCandidates(item)
    .map(candidate => ({ ...candidate, url: normalizeImageUrl(candidate.url) }))
    .filter(candidate => candidate.url)
    .sort((left, right) => scoreImageCandidate(right) - scoreImageCandidate(left))

  if (candidates[0]?.url) return candidates[0].url

  const encoded = item['content:encoded'] || item.content || ''
  const m = encoded.match(/<img[^>]+src=["']([^"']+)["']/)
  if (m) return normalizeImageUrl(m[1])

  return null
}

async function extractOgImage(link) {
  if (!link) return null

  if (imageCache[link] && Date.now() - imageCache[link].ts < CACHE_TTL) {
    return imageCache[link].url
  }

  try {
    const resp = await fetchWithTimeout(link, { headers: IMAGE_HEADERS }, OG_IMAGE_FETCH_TIMEOUT_MS)
    if (!resp.ok) return null

    const html = await resp.text()
    const metaPatterns = [
      /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    ]

    for (const pattern of metaPatterns) {
      const match = html.match(pattern)
      if (match?.[1]) {
        const imageUrl = normalizeImageUrl(match[1])
        imageCache[link] = { ts: Date.now(), url: imageUrl }
        return imageUrl
      }
    }
  } catch (error) {
    console.warn('og:image fetch failed for', link, error.message)
  }

  imageCache[link] = { ts: Date.now(), url: null }
  return null
}

async function resolveArticleImage(item, options = {}) {
  const feedImage = extractImage(item)
  if (feedImage && !looksLowRes(feedImage)) return feedImage

  if (options.allowOgFetch === false) return feedImage

  const ogImage = await extractOgImage(item.link)
  return ogImage || feedImage
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 0) {
  const normalizedTimeout = Math.max(0, Number(timeoutMs) || 0)
  if (!normalizedTimeout) {
    return fetch(url, options)
  }

  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(normalizedTimeout),
  })
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker()))
  return results
}

function scoreSourceImageReliability(articles) {
  const sourceStats = new Map()

  for (const article of articles) {
    const current = sourceStats.get(article.source) || { count: 0, withImage: 0, totalQuality: 0 }
    current.count += 1
    if (article.image) current.withImage += 1
    current.totalQuality += article.imageQualityScore || 0
    sourceStats.set(article.source, current)
  }

  return sourceStats
}

function rankArticle(article, sourceStats, index) {
  const source = sourceStats.get(article.source) || { count: 1, withImage: 0, totalQuality: 0 }
  const coverageScore = (source.withImage / source.count) * 40
  const averageQualityScore = source.count ? source.totalQuality / source.count : 0
  const freshnessScore = article.publishedAt ? Math.max(0, 20 - Math.floor((Date.now() - article.publishedAt) / (1000 * 60 * 60 * 12))) : 0
  const varietyScore = Math.max(0, 10 - index)
  const jitter = Math.random() * 6

  return article.imageQualityScore * 1.6 + averageQualityScore * 0.35 + coverageScore + freshnessScore + varietyScore + jitter + (article.sourceRankBias || 0)
}

function isFinanceFeedStory(category, source) {
  return category === 'Finance' || ['Bloomberg Markets', 'WSJ Markets'].includes(String(source || ''))
}

function mixAllCategoryArticles(articles, limit = 20) {
  const targetLimit = Math.max(1, Number(limit) || 20)
  const selected = []
  const selectedIds = new Set()

  for (const category of ALL_CATEGORY_ORDER) {
    const categoryStories = articles
      .filter((article) => article.category === category)
      .slice(0, ALL_MIN_ITEMS_PER_CATEGORY)

    for (const article of categoryStories) {
      if (selectedIds.has(article.id)) continue
      selected.push(article)
      selectedIds.add(article.id)
    }
  }

  const financeSelections = []
  for (const source of ALL_FINANCE_SOURCE_ORDER) {
    const nextFinance = articles.find((article) => article.source === source && !selectedIds.has(article.id))
    if (!nextFinance) continue
    financeSelections.push(nextFinance)
    selectedIds.add(nextFinance.id)
    if (financeSelections.length >= ALL_FINANCE_MIN_ITEMS) break
  }

  return selected
    .concat(financeSelections)
    .concat(articles.filter((article) => !selectedIds.has(article.id)))
    .slice(0, targetLimit)
}

async function buildCategoryArticles(category, feeds) {
  const categoryBudget = CATEGORY_FETCH_BUDGETS[category] || CATEGORY_FETCH_BUDGETS.All
  const results = await Promise.allSettled(
    feeds.map(async f => {
      const feed = await parser.parseURL(f.url)
      const sourceItems = Array.isArray(feed.items) ? feed.items : []
      const filteredItems = typeof f.skipIf === 'function'
        ? sourceItems.filter((item) => !f.skipIf(item))
        : sourceItems
      const feedItemLimit = f.feedItemLimit || categoryBudget.feedItemLimit || 8
      const articleImageLimit = f.articleImageLimit ?? categoryBudget.articleImageLimit ?? feedItemLimit
      const imageFetchConcurrency = f.imageFetchConcurrency || categoryBudget.imageFetchConcurrency || 4
      const feedItems = filteredItems.slice(0, feedItemLimit)

      return mapWithConcurrency(feedItems, imageFetchConcurrency, async (item, index) => {
        const isFinanceStory = isFinanceFeedStory(category, f.name)
        let image = await resolveArticleImage(item, {
          allowOgFetch: index < articleImageLimit
        })
        if (!image && isFinanceStory) {
          const fallbackImages = await getSupplementalStockImages(item.title || '', 'Finance', 1)
          image = fallbackImages[0]?.url || ''
        }
        const imageMeta = getImageQualityMeta(image)
        return {
          id: item.guid || item.link || Math.random().toString(36),
          category: category === 'All' ? (f.categoryLabel || f.name) : category,
          title: item.title || '',
          summary: (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').slice(0, 300),
          keyPoints: [],
          image,
          imageQuality: imageMeta.label,
          imageQualityScore: imageMeta.score,
          source: f.name,
          sourceRankBias: f.rankBias || 0,
          time: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          publishedAt: item.pubDate ? new Date(item.pubDate).getTime() : 0,
          link: item.link || '#',
        }
      })
    })
  )

  let articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)

  articles = articles.filter((a, i, arr) => arr.findIndex(b => b.title === a.title || b.link === a.link) === i)

  const sourceStats = scoreSourceImageReliability(articles)

  articles = articles
    .map((article, index) => ({ ...article, rankScore: rankArticle(article, sourceStats, index) }))
    .sort((a, b) => b.rankScore - a.rankScore)

  if (category === 'All') {
    articles = mixAllCategoryArticles(articles, 22)
  } else {
    articles = articles.slice(0, 20)
  }

  articles = articles
    .map(({ rankScore, publishedAt, imageQualityScore, sourceRankBias, ...article }) => ({ ...article, imageQualityScore }))

  const ok = results.filter(r => r.status === 'fulfilled').length
  const fail = results.filter(r => r.status === 'rejected').length
  const withImg = articles.filter(a => a.image).length
  console.log(`📰 [${category}] ${articles.length} articles (${withImg} with images) from ${ok} feeds (${fail} failed)`)

  cache[category] = { ts: Date.now(), data: articles }
  return articles
}

function warmCategory(category, options = {}) {
  const cacheKey = category
  if (backgroundWarmers[cacheKey]) return backgroundWarmers[cacheKey]

  const feeds = FEEDS[category] || FEEDS['All']
  backgroundWarmers[cacheKey] = buildCategoryArticles(category, feeds)
    .catch((error) => {
      if (!options.silent) {
        console.error(`warm failed for ${category}:`, error.message)
      }
      if (cache[cacheKey]) return cache[cacheKey].data
      throw error
    })
    .finally(() => {
      delete backgroundWarmers[cacheKey]
    })

  return backgroundWarmers[cacheKey]
}

registerNewsRoutes(app, {
  HOST,
  PORT,
  SILICONFLOW_API_KEY,
  cache,
  CACHE_TTL,
  FEEDS,
  pendingNewsRequests,
  warmCategory,
  buildCategoryArticles,
  sendCacheableJson,
  analyzeCache,
  ANALYZE_CACHE_TTL,
  pendingAnalyzeRequests,
  hasAzureOpenAIConfig,
  hasAzureSpeechConfig,
  AZURE_SPEECH_REGION,
  AZURE_SPEECH_ENDPOINT,
  TTS_STRICT_AZURE,
  hasYouTubeDataApiConfig,
  buildFallbackAnalysis,
  requestSiliconFlowAnalysis,
  requestAzureAnalysis,
})

registerMediaRoutes(app, {
  STOCK_IMAGE_TARGET,
  getSupplementalStockImages,
  getArticleMedia,
  sendCacheableJson,
  buildMediaCacheKey,
  getProxiedImage,
  setCacheHeaders,
  matchesIfNoneMatch,
  getArticleVideo,
  hasYouTubeDataApiConfig,
  searchYouTubeVideos,
  buildYouTubeSearchCacheKey,
  getArticleContent,
})

registerTtsRoutes(app, {
  GTTS,
  CACHE_TTL: PERSISTENT_ASSET_CACHE_TTL,
  createEtag,
  isTruthy,
  sendCacheableJson,
  setCacheHeaders,
  matchesIfNoneMatch,
  rewriteTtsNarration,
  TTS_STRICT_AZURE,
  hasAzureSpeechConfig,
  synthesizeAzureSpeech,
  persistentTtsCache,
})

app.listen(PORT, HOST, () => {
  console.log(`📰 NewsFlow API ready on http://${HOST}:${PORT}`)
  void warmCategory('All', { silent: true })
  setInterval(() => {
    void warmCategory('All', { silent: true })
  }, Math.floor(CACHE_TTL / 2))
})
