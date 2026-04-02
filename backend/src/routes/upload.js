const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('node:path');
const audioService = require('../services/audioService');
const transcriptionService = require('../services/transcriptionService');
const translationService = require('../services/translationService');
const correctionsService = require('../services/correctionsService');
const { collapseRepeats } = require('../services/lyricsUtils');

const TEMP_DIR = path.join(__dirname, '../../temp');
const { v4: uuidv4 } = require('uuid');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB — limite do Groq Whisper

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  // Salva com extensão original — Groq usa o nome do arquivo para detectar o tipo
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

  // Usa o nome do arquivo (sem extensão) como título da música
  const title = path.basename(file.originalname, path.extname(file.originalname));

  try {
    console.log(`[1/3] Arquivo recebido: "${file.originalname}" (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    console.log(`[2/3] Enviando áudio para Groq Whisper-large-v3...`);
    const originalText = await transcriptionService.transcribe(file.path);
    console.log(`[2/3] Transcrição OK → ${originalText.length} caracteres`);

    const corrections = correctionsService.findForSong(title);
    const correctionsForPrompt = corrections.filter(c => c.titulo);
    if (corrections.length > 0) {
      console.log(`[3/3] ${corrections.length} correção(ões) encontrada(s) para "${title}"`);
    }
    console.log(`[3/3] Iniciando tradução cultural...`);
    const translationResult = await translationService.translate(title, originalText, correctionsForPrompt);
    console.log(`[3/3] Tradução OK → notas culturais: ${translationResult.notas_culturais?.length ?? 0}`);

    const corrected = correctionsService.applyToResult(translationResult, title);
    const finalResult = collapseRepeats(corrected);
    return res.json({ titulo: title, ...finalResult });

  } catch (err) {
    console.error('[ERRO] Upload pipeline falhou:', err.message);
    return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
  } finally {
    await audioService.deleteFile(file.path);
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
