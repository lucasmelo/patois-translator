const express = require('express');
const router = express.Router();
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');

// Aceita: youtube.com, www.youtube.com, m.youtube.com, youtu.be
const YOUTUBE_REGEX = /^(https?:\/\/)?((www\.|m\.)?youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;

router.post('/translate', async (req, res) => {
  const { url } = req.body;
  let filePath = null;

  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça um link válido do YouTube.' });
  }

  try {
    // 1. Título via oEmbed (sem yt-dlp, funciona em qualquer IP)
    console.log(`[1/3] Buscando título: ${url}`);
    const { title } = await audioService.getMetadata(url);
    console.log(`[1/3] Título: "${title}"`);

    // 2. Transcrição: legendas YouTube (primário) → Groq Whisper (fallback local)
    console.log(`[2/3] Transcrevendo...`);
    const originalText = await transcriptionService.transcribe(url, filePath);
    console.log(`[2/3] Transcrição OK → ${originalText.length} chars`);

    // 3. Tradução cultural
    console.log(`[3/3] Traduzindo...`);
    const translationResult = await translationService.translate(title, originalText);
    console.log(`[3/3] Tradução OK → ${translationResult.notas_culturais?.length ?? 0} notas culturais`);

    return res.json(translationResult);

  } catch (err) {
    console.error('[ERRO]', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
  } finally {
    if (filePath) await audioService.deleteFile(filePath);
  }
});

module.exports = router;
