const express = require('express')
const cors = require('cors')
const Parser = require('rss-parser')
const FEEDS = require('./feeds')

const app = express()
app.use(cors())
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
const CACHE_TTL = 10 * 60 * 1000

function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url
  if (item['media:content']?.$.url) return item['media:content'].$.url
  if (item['media:thumbnail']?.$.url) return item['media:thumbnail'].$.url
  if (item['media:group']?.['media:content']?.[0]?.$.url) return item['media:group']['media:content'][0].$.url
  const encoded = item['content:encoded'] || item.content || ''
  const m = encoded.match(/<img[^>]+src=["']([^"']+)["']/)
  if (m) return m[1]
  return null
}

app.get('/api/news', async (req, res) => {
  const category = req.query.category || 'All'
  const feeds = FEEDS[category] || FEEDS['All']
  const cacheKey = category

  if (cache[cacheKey] && Date.now() - cache[cacheKey].ts < CACHE_TTL) {
    return res.json(cache[cacheKey].data)
  }

  const results = await Promise.allSettled(
    feeds.map(async f => {
      const feed = await parser.parseURL(f.url)
      return feed.items.slice(0, 15).map(item => ({
        id: item.guid || item.link || Math.random().toString(36),
        category: category === 'All' ? f.name : category,
        title: item.title || '',
        summary: (item.contentSnippet || item.content || '').replace(/<[^>]*>/g, '').slice(0, 300),
        keyPoints: [],
        image: extractImage(item),
        source: f.name,
        time: item.pubDate ? new Date(item.pubDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
        link: item.link || '#',
      }))
    })
  )

  let articles = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .sort((a, b) => Math.random() - 0.5)
    .slice(0, 20)

  // Log
  const ok = results.filter(r => r.status === 'fulfilled').length
  const fail = results.filter(r => r.status === 'rejected').length
  const withImg = articles.filter(a => a.image).length
  console.log(`📰 [${category}] ${articles.length} articles (${withImg} with images) from ${ok} feeds (${fail} failed)`)

  cache[cacheKey] = { ts: Date.now(), data: articles }
  articles = articles.filter((a, i, arr) => arr.findIndex(b => b.title === a.title || b.link === a.link) === i)
  res.json(articles)
})

// Deep Analysis endpoint
app.get('/api/analyze', async (req, res) => {
  const { title, summary, source } = req.query
  if (!title) return res.status(400).json({ error: 'title required' })

  const prompt = 'You are a news analyst. Analyze this article and respond in JSON only (no markdown):\n\nTitle: ' + title + '\nSource: ' + (source || 'unknown') + '\nSummary: ' + (summary || 'none') + '\n\nRespond with this exact JSON structure:\n{"tldr":"one sentence summary","keyPoints":["point 1","point 2","point 3"],"context":"broader context and implications in 2-3 sentences","sentiment":"Positive or Negative or Neutral","readTime":"X min read","tags":["tag1","tag2"]}'

  try {
    const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer sk-hrauvfwaeyfjlnkhmjgyrodbeykvnboxywpqkgogjeffrgbt'
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    })
    const data = await resp.json()
    const text = data.choices?.[0]?.message?.content || ''
    const clean = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const analysis = JSON.parse(clean)
    res.json(analysis)
  } catch (e) {
    console.error('AI error:', e)
    res.json({
      tldr: summary ? summary.slice(0, 150) + '...' : title,
      keyPoints: ['Reported by ' + (source || 'unknown'), 'AI analysis temporarily unavailable'],
      context: 'Unable to generate AI analysis at this time.',
      sentiment: 'Neutral',
      readTime: '1 min read',
      tags: []
    })
  }
})

// Edge TTS endpoint
app.get('/api/tts', (req, res) => {
  const text = req.query.text
  if (!text) return res.status(400).json({ error: 'text required' })
  const { execFile } = require('child_process')
  const tmp = '/tmp/tts-' + Date.now() + '.mp3'
  execFile('/Users/JZX/.local/bin/edge-tts', [
    '--voice', 'en-US-GuyNeural',
    '--rate', '+50%',
    '--pitch', '+0Hz',
    '--text', text.slice(0, 2000),
    '--write-media', tmp
  ], { timeout: 15000 }, (err) => {
    if (err) {
      console.error('TTS error:', err)
      return res.status(500).json({ error: 'TTS failed' })
    }
    res.sendFile(tmp, () => {
      require('fs').unlink(tmp, () => {})
    })
  })
})

app.listen(3001, () => console.log('📰 NewsFlow API ready on http://localhost:3001'))
