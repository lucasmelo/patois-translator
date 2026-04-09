/**
 * Mapeia palavras do Whisper para tokens da letra exibida (letra_original),
 * usando timestamps de linha e alinhamento monotônico (DP).
 */

function normalizeToken(token) {
  return String(token ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
    .replaceAll(/(.)\1{2,}/g, '$1$1');
}

function stripRepeatSuffix(trimmed) {
  return trimmed.replace(/\s*\(\d+x\)\s*$/i, '').trim();
}

function tokenizeLyricLine(line) {
  const base = stripRepeatSuffix(line.trim());
  if (!base) return [];
  return base.split(/\s+/).filter(Boolean);
}

function whisperWordText(w) {
  return String(w.word ?? '').trim();
}

function filterWordsInWindow(words, ts) {
  if (!ts || !Number.isFinite(ts.start) || !Number.isFinite(ts.end) || ts.end <= ts.start) {
    return [];
  }
  const pad = 0.08;
  const lo = ts.start - pad;
  const hi = ts.end + pad;
  return (words || [])
    .filter(w =>
      Number.isFinite(w?.start) &&
      Number.isFinite(w?.end) &&
      w.end > w.start &&
      w.start < hi &&
      w.end > lo
    )
    .sort((a, b) => a.start - b.start);
}

function matchCost(lineNorm, whisperNorm) {
  if (!lineNorm || !whisperNorm) return 1;
  if (lineNorm === whisperNorm) return 0;
  if (lineNorm.includes(whisperNorm) || whisperNorm.includes(lineNorm)) return 0.35;
  const a = lineNorm.length;
  const b = whisperNorm.length;
  if (a <= 4 && b <= 4 && levenshtein(lineNorm, whisperNorm) <= 1) return 0.45;
  return 1;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/**
 * DP: alinha cada token da linha a uma subseqüência monotônica de palavras Whisper.
 * dp[i][j] = custo mínimo para alinhar os primeiros i tokens da linha usando apenas whisper[0..j-1].
 */
function alignLineTokensToWhisper(lineTokens, whisperWindow, lineTs) {
  const m = lineTokens.length;
  const W = whisperWindow.map(w => ({
    raw: whisperWordText(w),
    n: normalizeToken(whisperWordText(w)),
    start: w.start,
    end: w.end,
  })).filter(x => x.raw.length > 0);

  const n = W.length;
  const lineNorms = lineTokens.map(t => normalizeToken(t));

  if (m === 0) return [];
  if (n === 0) {
    return interpolateEvenly(lineTokens, lineTs.start, lineTs.end);
  }

  const INF = 1e15;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(INF));
  const back = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0)); // 0=skip W, 1=match

  dp[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    dp[0][j] = 0;
    back[0][j] = 0;
  }
  for (let i = 1; i <= m; i++) {
    dp[i][0] = INF;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const skipW = dp[i][j - 1];
      const match = dp[i - 1][j - 1] + matchCost(lineNorms[i - 1], W[j - 1].n);

      if (match <= skipW) {
        dp[i][j] = match;
        back[i][j] = 1;
      } else {
        dp[i][j] = skipW;
        back[i][j] = 0;
      }
    }
  }

  let bestJ = n;
  let bestCost = dp[m][n];
  for (let j = 0; j <= n; j++) {
    if (dp[m][j] < bestCost) {
      bestCost = dp[m][j];
      bestJ = j;
    }
  }

  if (!Number.isFinite(bestCost) || bestCost >= INF / 2) {
    return interpolateEvenly(lineTokens, lineTs.start, lineTs.end);
  }

  const pairs = new Map(); // lineIdx -> whisperIdx
  let i = m;
  let j = bestJ;
  while (i > 0 && j > 0) {
    if (back[i][j] === 1) {
      pairs.set(i - 1, j - 1);
      i -= 1;
      j -= 1;
    } else {
      j -= 1;
    }
  }

  const out = [];
  for (let li = 0; li < m; li++) {
    const wi = pairs.get(li);
    if (wi !== undefined) {
      const w = W[wi];
      out.push({
        text: lineTokens[li],
        start: Math.max(lineTs.start, w.start),
        end: Math.min(lineTs.end, w.end),
      });
    } else {
      out.push({ text: lineTokens[li], start: NaN, end: NaN });
    }
  }

  interpolateNaNs(out, lineTs);
  clampOrder(out, lineTs);
  return out;
}

function interpolateEvenly(tokens, start, end) {
  if (tokens.length === 0) return [];
  const dur = Math.max(0.05, end - start);
  const step = dur / tokens.length;
  return tokens.map((text, i) => ({
    text,
    start: start + i * step,
    end: start + (i + 1) * step,
  }));
}

function interpolateNaNs(items, lineTs) {
  const n = items.length;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(items[i].start) && Number.isFinite(items[i].end)) continue;

    let prevEnd = lineTs.start;
    let prevIdx = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (Number.isFinite(items[k].end)) {
        prevEnd = items[k].end;
        prevIdx = k;
        break;
      }
    }

    let nextStart = lineTs.end;
    let nextIdx = n;
    for (let k = i + 1; k < n; k++) {
      if (Number.isFinite(items[k].start)) {
        nextStart = items[k].start;
        nextIdx = k;
        break;
      }
    }

    const runStart = prevIdx >= 0 ? prevIdx + 1 : 0;
    const runEnd = nextIdx - 1;
    const runLen = runEnd - runStart + 1;
    if (runLen <= 0) continue;

    const t0 = prevEnd;
    const t1 = nextStart;
    const span = Math.max(0.04 * runLen, t1 - t0);
    const step = span / runLen;
    for (let r = 0; r < runLen; r++) {
      const idx = runStart + r;
      items[idx].start = t0 + r * step;
      items[idx].end = t0 + (r + 1) * step;
    }
  }
}

function clampOrder(items, lineTs) {
  for (let i = 0; i < items.length; i++) {
    items[i].start = Math.max(lineTs.start, Math.min(lineTs.end, items[i].start));
    items[i].end = Math.max(lineTs.start, Math.min(lineTs.end, items[i].end));
    if (items[i].end <= items[i].start) {
      items[i].end = Math.min(lineTs.end, items[i].start + 0.06);
    }
  }
  for (let i = 1; i < items.length; i++) {
    if (items[i].start < items[i - 1].end) {
      const mid = (items[i - 1].end + items[i].start) / 2;
      items[i - 1].end = Math.max(items[i - 1].start + 0.04, mid);
      items[i].start = Math.min(items[i].end - 0.04, mid);
    }
  }
}

/**
 * @param {string} letraOriginal
 * @param {Array<{ word: string, start: number, end: number }>} words
 * @param {Array<{ start: number, end: number } | null>} lineTimestamps
 * @returns {Array<Array<{ text: string, start: number, end: number }> | null>}
 */
function buildKaraokeWordTimestamps(letraOriginal, words, lineTimestamps) {
  const lines = (letraOriginal ?? '').split('\n');
  const tsRow = lineTimestamps ?? [];
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      out.push(null);
      continue;
    }

    const ts = tsRow[i];
    if (!ts || !Number.isFinite(ts.start) || !Number.isFinite(ts.end) || ts.end <= ts.start) {
      out.push(null);
      continue;
    }

    const tokens = tokenizeLyricLine(line);
    if (tokens.length === 0) {
      out.push(null);
      continue;
    }

    const window = filterWordsInWindow(words, ts);
    const aligned = alignLineTokensToWhisper(tokens, window, ts);
    out.push(aligned);
  }

  while (out.length < lines.length) out.push(null);
  return out;
}

/**
 * Aplica timestamps do WhisperX mantendo o texto dos tokens da UI quando possível.
 * @param {Array<Array<{text:string,start:number,end:number}>|null>} base
 * @param {Array<{ index: number, words: Array<{text:string,start:number,end:number}> }>} refined
 */
function mergeWhisperxLineWords(base, refined) {
  if (!refined || refined.length === 0) return base;
  const next = [...base];
  for (const entry of refined) {
    const idx = entry.index;
    if (!Number.isInteger(idx) || idx < 0 || idx >= next.length) continue;
    const w = entry.words;
    if (!Array.isArray(w) || w.length === 0) continue;
    const cleaned = w
      .map(x => ({
        text: String(x.text ?? '').trim() || '…',
        start: Number(x.start),
        end: Number(x.end),
      }))
      .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start);
    if (cleaned.length === 0) continue;

    const baseWords = next[idx];
    if (Array.isArray(baseWords) && baseWords.length === cleaned.length) {
      next[idx] = baseWords.map((b, j) => ({
        text: b.text,
        start: cleaned[j].start,
        end: cleaned[j].end,
      }));
    } else if (!baseWords || baseWords.length === 0) {
      next[idx] = cleaned.map(x => ({ text: x.text, start: x.start, end: x.end }));
    }
  }
  return next;
}

module.exports = {
  buildKaraokeWordTimestamps,
  mergeWhisperxLineWords,
  normalizeToken,
  tokenizeLyricLine,
};
