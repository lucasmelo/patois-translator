const express = require('express');
const router = express.Router();
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const captionService = require('../services/captionService');
const translationService = require('../services/translationService');

const YOUTUBE_REGEX = /^(https?:\/\/)?((www\.|m\.)?youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;
const { MAX_DURATION_SECONDS } = audioService;

router.post('/translate', async (req, res) => {
  const { url, title, text } = req.body;

  // ── Modo texto: usuário colou a letra diretamente ──────────────────────────
  if (text !== undefined) {
    const rawText = (text || '').trim();
    const songTitle = (title || '').trim() || 'Música sem título';

    if (!rawText) {
      return res.status(400).json({ error: 'O texto da letra não pode estar vazio.' });
    }

    try {
      console.log(`[1/2] Modo texto → "${songTitle}" | ${rawText.length} chars`);
      const result = await translationService.translate(songTitle, rawText);
      console.log(`[2/2] Tradução OK → ${result.notas_culturais?.length ?? 0} notas`);
      return res.json(result);
    } catch (err) {
      console.error('[ERRO] Tradução falhou:', err.message);
      return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
    }
  }

  // ── Modo URL ───────────────────────────────────────────────────────────────
  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({
      error: 'URL inválida. Forneça um link do YouTube ou use a aba "Colar Letra".',
    });
  }

  // ── PLANO A: Groq Whisper (máxima precisão) ────────────────────────────────
  let filePath = null;
  try {
    console.log(`[A1/4] Buscando metadados: ${url}`);
    const { title: videoTitle, duration } = await audioService.getMetadata(url);

    if (duration > MAX_DURATION_SECONDS) {
      const min = Math.floor(duration / 60);
      const sec = duration % 60;
      return res.status(400).json({
        error: `Vídeo muito longo (${min}m${sec}s). O limite é 7 minutos.`,
      });
    }
    console.log(`[A1/4] OK → "${videoTitle}" | ${duration}s`);

    console.log(`[A2/4] Baixando áudio...`);
    filePath = await audioService.downloadAudio(url);
    console.log(`[A2/4] OK → ${filePath}`);

    console.log(`[A3/4] Transcrevendo com Groq Whisper-large-v3...`);
    const originalText = await transcriptionService.transcribe(filePath);
    console.log(`[A3/4] OK → ${originalText.length} chars`);

    console.log(`[A4/4] Traduzindo...`);
    const result = await translationService.translate(videoTitle, originalText);
    console.log(`[A4/4] OK → ${result.notas_culturais?.length ?? 0} notas culturais`);

    return res.json(result);

  } catch (errA) {
    console.warn(`[Plano A falhou] ${errA.message} → tentando legendas...`);
  } finally {
    if (filePath) await audioService.deleteFile(filePath);
  }

  // ── PLANO B: Legendas automáticas do YouTube ───────────────────────────────
  try {
    console.log(`[B1/2] Buscando legendas em inglês...`);
    const { title: videoTitle, text: captions } = await captionService.fetchCaptions(url);
    console.log(`[B1/2] OK → "${videoTitle}" | ${captions.length} chars`);

    console.log(`[B2/2] Traduzindo a partir de legendas...`);
    const result = await translationService.translate(videoTitle, captions);
    console.log(`[B2/2] OK → ${result.notas_culturais?.length ?? 0} notas culturais`);

    return res.json(result);

  } catch (errB) {
    console.error(`[Plano B falhou] ${errB.message}`);
    return res.status(500).json({
      error: errB.message || 'Não foi possível processar este vídeo. Use a aba "Colar Letra".',
    });
  }
});

module.exports = router;
