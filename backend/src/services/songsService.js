const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const SONGS_DIR = path.join(DATA_DIR, 'songs');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'was', 'were', 'from',
  'have', 'has', 'had', 'but', 'not', 'all', 'can', 'out', 'just', 'into', 'about', 'they',
  'them', 'then', 'than', 'when', 'what', 'who', 'where', 'why', 'how', 'his', 'her', 'him',
  'our', 'their', 'its', 'dont', 'cant', 'ive', 'im', 'youre', 'to', 'of', 'in', 'on', 'at',
  'a', 'an', 'is', 'it', 'be', 'as', 'or', 'if', 'no', 'we', 'i', 'me', 'my', 'yo', 'mi',
  'di', 'de', 'inna', 'pon', 'fi', 'dem', 'nah', 'nuh',
]);

// Converte título em nome de arquivo seguro: "Bob Marley - No Woman No Cry" → "bob-marley-no-woman-no-cry.json"
function titleToFilename(titulo) {
  return titulo
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, '')
    .trim()
    .replaceAll(/\s+/g, '-')
    .substring(0, 80) // limite razoável de tamanho
    + '.json';
}

function readAll() {
  if (!fs.existsSync(SONGS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SONGS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SONGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeText(value) {
  return (value ?? '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

function songRelevanceScore(song, queryTokens) {
  if (queryTokens.length === 0) return 0;

  const titleTokens = new Set(tokenize(song.titulo ?? ''));
  const lyricTokens = new Set(tokenize((song.letra_original ?? '').slice(0, 1500)));

  let overlap = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) overlap += 3;
    else if (lyricTokens.has(token)) overlap += 1;
  }
  return overlap;
}

function parseVocabOptions(options) {
  const normalized = typeof options === 'number' ? { maxLines: options } : options;
  return {
    title: normalized.title ?? '',
    originalText: normalized.originalText ?? '',
    maxLines: normalized.maxLines ?? 18,
    maxSongs: normalized.maxSongs ?? 4,
    maxChars: normalized.maxChars ?? 1800,
  };
}

function rankSongsByRelevance(songs, queryTokens, maxSongs) {
  return songs
    .map((song, index) => ({
      song,
      index,
      score: songRelevanceScore(song, queryTokens),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    })
    .slice(0, Math.max(1, maxSongs))
    .map(entry => entry.song);
}

function appendPairsFromSong(song, state, maxLines, maxChars) {
  const enLines = (song.letra_original ?? '').split('\n').filter(l => l.trim());
  const ptLines = (song.letra_traduzida ?? '').split('\n').filter(l => l.trim());
  const count = Math.min(enLines.length, ptLines.length);

  for (let i = 0; i < count && state.pairs.length < maxLines; i++) {
    const en = enLines[i].trim();
    const pt = ptLines[i].trim();
    if (!en || !pt) continue;

    const pairKey = `${en.toLowerCase()}|||${pt.toLowerCase()}`;
    if (state.seenPairs.has(pairKey)) continue;

    const nextPairChars = (`  • "${en}" → "${pt}"\n`).length;
    if (state.usedChars + nextPairChars > maxChars) return true;

    state.seenPairs.add(pairKey);
    state.usedChars += nextPairChars;
    state.pairs.push({ en, pt });
  }

  return state.pairs.length >= maxLines || state.usedChars >= maxChars;
}

function save({ titulo, letra_original, letra_traduzida, analise_de_contexto, notas_culturais }) {
  const all = readAll();

  // Evita duplicata da mesma música
  const existing = all.findIndex(s => s.titulo?.toLowerCase() === titulo?.toLowerCase());
  const entry = {
    id: existing >= 0 ? all[existing].id : uuidv4(),
    savedAt: new Date().toISOString(),
    titulo,
    letra_original,
    letra_traduzida,
    analise_de_contexto,
    notas_culturais,
  };

  if (existing >= 0) {
    all[existing] = entry; // atualiza se já existia
  } else {
    all.push(entry);
  }

  writeAll(all);

  // Arquivo individual nomeado pelo título: data/songs/bob-marley-no-woman-no-cry.json
  if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });
  const songFile = path.join(SONGS_DIR, titleToFilename(titulo));
  fs.writeFileSync(songFile, JSON.stringify(entry, null, 2), 'utf8');

  console.log(`[Songs] Salva: "${titulo}" → ${titleToFilename(titulo)} (total: ${all.length})`);
  return { id: entry.id, updated: existing >= 0 };
}

// Extrai pares de linhas das músicas salvas para usar como exemplos no prompt
// Prioriza músicas com maior similaridade simples e limita por tamanho de contexto
function getVocabExamples(options = {}) {
  const { title, originalText, maxLines, maxSongs, maxChars } = parseVocabOptions(options);

  const songs = readAll();
  if (songs.length === 0) return [];

  const queryTokens = tokenize(`${title} ${(originalText ?? '').slice(0, 1200)}`).slice(0, 100);
  const rankedSongs = rankSongsByRelevance(songs, queryTokens, maxSongs);
  const state = {
    pairs: [],
    seenPairs: new Set(),
    usedChars: 0,
  };

  for (const song of rankedSongs) {
    const reachedLimit = appendPairsFromSong(song, state, maxLines, maxChars);
    if (reachedLimit) break;
  }
  return state.pairs;
}

module.exports = { readAll, save, getVocabExamples };
