const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../../data');
const CORRECTIONS_FILE = path.join(DATA_DIR, 'corrections.json');
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'was', 'were', 'from',
  'have', 'has', 'had', 'but', 'not', 'all', 'can', 'out', 'just', 'into', 'about', 'they',
  'them', 'then', 'than', 'when', 'what', 'who', 'where', 'why', 'how', 'his', 'her', 'him',
  'our', 'their', 'its', 'dont', 'cant', 'ive', 'im', 'youre', 'to', 'of', 'in', 'on', 'at',
  'a', 'an', 'is', 'it', 'be', 'as', 'or', 'if', 'no', 'we', 'i', 'me', 'my', 'yo', 'mi',
  'di', 'de', 'inna', 'pon', 'fi', 'dem', 'nah', 'nuh',
]);

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const LEARNING_ENABLED = process.env.LEARNING_ENABLED !== 'false';
const LEARNING_MAX_LINES = toPositiveInt(process.env.LEARNING_MAX_LINES, 12);
const LEARNING_MAX_CHARS = toPositiveInt(process.env.LEARNING_MAX_CHARS, 1200);
const LEARNING_MAX_CANDIDATES = toPositiveInt(process.env.LEARNING_MAX_CANDIDATES, 220);

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
    .replaceAll(/\(official[^)]*\)/gi, '')
    .replaceAll(/\[.*?\]/g, '')
    .replace(/ft\..*$/i, '')
    .replace(/feat\..*$/i, '')
    .replaceAll(/[^a-z0-9\s]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(str) {
  return (str ?? '').toLowerCase().replaceAll(/[^a-z0-9\s]/g, '').replaceAll(/\s+/g, ' ').trim();
}

function tokenize(str) {
  return normalizeForMatch(str)
    .split(' ')
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

function countOverlap(tokensA, tokensBSet) {
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensBSet.has(token)) overlap += 1;
  }
  return overlap;
}

function parseLearningOptions(options = {}) {
  return {
    titulo: options.titulo ?? '',
    originalText: options.originalText ?? '',
    maxLines: options.maxLines ?? LEARNING_MAX_LINES,
    maxChars: options.maxChars ?? LEARNING_MAX_CHARS,
    maxCandidates: options.maxCandidates ?? LEARNING_MAX_CANDIDATES,
    enabled: options.enabled ?? LEARNING_ENABLED,
  };
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

function rankCorrectionsByRelevance(corrections, titulo, originalText, maxCandidates) {
  const normalizedTitle = titulo ? normalizeTitle(titulo) : '';
  const normalizedText = normalizeForMatch((originalText ?? '').slice(0, 2000));
  const queryTokens = tokenize(`${titulo ?? ''} ${normalizedText}`);
  const queryTokenSet = new Set(queryTokens);

  return corrections
    .map((correction, index) => {
      const correctionTitleNorm = correction.titulo ? normalizeTitle(correction.titulo) : '';
      const lineOriginalNorm = normalizeForMatch(correction.linha_en_original);
      const lineTokens = tokenize(correction.linha_en_original);
      const overlap = countOverlap(lineTokens, queryTokenSet);

      let score = 0;
      if (normalizedTitle && correctionTitleNorm === normalizedTitle) score += 200;
      if (lineOriginalNorm && normalizedText.includes(lineOriginalNorm)) score += 110;
      score += overlap * 7;
      if (!correction.titulo) score += 4; // Correção global antiga ainda pode ajudar em frases recorrentes.

      return { correction, index, score };
    })
    .filter(entry => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.index - a.index;
    })
    .slice(0, Math.max(1, maxCandidates))
    .map(entry => entry.correction);
}

function getPromptCorrections(options = {}) {
  const { titulo, originalText, maxLines, maxChars, maxCandidates, enabled } = parseLearningOptions(options);
  const all = readAll();
  if (all.length === 0) return [];

  const ranked = enabled
    ? rankCorrectionsByRelevance(all, titulo, originalText, maxCandidates)
    : findForSong(titulo);

  const selected = [];
  let usedChars = 0;
  const seenKeys = new Set();

  for (const correction of ranked) {
    if (selected.length >= maxLines) break;
    const original = correction.linha_en_original?.trim();
    const enCorr = correction.linha_en_corrigida?.trim();
    const ptCorr = correction.linha_pt_corrigida?.trim();
    if (!original || !enCorr || !ptCorr) continue;

    const key = `${normalizeForMatch(original)}|||${normalizeForMatch(enCorr)}|||${normalizeForMatch(ptCorr)}`;
    if (seenKeys.has(key)) continue;

    const nextChars = (`  • Original: "${original}" → EN corrigido: "${enCorr}" | PT corrigido: "${ptCorr}"\n`).length;
    if (usedChars + nextChars > maxChars) break;

    seenKeys.add(key);
    usedChars += nextChars;
    selected.push(correction);
  }

  return selected;
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

module.exports = { readAll, findForSong, getPromptCorrections, applyToResult, save };
