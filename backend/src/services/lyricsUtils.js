// Normaliza linha para comparação (ignora maiúsculas, espaços extras, pontuação final)
function normalizeLine(line) {
  return line.toLowerCase().trim().replace(/[.,!?]+$/, '');
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
function alignLinesToSegments(letteraOriginal, segments) {
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
      end:   speechOffsetToTime(speechEnd),
    });
  }

  return result;
}

module.exports = { collapseRepeats, alignLinesToSegments };
