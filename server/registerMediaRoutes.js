function registerMediaRoutes(app, deps) {
  const {
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
  } = deps

  app.get('/api/article-media', async (req, res) => {
    const link = String(req.query.link || '')
    const title = String(req.query.title || '')
    const category = String(req.query.category || '')
    const primaryImage = String(req.query.primaryImage || '')
    if (!link) return res.status(400).json({ error: 'link required' })

    try {
      const media = await getArticleMedia(link, { title, category, primaryImage })
      return sendCacheableJson(req, res, media, {
        cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
        etagSeed: `article-media:${buildMediaCacheKey(link, { title, category, primaryImage })}`,
      })
    } catch (error) {
      console.error('article media error:', error.message)
      return sendCacheableJson(req, res, [], {
        cacheControl: 'public, max-age=60, stale-while-revalidate=300',
        etagSeed: `article-media:${link}:empty`,
      })
    }
  })

  app.get('/api/image', async (req, res) => {
    const url = String(req.query.url || '')
    if (!url) return res.status(400).json({ error: 'url required' })

    try {
      const proxied = await getProxiedImage(url)
      if (!proxied?.buffer) {
        return res.status(502).json({ error: 'image fetch failed' })
      }

      setCacheHeaders(res, 'public, max-age=3600, stale-while-revalidate=86400', proxied.etag, proxied.lastModified || proxied.ts)

      if (matchesIfNoneMatch(req, proxied.etag)) {
        return res.status(304).end()
      }

      res.setHeader('Content-Type', proxied.contentType)
      if (proxied.contentLength) {
        res.setHeader('Content-Length', proxied.contentLength)
      }
      return res.end(proxied.buffer)
    } catch (error) {
      console.error('image proxy error:', error.message)
      return res.status(502).json({ error: 'image proxy failed' })
    }
  })

  app.get('/api/stock-images', async (req, res) => {
    const title = String(req.query.title || '')
    const category = String(req.query.category || '')
    const count = Number(req.query.count || STOCK_IMAGE_TARGET)
    const exclude = Array.isArray(req.query.exclude)
      ? req.query.exclude.map((value) => String(value || ''))
      : req.query.exclude
        ? [String(req.query.exclude || '')]
        : []

    if (!title) return res.status(400).json({ error: 'title required' })

    try {
      return res.json(await getSupplementalStockImages(title, category, count, exclude))
    } catch (error) {
      console.error('stock images error:', error.message)
      return res.json([])
    }
  })

  app.get('/api/article-video', async (req, res) => {
    const link = String(req.query.link || '')
    if (!link) return res.status(400).json({ error: 'link required' })

    try {
      const video = await getArticleVideo(link)
      return sendCacheableJson(req, res, video, {
        cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
        etagSeed: `article-video:${link}`,
      })
    } catch (error) {
      console.error('article video error:', error.message)
      return sendCacheableJson(req, res, null, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=300',
        etagSeed: `article-video:${link}:empty`,
      })
    }
  })

  app.get('/api/youtube-search', async (req, res) => {
    const title = String(req.query.title || '')
    const category = String(req.query.category || '')
    const source = String(req.query.source || '')
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 1, 5))

    if (!title) return res.status(400).json({ error: 'title required' })
    if (!hasYouTubeDataApiConfig()) {
      return sendCacheableJson(req, res, [], {
        cacheControl: 'public, max-age=60, stale-while-revalidate=300',
        etagSeed: `youtube-search:${title}:${category}:${source}:${limit}:disabled`,
      })
    }

    try {
      const videos = await searchYouTubeVideos(title, category, source, limit)
      return sendCacheableJson(req, res, videos, {
        cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
        etagSeed: buildYouTubeSearchCacheKey({ title, category, source, limit }),
      })
    } catch (error) {
      console.error('youtube search error:', error.message)
      return sendCacheableJson(req, res, [], {
        cacheControl: 'public, max-age=60, stale-while-revalidate=300',
        etagSeed: `youtube-search:${title}:${category}:${source}:${limit}:empty`,
      })
    }
  })

  app.get('/api/article-content', async (req, res) => {
    const link = String(req.query.link || '')
    if (!link) return res.status(400).json({ error: 'link required' })

    try {
      const content = await getArticleContent(link)
      return sendCacheableJson(req, res, content, {
        cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
        etagSeed: `article-content:${link}`,
      })
    } catch (error) {
      console.error('article content error:', error.message)
      return sendCacheableJson(req, res, { byline: '', subtitle: '', paragraphs: [] }, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=300',
        etagSeed: `article-content:${link}:empty`,
      })
    }
  })
}

module.exports = {
  registerMediaRoutes,
}