const crypto = require('crypto')

function createEtag(value) {
  return `W/\"${crypto.createHash('sha1').update(String(value || '')).digest('base64url')}\"`
}

function matchesIfNoneMatch(req, etag) {
  if (!etag) return false

  const header = String(req.headers['if-none-match'] || '')
  if (!header) return false

  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === etag || value === '*')
}

function setCacheHeaders(res, cacheControl, etag, lastModified) {
  if (cacheControl) {
    res.setHeader('Cache-Control', cacheControl)
  }

  if (etag) {
    res.setHeader('ETag', etag)
  }

  if (lastModified) {
    const asDate = new Date(lastModified)
    if (!Number.isNaN(asDate.getTime())) {
      res.setHeader('Last-Modified', asDate.toUTCString())
    }
  }
}

function sendCacheableJson(req, res, data, options = {}) {
  const payload = JSON.stringify(data)
  const etag = createEtag(options.etagSeed || payload)

  setCacheHeaders(
    res,
    options.cacheControl || 'public, max-age=60, stale-while-revalidate=600',
    etag,
    options.lastModified,
  )

  if (matchesIfNoneMatch(req, etag)) {
    return res.status(304).end()
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(payload)
}

module.exports = {
  createEtag,
  matchesIfNoneMatch,
  setCacheHeaders,
  sendCacheableJson,
}