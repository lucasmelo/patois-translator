const express = require('express');
const router = express.Router();
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');

// Aceita: youtube.com, www.youtube.com, m.youtube.com, youtu.be
// Aceita parâmetros extras como &list=, &index=, ?t= (extrai só o watch?v=)
const YOUTUBE_REGEX = /^(https?:\/\/)?((www\.|m\.)?youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

router.post('/translate', async (req, res) => {
  const { url } = req.body;
  let filePath = null;

  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça um link válido do YouTube.' });
  }

  try {
    // 1. Busca título via oEmbed (duração é verificada pelo --match-filter no download)
    console.log(`[1/5] Buscando metadados: ${url}`);
    const { title } = await audioService.getMetadata(url);
    console.log(`[1/5] Título: "${title}"`);

    // 2. Download do áudio (rejeita automaticamente vídeos > 7 min via --match-filter)
    console.log(`[2/5] Iniciando download do áudio (64kbps)...`);
    filePath = await audioService.downloadAudio(url);
    console.log(`[2/5] Download OK → arquivo: ${filePath}`);

    // 3. Transcrição via Groq Whisper
    console.log(`[3/4] Enviando áudio para Groq Whisper-large-v3...`);
    const originalText = await transcriptionService.transcribe(filePath);
    console.log(`[3/4] Transcrição OK → ${originalText.length} caracteres`);

    // 4. Tradução
    console.log(`[4/4] Iniciando tradução cultural...`);
    const translationResult = await translationService.translate(title, originalText);
    console.log(`[4/4] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

    return res.json(translationResult);

  } catch (err) {
    console.error('[ERRO] Pipeline falhou:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
  } finally {
    // GARBAGE COLLECTION: garante deleção do arquivo mesmo em caso de erro
    if (filePath) {
      await audioService.deleteFile(filePath);
    }
  }
});

module.exports = router;
