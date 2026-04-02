const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const CORRECTIONS_FILE = path.join(DATA_DIR, 'corrections.json');

function readAll() {
  if (!fs.existsSync(CORRECTIONS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CORRECTIONS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Normaliza título para comparação: remove sufixos do YouTube, lowercase, sem pontuação
function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\(official[^)]*\)/gi, '')
    .replace(/\[.*?\]/g, '')
    .replace(/ft\..*$/i, '')
    .replace(/feat\..*$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(str) {
  return (str ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function findForSong(titulo) {
  const all = readAll();
  const norm = titulo ? normalizeTitle(titulo) : null;
  return all.filter(c => {
    // Correção vinculada a uma música específica — bate pelo título
    if (c.titulo) return norm && normalizeTitle(c.titulo) === norm;
    // Correção sem título (salva antes do campo existir) — aplica globalmente
    // mas só via conteúdo exato da linha no applyToResult, nunca como hint solto
    return true;
  });
}

// Aplica correções diretamente no resultado — substitui linhas que batem com as originais corrigidas
function applyToResult(result, titulo) {
  const corrections = findForSong(titulo);
  if (corrections.length === 0) return result;

  const enLines = (result.letra_original ?? '').split('\n');
  const ptLines = (result.letra_traduzida ?? '').split('\n');

  corrections.forEach(c => {
    const normOriginal = normalizeForMatch(c.linha_en_original);
    enLines.forEach((line, i) => {
      if (normalizeForMatch(line) === normOriginal) {
        enLines[i] = c.linha_en_corrigida;
        if (ptLines[i] !== undefined) ptLines[i] = c.linha_pt_corrigida;
        console.log(`[Correção aplicada] linha ${i}: "${line}" → "${c.linha_en_corrigida}"`);
      }
    });
  });

  return {
    ...result,
    letra_original: enLines.join('\n'),
    letra_traduzida: ptLines.join('\n'),
  };
}

function save({ titulo, linha_en_original, linha_pt_original, linha_en_corrigida, linha_pt_corrigida }) {
  const all = readAll();

  // Evita duplicatas exatas
  const duplicate = all.find(
    c => c.linha_en_original === linha_en_original &&
         c.linha_en_corrigida === linha_en_corrigida &&
         c.linha_pt_corrigida === linha_pt_corrigida
  );
  if (duplicate) return { id: duplicate.id, duplicate: true };

  const entry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    titulo,
    linha_en_original,
    linha_pt_original,
    linha_en_corrigida,
    linha_pt_corrigida,
  };

  all.push(entry);
  writeAll(all);
  console.log(`[Correção] Salva #${all.length} para "${titulo}": "${linha_en_original}" → "${linha_en_corrigida}"`);
  return { id: entry.id, duplicate: false };
}

module.exports = { readAll, findForSong, applyToResult, save };
