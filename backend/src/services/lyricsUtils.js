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

module.exports = { collapseRepeats };
