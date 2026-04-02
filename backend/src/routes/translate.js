const express = require('express');
const path = require('node:path');
const router = express.Router();
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');
const correctionsService = require('../services/correctionsService');
const audioStore = require('../services/audioStore');
const { collapseRepeats, alignLinesToSegments } = require('../services/lyricsUtils');

const YOUTUBE_REGEX = /^(https?:\/\/)?((www\.|m\.)?youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}/;
const MAX_DURATION_SECONDS = 420; // 7 minutos

router.post('/translate', async (req, res) => {
  const { url } = req.body;
  let playerPath = null;
  let whisperPath = null;

  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: 'URL inválida. Forneça um link válido do YouTube.' });
  }

  try {
    // 1. Metadados
    console.log(`[1/5] Buscando metadados: ${url}`);
    const { title, duration } = await audioService.getMetadata(url);
    console.log(`[1/5] Metadados OK → título: "${title}" | duração: ${duration}s`);

    // 2. Valida duração
    if (duration > MAX_DURATION_SECONDS) {
      const minutos = Math.floor(duration / 60);
      const segundos = duration % 60;
      return res.status(400).json({
        error: `Vídeo muito longo (${minutos}m${segundos}s). O limite é 7 minutos.`
      });
    }

    // 3. Download: M4A (player) + WAV 16kHz (Whisper)
    // Verifica se esta URL já foi processada e o áudio ainda está no cache (30 min)
    const normalizedUrl = audioService.normalizeYoutubeUrl(url);
    const cached = audioStore.findByUrl(normalizedUrl);

    let audioId;
    let segments;
    let originalText;

    if (cached) {
      console.log(`[3/5] Áudio em cache → reutilizando ${cached.audioId}`);
      audioId = cached.audioId;

      // Ainda precisa transcrever: cria cópia Whisper do arquivo cacheado
      console.log(`[4/5] Criando cópia Whisper do cache + transcrevendo...`);
      whisperPath = audioService.createWhisperCopy(cached.filePath);
      ({ text: originalText, segments } = await transcriptionService.transcribe(whisperPath));
      await audioService.deleteFile(whisperPath);
      whisperPath = null;
    } else {
      console.log(`[3/5] Baixando áudio M4A + criando cópia Whisper 16kHz...`);
      ({ playerPath, whisperPath } = await audioService.downloadAudio(url));
      console.log(`[3/5] Download OK → player: ${path.basename(playerPath)} | whisper: ${path.basename(whisperPath)}`);

      // 4. Transcrição com a cópia 16kHz (deletada logo após)
      console.log(`[4/5] Transcrevendo via Groq Whisper-large-v3...`);
      ({ text: originalText, segments } = await transcriptionService.transcribe(whisperPath));
      await audioService.deleteFile(whisperPath);
      whisperPath = null;

      // Registra M4A no store com chave de URL (expira em 30 min)
      audioId = path.basename(playerPath, path.extname(playerPath));
      audioStore.register(audioId, playerPath, normalizedUrl);
      playerPath = null; // store assume o controle
    }

    console.log(`[4/5] Transcrição OK → ${originalText.length} chars, ${segments.length} segmentos`);

    // 5. Tradução
    const corrections = correctionsService.findForSong(title);
    const correctionsForPrompt = corrections.filter(c => c.titulo);
    if (corrections.length > 0) {
      console.log(`[5/5] ${corrections.length} correção(ões) encontrada(s) para "${title}"`);
    }
    console.log(`[5/5] Iniciando tradução cultural via Claude...`);
    const translationResult = await translationService.translate(title, originalText, correctionsForPrompt);
    console.log(`[5/5] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

    const corrected = correctionsService.applyToResult(translationResult, title);
    const finalResult = collapseRepeats(corrected);
    const lineTimestamps = alignLinesToSegments(finalResult.letra_original, segments);

    console.log(`[OK] audioId: ${audioId} (expira em 30 min)`);
    return res.json({ ...finalResult, titulo: title, audioId, lineTimestamps });

  } catch (err) {
    console.error('[ERRO] Pipeline falhou:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
  } finally {
    if (whisperPath) await audioService.deleteFile(whisperPath);
    if (playerPath)  await audioService.deleteFile(playerPath);
  }
});

module.exports = router;
