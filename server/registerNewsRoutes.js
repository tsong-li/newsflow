function registerNewsRoutes(app, deps) {
  const {
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
  } = deps

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      service: 'newsflow-api',
      timestamp: new Date().toISOString(),
      host: HOST,
      port: PORT,
      analysisProvider: hasAzureOpenAIConfig()
        ? 'azure-openai'
        : (SILICONFLOW_API_KEY ? 'siliconflow' : 'fallback'),
      ttsProvider: hasAzureSpeechConfig() ? 'azure-speech' : 'gtts',
      azureSpeechConfigured: hasAzureSpeechConfig(),
      azureSpeechRegion: AZURE_SPEECH_REGION || null,
      azureSpeechEndpointConfigured: Boolean(AZURE_SPEECH_ENDPOINT),
      ttsStrictAzure: TTS_STRICT_AZURE,
      youtubeSearchEnabled: hasYouTubeDataApiConfig(),
    })
  })

  app.get('/api/news', async (req, res) => {
    const category = req.query.category || 'All'
    const feeds = FEEDS[category] || FEEDS['All']
    const cacheKey = category

    if (cache[cacheKey] && Date.now() - cache[cacheKey].ts < CACHE_TTL) {
      return sendCacheableJson(req, res, cache[cacheKey].data, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
        etagSeed: `${cacheKey}:${cache[cacheKey].ts}`,
        lastModified: cache[cacheKey].ts,
      })
    }

    if (pendingNewsRequests[cacheKey]) {
      const data = await pendingNewsRequests[cacheKey]
      return sendCacheableJson(req, res, data, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
        etagSeed: `${cacheKey}:pending`,
      })
    }

    if (cache[cacheKey] && cacheKey === 'All') {
      void warmCategory(category, { silent: true })
      return sendCacheableJson(req, res, cache[cacheKey].data, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
        etagSeed: `${cacheKey}:${cache[cacheKey].ts}`,
        lastModified: cache[cacheKey].ts,
      })
    }

    if (cache[cacheKey]) {
      pendingNewsRequests[cacheKey] = buildCategoryArticles(category, feeds)
        .catch((error) => {
          console.error(`refresh failed for ${category}:`, error.message)
          return cache[cacheKey].data
        })
        .finally(() => {
          delete pendingNewsRequests[cacheKey]
        })

      return sendCacheableJson(req, res, cache[cacheKey].data, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
        etagSeed: `${cacheKey}:${cache[cacheKey].ts}`,
        lastModified: cache[cacheKey].ts,
      })
    }

    try {
      pendingNewsRequests[cacheKey] = buildCategoryArticles(category, feeds)
      const data = await pendingNewsRequests[cacheKey]
      return sendCacheableJson(req, res, data, {
        cacheControl: 'public, max-age=60, stale-while-revalidate=600',
        etagSeed: `${cacheKey}:${cache[cacheKey]?.ts || Date.now()}`,
        lastModified: cache[cacheKey]?.ts,
      })
    } catch (error) {
      console.error(`news load failed for ${category}:`, error.message)
      return sendCacheableJson(req, res, [], {
        cacheControl: 'public, max-age=15, stale-while-revalidate=60',
        etagSeed: `${cacheKey}:empty`,
      })
    } finally {
      delete pendingNewsRequests[cacheKey]
    }
  })

  app.get('/api/analyze', async (req, res) => {
    const { title, summary, source } = req.query
    if (!title) return res.status(400).json({ error: 'title required' })
    const cacheKey = [title, summary || '', source || ''].join('||')

    if (analyzeCache[cacheKey] && Date.now() - analyzeCache[cacheKey].ts < ANALYZE_CACHE_TTL) {
      return sendCacheableJson(req, res, analyzeCache[cacheKey].data, {
        cacheControl: 'public, max-age=600, stale-while-revalidate=3600',
        etagSeed: `analyze:${cacheKey}:${analyzeCache[cacheKey].ts}`,
        lastModified: analyzeCache[cacheKey].ts,
      })
    }

    if (pendingAnalyzeRequests[cacheKey]) {
      const data = await pendingAnalyzeRequests[cacheKey]
      return sendCacheableJson(req, res, data, {
        cacheControl: 'public, max-age=600, stale-while-revalidate=3600',
        etagSeed: `analyze:${cacheKey}`,
      })
    }

    const prompt = 'You are a news analyst. Analyze this article and respond in JSON only (no markdown):\n\nTitle: ' + title + '\nSource: ' + (source || 'unknown') + '\nSummary: ' + (summary || 'none') + '\n\nRespond with this exact JSON structure:\n{"tldr":"one sentence summary","keyPoints":["point 1","point 2","point 3"],"context":"broader context and implications in 2-3 sentences","sentiment":"Positive or Negative or Neutral","readTime":"X min read","tags":["tag1","tag2"]}'

    try {
      pendingAnalyzeRequests[cacheKey] = (async () => {
        let parsed = null

        if (SILICONFLOW_API_KEY) {
          try {
            parsed = await requestSiliconFlowAnalysis(prompt)
          } catch (error) {
            console.error('SiliconFlow analyze error:', error.message)
          }
        }

        if (!parsed && hasAzureOpenAIConfig()) {
          try {
            parsed = await requestAzureAnalysis(prompt)
          } catch (error) {
            console.error('Azure OpenAI analyze fallback error:', error.message)
          }
        }

        if (parsed) {
          analyzeCache[cacheKey] = { ts: Date.now(), data: parsed }
          return parsed
        }

        const fallback = buildFallbackAnalysis(title, summary, source)
        analyzeCache[cacheKey] = { ts: Date.now(), data: fallback }
        return fallback
      })()

      return sendCacheableJson(req, res, await pendingAnalyzeRequests[cacheKey], {
        cacheControl: 'public, max-age=600, stale-while-revalidate=3600',
        etagSeed: `analyze:${cacheKey}:${analyzeCache[cacheKey]?.ts || Date.now()}`,
        lastModified: analyzeCache[cacheKey]?.ts,
      })
    } catch (error) {
      console.error('AI error:', error)
      const fallback = buildFallbackAnalysis(title, summary, source)
      analyzeCache[cacheKey] = { ts: Date.now(), data: fallback }
      return sendCacheableJson(req, res, fallback, {
        cacheControl: 'public, max-age=300, stale-while-revalidate=1800',
        etagSeed: `analyze:${cacheKey}:${analyzeCache[cacheKey].ts}`,
        lastModified: analyzeCache[cacheKey].ts,
      })
    } finally {
      delete pendingAnalyzeRequests[cacheKey]
    }
  })
}

module.exports = {
  registerNewsRoutes,
}