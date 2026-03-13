const express = require('express')
const cors = require('cors')
const path = require('path')
const Parser = require('rss-parser')
const FEEDS = require('./feeds')

const app = express()
app.use(cors())
const parser = new Parser({ timeout: 7000 })

const cache = {}
const CACHE_TTL = 10 * 60 * 1000

function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url
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
  let articles = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value)
    .sort(() => Math.random() - 0.5).slice(0, 20)
  const withImg = articles.filter(a => a.image).length
  console.log(`📰 [${category}] ${articles.length} articles (${withImg} img)`)
  cache[cacheKey] = { ts: Date.now(), data: articles }
  res.json(articles)
})

// Serve frontend
app.use(express.static(path.join(__dirname, '..', 'dist')))
app.get('/{*path}', (req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`🚀 NewsFlow running on http://localhost:${PORT}`))
