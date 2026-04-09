const fs = require('node:fs');
const path = require('node:path');

const TTL_MS = 30 * 60 * 1000; // 30 minutos

// audioId → { filePath, expiresAt }
const store = new Map();

// urlHash → audioId (para reutilizar áudio da mesma URL)
const urlIndex = new Map();

// Limpeza a cada 2 minutos
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (now >= entry.expiresAt) {
      try { fs.unlinkSync(entry.filePath); } catch { /* já deletado */ }
      store.delete(id);
      // Remove do índice de URLs
      for (const [url, uid] of urlIndex.entries()) {
        if (uid === id) { urlIndex.delete(url); break; }
      }
      console.log(`[AudioStore] Expirado e deletado: ${path.basename(entry.filePath)}`);
    }
  }
}, 2 * 60_000).unref();

function register(audioId, filePath, urlKey) {
  store.set(audioId, { filePath, expiresAt: Date.now() + TTL_MS });
  if (urlKey) urlIndex.set(urlKey, audioId);
}

// Retorna { audioId, filePath } se a URL já estiver cacheada, ou null
function findByUrl(urlKey) {
  const audioId = urlIndex.get(urlKey);
  if (!audioId) return null;
  const filePath = get(audioId); // valida TTL
  if (!filePath) return null;
  return { audioId, filePath };
}

function get(audioId) {
  const entry = store.get(audioId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    try { fs.unlinkSync(entry.filePath); } catch { /* já deletado */ }
    store.delete(audioId);
    return null;
  }
  return entry.filePath;
}

function remove(audioId) {
  const entry = store.get(audioId);
  if (entry) {
    try { fs.unlinkSync(entry.filePath); } catch { /* já deletado */ }
    store.delete(audioId);
  }
}

module.exports = { register, get, findByUrl, remove };
