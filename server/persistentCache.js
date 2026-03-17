const fs = require('fs/promises')
const path = require('path')
const { createEtag } = require('./httpCache')

const CACHE_ROOT = path.join(__dirname, '.cache')

function buildCachePaths(namespace, key, extension) {
  const digest = createEtag(`${namespace}:${key}`).replace(/[^a-zA-Z0-9_-]/g, '')
  const dir = path.join(CACHE_ROOT, namespace)
  return {
    dir,
    metaPath: path.join(dir, `${digest}.json`),
    dataPath: path.join(dir, `${digest}.${extension}`),
  }
}

function createPersistentBinaryCache(namespace, extension = 'bin') {
  async function get(key, maxAgeMs) {
    const paths = buildCachePaths(namespace, key, extension)

    try {
      const metaRaw = await fs.readFile(paths.metaPath, 'utf8')
      const meta = JSON.parse(metaRaw)
      if (!meta?.ts || (maxAgeMs > 0 && Date.now() - meta.ts > maxAgeMs)) {
        return null
      }

      const buffer = await fs.readFile(paths.dataPath)
      return { ...meta, buffer }
    } catch {
      return null
    }
  }

  async function set(key, payload) {
    const paths = buildCachePaths(namespace, key, extension)
    const meta = {
      ts: payload.ts || Date.now(),
      contentType: payload.contentType || 'application/octet-stream',
      contentLength: String(payload.contentLength || payload.buffer?.length || ''),
      etag: payload.etag || '',
      lastModified: payload.lastModified || '',
      provider: payload.provider || '',
      voiceName: payload.voiceName || '',
      rewritten: payload.rewritten || '',
      fallbackFrom: payload.fallbackFrom || '',
    }

    await fs.mkdir(paths.dir, { recursive: true })
    await Promise.all([
      fs.writeFile(paths.dataPath, payload.buffer),
      fs.writeFile(paths.metaPath, JSON.stringify(meta)),
    ])

    return { ...meta, buffer: payload.buffer }
  }

  return { get, set }
}

module.exports = {
  createPersistentBinaryCache,
}