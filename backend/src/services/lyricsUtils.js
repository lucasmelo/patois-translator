// Normaliza linha para comparação (ignora maiúsculas, espaços extras, pontuação final)
function normalizeLine(line) {
  return line.toLowerCase().trim().replace(/[.,!?]+$/, '');
}

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

  const repeatMatch = trimmed.match(/\((\d+)x\)\s*$/);
  const repeatCount = repeatMatch ? Number.parseInt(repeatMatch[1], 10) : 1;
  const textWeight = trimmed.replaceAll(/\s+/g, '').length;
  return Math.max(1, Math.round(textWeight * Math.pow(repeatCount, 0.65)));
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

// Colapsa linhas consecutivas repetidas adicionando (2x), (3x) etc.
// Processa EN e PT juntos para manter o mesmo número de linhas (necessário para display interleaved)
function collapseRepeats(result) {
  const enLines = (result.letra_original ?? '').split('\n');
  const ptLines = (result.letra_traduzida ?? '').split('\n');

  const outEn = [];
  const outPt = [];

  let i = 0;
  while (i < enLines.length) {
    const en = enLines[i] ?? '';
    const pt = ptLines[i] ?? '';

    // Linha vazia = separador de estrofe — nunca colapsar
    if (!en.trim()) {
      outEn.push(en);
      outPt.push(pt);
      i++;
      continue;
    }

    // Conta quantas vezes esta linha EN se repete consecutivamente
    let count = 1;
    while (
      i + count < enLines.length &&
      normalizeLine(enLines[i + count]) === normalizeLine(en)
    ) {
      count++;
    }

    if (count >= 2) {
      outEn.push(`${en} (${count}x)`);
      outPt.push(pt ? `${pt} (${count}x)` : pt);
      i += count;
    } else {
      outEn.push(en);
      outPt.push(pt);
      i++;
    }
  }

  return {
    ...result,
    letra_original: outEn.join('\n'),
    letra_traduzida: outPt.join('\n'),
  };
}

// Alinha cada linha da letra_original aos segmentos do Whisper.
//
// Estratégia: distribui as linhas pelo TEMPO DE FALA REAL (soma das durações dos
// segmentos), ignorando gaps/silêncios. Um segmento de 4s recebe proporcionalmente
// mais linhas que um de 1s; intro instrumental e pausas entre estrofes são pulados.
//
// Retorna Array<{ start, end } | null> — null para linhas vazias (separadores de estrofe).
function alignLinesToSegments(letteraOriginal, segments, words = []) {
  const wordAligned = alignLinesToWords(letteraOriginal, words);
  if (wordAligned.length > 0) return wordAligned;

  if (!segments || segments.length === 0) return [];

  const lines = letteraOriginal.split('\n');
  // Peso de cada linha por chars — (Nx) recebe fator amortecido pois o cantor repete
  const charCounts = lines.map(l => {
    const trimmed = l.trim();
    if (!trimmed) return 0;
    const match = trimmed.match(/\((\d+)x\)\s*$/);
    const n = match ? Number.parseInt(match[1], 10) : 1;
    const weight = Math.pow(n, 0.65); // 2x→×1.57, 3x→×2.09, 4x→×2.57
    return Math.round(trimmed.length * weight);
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

  return result;
}

module.exports = { collapseRepeats, alignLinesToSegments };
