const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('node:path');
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');
const correctionsService = require('../services/correctionsService');
const audioStore = require('../services/audioStore');
const { alignLinesToSegments } = require('../services/lyricsUtils');

const TEMP_DIR = path.join(__dirname, '../../temp');
const { v4: uuidv4 } = require('uuid');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp3', '.wav'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Envie um arquivo MP3 ou WAV.'));
    }
  },
});

router.post('/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  }

  const title = path.basename(file.originalname, path.extname(file.originalname));
  const playerPath = file.path; // original do usuário — vai pro player
  let whisperPath = null;
  let transcriptionAudioPath = playerPath;

  try {
    console.log(`[1/3] Arquivo recebido: "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    console.log(`[2/3] Transcrevendo áudio original...`);
    let originalText;
    let segments;
    let words;
    try {
      ({ text: originalText, segments, words } = await transcriptionService.transcribe(playerPath));
      if (transcriptionService.isTranscriptionSuspicious({ text: originalText, segments, words })) {
        console.warn('[2/3] Transcrição com áudio original parece fraca — fallback para WAV 16kHz');
        whisperPath = audioService.createWhisperCopy(playerPath);
        ({ text: originalText, segments, words } = await transcriptionService.transcribe(whisperPath));
        transcriptionAudioPath = whisperPath;
      }
    } catch (err) {
      console.warn(`[2/3] Falha na transcrição com áudio original (${err.message}) — fallback para WAV 16kHz`);
      whisperPath = audioService.createWhisperCopy(playerPath);
      ({ text: originalText, segments, words } = await transcriptionService.transcribe(whisperPath));
      transcriptionAudioPath = whisperPath;
    }
    console.log(`[2/3] Transcrição OK → ${originalText.length} chars, ${segments.length} segmentos`);

    const correctionsForPrompt = correctionsService.getPromptCorrections({
      titulo: title,
      originalText,
    });
    if (correctionsForPrompt.length > 0) {
      console.log(`[3/3] Memória ativa: ${correctionsForPrompt.length} correção(ões) enviada(s) ao prompt`);
    }
    console.log(`[3/3] Iniciando tradução cultural...`);
    const translationResult = await translationService.translate(title, originalText, correctionsForPrompt);
    console.log(`[3/3] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

    const finalResult = correctionsService.applyToResult(translationResult, title);

    const lineTimestamps = alignLinesToSegments(finalResult.letra_original, segments, words);
    const audioId = path.basename(playerPath, path.extname(playerPath));
    audioStore.register(audioId, playerPath);
    // playerPath agora é gerenciado pelo store — não deletar no finally

    console.log(`[OK] audioId registrado: ${audioId} (expira em 10 min)`);
    return res.json({ ...finalResult, titulo: title, audioId, lineTimestamps });

  } catch (err) {
    console.error('[ERRO] Upload pipeline falhou:', err.message);
    // Só deleta o arquivo do usuário se não foi registrado no store
    await audioService.deleteFile(playerPath);
    return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
  } finally {
    if (whisperPath) await audioService.deleteFile(whisperPath);
  }
});

// Erro do multer (tamanho ou formato)
router.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Arquivo muito grande. O limite é 25 MB.' });
  }
  return res.status(400).json({ error: err.message });
});

module.exports = router;
