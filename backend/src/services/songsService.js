const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const SONGS_DIR = path.join(DATA_DIR, 'songs');
const SONGS_FILE = path.join(DATA_DIR, 'songs.json');

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
// Usa as últimas N músicas, limite de linhas para não estourar o contexto
function getVocabExamples(maxLines = 25) {
  const songs = readAll();
  if (songs.length === 0) return [];

  const pairs = [];
  // Pega as últimas 5 músicas salvas
  for (const song of songs.slice(-5)) {
    const enLines = (song.letra_original ?? '').split('\n').filter(l => l.trim());
    const ptLines = (song.letra_traduzida ?? '').split('\n').filter(l => l.trim());
    const count = Math.min(enLines.length, ptLines.length);
    for (let i = 0; i < count && pairs.length < maxLines; i++) {
      pairs.push({ en: enLines[i].trim(), pt: ptLines[i].trim() });
    }
    if (pairs.length >= maxLines) break;
  }
  return pairs;
}

module.exports = { readAll, save, getVocabExamples };
