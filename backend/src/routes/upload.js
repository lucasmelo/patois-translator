const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('node:path');
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');
const correctionsService = require('../services/correctionsService');
const audioStore = require('../services/audioStore');
const forcedAlignmentService = require('../services/forcedAlignmentService');
const { collapseRepeats, alignLinesToSegments } = require('../services/lyricsUtils');
const { buildKaraokeWordTimestamps, mergeWhisperxLineWords } = require('../services/karaokeWordAlign');

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

  try {
    console.log(`[1/3] Arquivo recebido: "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Cria cópia 16kHz mono só para o Whisper (original fica intacto para o player)
    console.log(`[2/3] Criando cópia Whisper 16kHz + transcrevendo...`);
    whisperPath = audioService.createWhisperCopy(playerPath);
    const { text: originalText, segments, words } = await transcriptionService.transcribe(whisperPath);
    console.log(`[2/3] Transcrição OK → ${originalText.length} chars, ${segments.length} segmentos`);

    const corrections = correctionsService.findForSong(title);
    const correctionsForPrompt = corrections.filter(c => c.titulo);
    console.log(`[3/3] Iniciando tradução cultural...`);
    const translationResult = await translationService.translate(title, originalText, correctionsForPrompt);
    console.log(`[3/3] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

    const corrected = correctionsService.applyToResult(translationResult, title);
    const finalResult = collapseRepeats(corrected);

    const coarseLineTimestamps = alignLinesToSegments(finalResult.letra_original, segments, words);
    const forced = whisperPath
      ? await forcedAlignmentService.alignLineTimestamps(
        whisperPath,
        finalResult.letra_original,
        coarseLineTimestamps,
        'en',
      )
      : null;
    const lineTimestamps = forced?.lineTimestamps ?? coarseLineTimestamps;
    let karaokeWords = buildKaraokeWordTimestamps(
      finalResult.letra_original,
      words,
      lineTimestamps,
    );
    if (forced?.lineWords?.length) {
      karaokeWords = mergeWhisperxLineWords(karaokeWords, forced.lineWords);
    }
    const audioId = path.basename(playerPath, path.extname(playerPath));
    audioStore.register(audioId, playerPath);
    // playerPath agora é gerenciado pelo store — não deletar no finally

    console.log(`[OK] audioId registrado: ${audioId} (expira em 10 min)`);
    return res.json({ ...finalResult, titulo: title, audioId, lineTimestamps, karaokeWords });

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
