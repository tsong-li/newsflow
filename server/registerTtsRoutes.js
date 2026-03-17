function registerTtsRoutes(app, deps) {
  const pendingTtsAudioRequests = {}
  const {
    GTTS,
    CACHE_TTL,
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
  } = deps

  app.get('/api/tts-rewrite', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 2000)
    const rewriteMode = String(req.query.mode || 'listen').trim().toLowerCase() === 'watch' ? 'watch' : 'listen'
    const allowGreeting = rewriteMode === 'watch' ? false : isTruthy(req.query.allowGreeting)
    const maxChars = Math.max(200, Math.min(2000, Number(req.query.maxChars) || 2000))
    if (!text) return res.status(400).json({ error: 'text required' })

    try {
      const rewrittenText = await rewriteTtsNarration(text, rewriteMode, allowGreeting, maxChars)
      return sendCacheableJson(req, res, { text: rewrittenText }, {
        cacheControl: 'private, max-age=3600, stale-while-revalidate=86400',
        etagSeed: `tts-rewrite:${rewriteMode}:${allowGreeting}:${maxChars}:${text}`,
      })
    } catch (error) {
      console.error('tts rewrite endpoint error:', error.message)
      return sendCacheableJson(req, res, { text }, {
        cacheControl: 'private, max-age=300, stale-while-revalidate=1800',
        etagSeed: `tts-rewrite:${rewriteMode}:${allowGreeting}:${maxChars}:${text}:fallback`,
      })
    }
  })

  app.get('/api/tts', async (req, res) => {
    const text = String(req.query.text || '').slice(0, 2000)
    const requestedVoice = String(req.query.voice || '')
    const rewriteRequested = !['0', 'false', 'no', 'off'].includes(String(req.query.rewrite || '').toLowerCase())
    const rewriteMode = String(req.query.mode || 'listen').trim().toLowerCase() === 'watch' ? 'watch' : 'listen'
    const allowGreeting = rewriteMode === 'watch' ? false : isTruthy(req.query.allowGreeting)
    const strictAzure = TTS_STRICT_AZURE || isTruthy(req.query.strictAzure)
    const maxChars = Math.max(200, Math.min(2000, Number(req.query.maxChars) || 2000))
    if (!text) return res.status(400).json({ error: 'text required' })

    const cachePayload = {
      text,
      requestedVoice,
      rewriteRequested,
      rewriteMode,
      allowGreeting,
      strictAzure,
      maxChars,
      provider: hasAzureSpeechConfig() ? 'azure-speech' : 'gtts',
    }
    const ttsCacheKey = JSON.stringify(cachePayload)
    const ttsResponseEtag = createEtag(ttsCacheKey)

    try {
      setCacheHeaders(res, 'private, max-age=3600, stale-while-revalidate=86400', ttsResponseEtag)

      if (matchesIfNoneMatch(req, ttsResponseEtag)) {
        return res.status(304).end()
      }

      const diskCached = await persistentTtsCache.get(ttsCacheKey, CACHE_TTL)
      if (diskCached?.buffer) {
        res.setHeader('Content-Type', diskCached.contentType || 'audio/mpeg')
        res.setHeader('Content-Length', String(diskCached.contentLength || diskCached.buffer.length))
        if (diskCached.provider) res.setHeader('X-TTS-Provider', diskCached.provider)
        if (diskCached.voiceName) res.setHeader('X-TTS-Voice', diskCached.voiceName)
        if (diskCached.rewritten) res.setHeader('X-TTS-Rewritten', diskCached.rewritten)
        if (diskCached.fallbackFrom) res.setHeader('X-TTS-Fallback-From', diskCached.fallbackFrom)
        return res.end(diskCached.buffer)
      }

      const resolvedAudio = pendingTtsAudioRequests[ttsCacheKey] || (async () => {
        const spokenText = rewriteRequested ? await rewriteTtsNarration(text, rewriteMode, allowGreeting, maxChars) : text

        if (hasAzureSpeechConfig()) {
          try {
            const { audioBuffer, voiceName } = await synthesizeAzureSpeech(spokenText, requestedVoice)
            const payload = {
              buffer: audioBuffer,
              contentType: 'audio/mpeg',
              contentLength: audioBuffer.length,
              provider: 'azure-speech',
              voiceName,
              rewritten: rewriteRequested ? 'true' : 'false',
            }
            await persistentTtsCache.set(ttsCacheKey, {
              ...payload,
              etag: ttsResponseEtag,
            })
            return payload
          } catch (error) {
            console.error('Azure Speech error:', error.message)
            if (strictAzure) {
              throw error
            }
          }
        }

        const gtts = new GTTS(spokenText, 'en')
        const chunks = []
        const buffer = await new Promise((resolve, reject) => {
          gtts.stream()
            .on('data', (chunk) => chunks.push(chunk))
            .on('end', () => resolve(Buffer.concat(chunks)))
            .on('error', reject)
        })

        const payload = {
          buffer,
          contentType: 'audio/mpeg',
          contentLength: buffer.length,
          provider: 'gtts',
          rewritten: rewriteRequested ? 'true' : 'false',
          fallbackFrom: 'azure-speech',
        }

        await persistentTtsCache.set(ttsCacheKey, {
          ...payload,
          etag: ttsResponseEtag,
        })

        return payload
      })()
        .finally(() => {
          delete pendingTtsAudioRequests[ttsCacheKey]
        })

      pendingTtsAudioRequests[ttsCacheKey] = resolvedAudio

      try {
        const audioPayload = await resolvedAudio
        res.setHeader('Content-Type', audioPayload.contentType)
        res.setHeader('X-TTS-Provider', audioPayload.provider)
        if (audioPayload.voiceName) res.setHeader('X-TTS-Voice', audioPayload.voiceName)
        if (audioPayload.fallbackFrom) res.setHeader('X-TTS-Fallback-From', audioPayload.fallbackFrom)
        res.setHeader('X-TTS-Rewritten', audioPayload.rewritten)
        res.setHeader('Content-Length', String(audioPayload.contentLength))
        return res.end(audioPayload.buffer)
      } catch (error) {
        return res.status(502).json({
          error: 'Azure Speech failed',
          provider: 'azure-speech',
          detail: error.message,
        })
      }
    } catch (error) {
      console.error('TTS error:', error)
      return res.status(500).json({ error: 'TTS failed' })
    }
  })
}

module.exports = {
  registerTtsRoutes,
}