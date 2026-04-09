function normalizeToken(token) {
  return String(token ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .replaceAll(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
    .replaceAll(/(.)\1{2,}/g, '$1$1');
}

const VOCALIZATION_SYLLABLES = ['la', 'na', 'da', 'ha', 'he', 'hi', 'ho', 'hu', 'ah', 'oh', 'uh', 'eh', 'mm', 'hm', 'yo', 'ya', 'ay', 'oy', 'woo', 'woah', 'whoa', 'hey', 'yeah', 'aye', 'ii'];

function isVocalizationToken(token) {
  if (!token) return false;

  const withoutKnownSyllables = VOCALIZATION_SYLLABLES.reduce(
    (current, syllable) => current.replaceAll(syllable, ''),
    token,
  );
  if (!withoutKnownSyllables) {
    return true;
  }

  return /^[aeiouy]{2,}$/.test(token) || /^([a-z]{1,2})\1+$/.test(token);
}

function getLineWeight(line) {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  const textWeight = trimmed.replaceAll(/\s+/g, '').length;
  return Math.max(1, textWeight);
}

function getWordWeight(word) {
  const token = normalizeToken(word.word);
  const duration = Math.max(0.04, word.end - word.start);

  if (!token) return duration * 0.2;
  if (isVocalizationToken(token)) return Math.max(0.12, duration * 0.35);

  return Math.max(0.3, token.length * 0.9, duration * 2.4);
}

function buildTimelineUnits(words) {
  const units = [];

  for (let i = 0; i < words.length; i++) {
    const current = words[i];
    units.push({
      start: current.start,
      end: current.end,
      weight: current.weight,
    });

    const next = words[i + 1];
    if (!next) continue;

    const gap = next.start - current.end;
    if (gap > 0.12 && gap < 1.15) {
      units.push({
        start: current.end,
        end: next.start,
        weight: Math.max(0.05, gap * 0.35),
      });
    }
  }

  return units;
}

function buildUsableWords(words) {
  const usableWords = (words || [])
    .filter(word => Number.isFinite(word?.start) && Number.isFinite(word?.end) && word.end > word.start)
    .map(word => {
      const token = normalizeToken(word.word);
      return {
        token,
        isVocalization: isVocalizationToken(token),
        start: word.start,
        end: word.end,
        weight: getWordWeight(word),
      };
    });

  while (usableWords.length > 0 && usableWords[0].isVocalization) usableWords.shift();
  while (usableWords.length > 0 && usableWords.at(-1).isVocalization) usableWords.pop();

  return usableWords;
}

function alignLineArrayToWords(lines, usableWords) {
  if (usableWords.length === 0) return lines.map(() => null);

  const timelineUnits = buildTimelineUnits(usableWords);
  if (timelineUnits.length === 0) return lines.map(() => null);

  const lineWeights = lines.map(getLineWeight);
  const totalLineWeight = lineWeights.reduce((sum, weight) => sum + weight, 0);
  if (totalLineWeight === 0) return lines.map(() => null);

  const totalTimelineWeight = timelineUnits.reduce((sum, unit) => sum + unit.weight, 0);
  if (totalTimelineWeight <= 0) return [];

  function weightedOffsetToTime(weightedOffset) {
    const clamped = Math.min(Math.max(weightedOffset, 0), totalTimelineWeight);
    let accumulated = 0;

    for (const unit of timelineUnits) {
      if (clamped <= accumulated + unit.weight) {
        const ratio = (clamped - accumulated) / unit.weight;
        return unit.start + ((unit.end - unit.start) * ratio);
      }
      accumulated += unit.weight;
    }

    return timelineUnits.at(-1).end;
  }

  const result = [];
  let lineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineWeight = lineWeights[i];
    if (!lineWeight) {
      result.push(null);
      continue;
    }

    const weightedStart = (lineOffset / totalLineWeight) * totalTimelineWeight;
    lineOffset += lineWeight;
    const weightedEnd = (lineOffset / totalLineWeight) * totalTimelineWeight;

    result.push({
      start: weightedOffsetToTime(weightedStart),
      end: weightedOffsetToTime(weightedEnd),
    });
  }

  return result;
}

function isFiniteTimestamp(ts) {
  return !!ts && Number.isFinite(ts.start) && Number.isFinite(ts.end) && ts.end > ts.start;
}

function findPrevTimedIndex(lines, rows, index) {
  for (let i = index - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    if (isFiniteTimestamp(rows[i])) return i;
  }
  return -1;
}

function findNextTimedIndex(lines, rows, index) {
  for (let i = index + 1; i < rows.length; i++) {
    if (!lines[i].trim()) continue;
    if (isFiniteTimestamp(rows[i])) return i;
  }
  return -1;
}

function smoothLineTimestamps(lines, lineTimestamps, segments = []) {
  const MIN_LINE_DURATION_SECONDS = 0.11;
  const MAX_BRIDGEABLE_GAP_SECONDS = 2.4;
  const SEGMENT_END_FALLBACK = segments.at(-1)?.end ?? null;

  const out = [...lineTimestamps];

  // 1) Preenche linhas de texto que vieram sem timestamp válido.
  for (let i = 0; i < out.length; i++) {
    if (!lines[i]?.trim()) {
      out[i] = null;
      continue;
    }
    if (isFiniteTimestamp(out[i])) continue;

    const prevIdx = findPrevTimedIndex(lines, out, i);
    const nextIdx = findNextTimedIndex(lines, out, i);

    if (prevIdx >= 0 && nextIdx >= 0) {
      const prev = out[prevIdx];
      const next = out[nextIdx];
      const slots = nextIdx - prevIdx;
      const start = prev.end + ((next.start - prev.end) * (i - prevIdx - 0.2)) / slots;
      const end = prev.end + ((next.start - prev.end) * (i - prevIdx + 0.8)) / slots;
      out[i] = { start, end };
      continue;
    }

    if (prevIdx >= 0) {
      const prev = out[prevIdx];
      out[i] = { start: prev.end, end: prev.end + 0.28 };
      continue;
    }

    if (nextIdx >= 0) {
      const next = out[nextIdx];
      out[i] = { start: Math.max(0, next.start - 0.28), end: next.start };
      continue;
    }

    if (Number.isFinite(SEGMENT_END_FALLBACK) && SEGMENT_END_FALLBACK > 0) {
      out[i] = { start: 0, end: SEGMENT_END_FALLBACK };
    } else {
      out[i] = { start: 0, end: 0.4 };
    }
  }

  // 2) Corrige overlaps e encurta lacunas exageradas entre linhas consecutivas.
  let prevTimedIdx = -1;
  for (let i = 0; i < out.length; i++) {
    if (!lines[i]?.trim()) continue;
    const cur = out[i];
    if (!isFiniteTimestamp(cur)) continue;

    if (prevTimedIdx >= 0) {
      const prev = out[prevTimedIdx];
      const overlap = prev.end - cur.start;
      if (overlap > 0) {
        const shift = overlap / 2;
        prev.end -= shift;
        cur.start += shift;
      }

      const gap = cur.start - prev.end;
      if (gap > 0.6 && gap <= MAX_BRIDGEABLE_GAP_SECONDS) {
        const bridge = Math.min(gap * 0.6, 0.55);
        prev.end += bridge * 0.5;
        cur.start -= bridge * 0.5;
      }
    }

    prevTimedIdx = i;
  }

  // 3) Garante duração mínima e ordem crescente.
  let cursor = 0;
  for (let i = 0; i < out.length; i++) {
    if (!lines[i]?.trim()) continue;
    const cur = out[i];
    if (!isFiniteTimestamp(cur)) {
      out[i] = { start: cursor, end: cursor + MIN_LINE_DURATION_SECONDS };
      cursor += MIN_LINE_DURATION_SECONDS;
      continue;
    }

    if (cur.start < cursor) cur.start = cursor;
    if (cur.end <= cur.start) cur.end = cur.start + MIN_LINE_DURATION_SECONDS;
    if (cur.end - cur.start < MIN_LINE_DURATION_SECONDS) {
      cur.end = cur.start + MIN_LINE_DURATION_SECONDS;
    }
    cursor = cur.end;
  }

  return out;
}

function buildStanzas(lines) {
  const stanzas = [];
  let current = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) {
      if (current.length > 0) {
        stanzas.push(current);
        current = [];
      }
      continue;
    }

    current.push(i);
  }

  if (current.length > 0) stanzas.push(current);
  return stanzas;
}

function buildWordGroups(words, gapThresholdSeconds = 1.15) {
  if (words.length === 0) return [];

  const groups = [];
  let start = 0;

  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > gapThresholdSeconds) {
      groups.push(words.slice(start, i));
      start = i;
    }
  }

  groups.push(words.slice(start));
  return groups;
}

function assignGroupsToStanzas(stanzas, groups, lines) {
  if (stanzas.length === 0 || groups.length === 0) return [];

  const stanzaWeights = stanzas.map(stanza =>
    stanza.reduce((sum, lineIndex) => sum + getLineWeight(lines[lineIndex]), 0)
  );
  const groupWeights = groups.map(group => group.reduce((sum, word) => sum + word.weight, 0));
  const totalStanzaWeight = stanzaWeights.reduce((sum, weight) => sum + weight, 0);
  const totalGroupWeight = groupWeights.reduce((sum, weight) => sum + weight, 0);

  if (totalStanzaWeight <= 0 || totalGroupWeight <= 0) return [];

  const assignments = [];
  let groupStart = 0;
  let consumedGroupWeight = 0;
  let consumedStanzaWeight = 0;

  for (let i = 0; i < stanzas.length; i++) {
    consumedStanzaWeight += stanzaWeights[i];

    if (i === stanzas.length - 1) {
      assignments.push(groups.slice(groupStart).flat());
      break;
    }

    const targetWeight = (consumedStanzaWeight / totalStanzaWeight) * totalGroupWeight;
    let groupEnd = groupStart;
    let bestBoundary = groupStart + 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    let runningWeight = consumedGroupWeight;

    while (groupEnd < groups.length - (stanzas.length - i - 1)) {
      runningWeight += groupWeights[groupEnd];
      const distance = Math.abs(runningWeight - targetWeight);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestBoundary = groupEnd + 1;
        groupEnd++;
        continue;
      }
      break;
    }

    assignments.push(groups.slice(groupStart, bestBoundary).flat());
    consumedGroupWeight = groups
      .slice(0, bestBoundary)
      .reduce((sum, group, index) => sum + groupWeights[index], 0);
    groupStart = bestBoundary;
  }

  return assignments;
}

function alignLinesToWords(letteraOriginal, words) {
  if (!words || words.length === 0) return [];

  const lines = letteraOriginal.split('\n');
  const usableWords = buildUsableWords(words);
  if (usableWords.length === 0) return [];

  const stanzas = buildStanzas(lines);
  const wordGroups = buildWordGroups(usableWords);

  if (stanzas.length >= 2 && wordGroups.length >= stanzas.length) {
    const stanzaAssignments = assignGroupsToStanzas(stanzas, wordGroups, lines);
    if (stanzaAssignments.length === stanzas.length && stanzaAssignments.every(group => group.length > 0)) {
      const result = lines.map(line => (line.trim() ? { start: 0, end: 0 } : null));

      for (let i = 0; i < stanzas.length; i++) {
        const stanzaLineIndexes = stanzas[i];
        const stanzaLines = stanzaLineIndexes.map(index => lines[index]);
        const stanzaResult = alignLineArrayToWords(stanzaLines, stanzaAssignments[i]);

        for (let j = 0; j < stanzaLineIndexes.length; j++) {
          result[stanzaLineIndexes[j]] = stanzaResult[j];
        }
      }

      return result;
    }
  }

  return alignLineArrayToWords(lines, usableWords);
}

// Alinha cada linha da letra_original aos segmentos do Whisper.
//
// Estratégia: distribui as linhas pelo TEMPO DE FALA REAL (soma das durações dos
// segmentos), ignorando gaps/silêncios. Um segmento de 4s recebe proporcionalmente
// mais linhas que um de 1s; intro instrumental e pausas entre estrofes são pulados.
//
// Retorna Array<{ start, end } | null> — null para linhas vazias (separadores de estrofe).
function alignLinesToSegments(letteraOriginal, segments, words = []) {
  const lines = letteraOriginal.split('\n');

  const wordAligned = alignLinesToWords(letteraOriginal, words);
  if (wordAligned.length > 0) {
    return smoothLineTimestamps(lines, wordAligned, segments);
  }

  if (!segments || segments.length === 0) return [];

  // Peso de cada linha por chars (sem tratamento especial de "(Nx)").
  const charCounts = lines.map(l => {
    const trimmed = l.trim();
    if (!trimmed) return 0;
    return trimmed.length;
  });
  const totalLyricChars = charCounts.reduce((s, c) => s + c, 0);
  if (totalLyricChars === 0) return lines.map(() => null);

  // Duração total de fala (exclui gaps entre segmentos)
  const totalSpeechDuration = segments.reduce((s, seg) => s + (seg.end - seg.start), 0);
  if (totalSpeechDuration <= 0) return lines.map(() => null);

  // Converte "offset em tempo de fala" (0..totalSpeechDuration) para timestamp real,
  // percorrendo os segmentos sequencialmente e pulando os gaps.
  function speechOffsetToTime(speechOffset) {
    const clamped = Math.min(Math.max(speechOffset, 0), totalSpeechDuration);
    let accumulated = 0;
    for (const seg of segments) {
      const dur = seg.end - seg.start;
      if (clamped <= accumulated + dur) {
        return seg.start + ((clamped - accumulated) / dur) * dur;
      }
      accumulated += dur;
    }
    return segments.at(-1).end;
  }

  const result = [];
  let lyricCharOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const chars = charCounts[i];
    if (!chars) {
      result.push(null);
      continue;
    }

    const speechStart = (lyricCharOffset / totalLyricChars) * totalSpeechDuration;
    lyricCharOffset += chars;
    const speechEnd = (lyricCharOffset / totalLyricChars) * totalSpeechDuration;

    result.push({
      start: speechOffsetToTime(speechStart),
      end: speechOffsetToTime(speechEnd),
    });
  }

  return smoothLineTimestamps(lines, result, segments);
}

module.exports = { alignLinesToSegments };
