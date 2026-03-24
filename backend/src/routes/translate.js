const express = require('express');
const router = express.Router();
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');

const YOUTUBE_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;
const MAX_DURATION_SECONDS = 420; // 7 minutos

router.post('/translate', async (req, res) => {
  const { url } = req.body;
  let filePath = null;

  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça um link válido do YouTube.' });
  }

  try {
    // 1. Busca metadados do vídeo
    console.log(`[1/5] Buscando metadados: ${url}`);
    const { title, duration } = await audioService.getMetadata(url);
    console.log(`[1/5] Metadados OK → título: "${title}" | duração: ${duration}s`);

    // 2. Valida duração
    if (duration > MAX_DURATION_SECONDS) {
      const minutos = Math.floor(duration / 60);
      const segundos = duration % 60;
      console.log(`[2/5] Duração excedida: ${minutos}m${segundos}s`);
      return res.status(400).json({
        error: `Vídeo muito longo (${minutos}m${segundos}s). O limite é 7 minutos.`
      });
    }

    // 3. Download do áudio
    console.log(`[3/5] Iniciando download do áudio (64kbps)...`);
    filePath = await audioService.downloadAudio(url);
    console.log(`[3/5] Download OK → arquivo: ${filePath}`);

    // 4. Transcrição via Groq Whisper
    console.log(`[4/5] Enviando áudio para Groq Whisper-large-v3...`);
    const originalText = await transcriptionService.transcribe(filePath);
    console.log(`[4/5] Transcrição OK → ${originalText.length} caracteres`);

    // 5. Tradução via Gemini
    console.log(`[5/5] Iniciando tradução cultural via Gemini...`);
    const translationResult = await translationService.translate(title, originalText);
    console.log(`[5/5] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

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
