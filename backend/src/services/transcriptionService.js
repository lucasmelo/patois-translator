const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { spawnSync } = require('child_process');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GAP_THRESHOLD_SECONDS = 8;
const LATE_START_THRESHOLD = 5;

function isFFmpegAvailable() {
  try {
    return spawnSync('ffmpeg', ['-version'], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
}

function extractChunk(inputPath, start, duration, outputPath) {
  return spawnSync('ffmpeg', [
    '-ss', String(Math.max(0, start)),
    '-t', String(duration),
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-y', outputPath,
  ], { timeout: 30000 }).status === 0;
}

async function callWhisper(filePath, temperature = 0.15) {
  return groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    language: 'en',
    temperature,
  });
}

function filterSegments(segments) {
  return (segments || [])
    .sort((a, b) => a.start - b.start)
    .filter(s => (s.no_speech_prob ?? 0) < 0.95);
}

// Retry se o início for suspeito (primeiro segmento começa tarde)
async function ensureEarlyStart(filePath, segments) {
  const firstStart = segments[0]?.start ?? 0;
  if (firstStart <= LATE_START_THRESHOLD) return segments;

  console.log(`[Whisper] Início suspeito em ${firstStart.toFixed(1)}s — fazendo retry...`);
  const retry = filterSegments((await callWhisper(filePath, 0.3)).segments);
  const retryFirst = retry[0]?.start ?? Infinity;

  if (retryFirst < firstStart) {
    console.log(`[Whisper] Retry capturou início em ${retryFirst.toFixed(1)}s — usando retry`);
    return retry;
  }

  console.log(`[Whisper] Retry não melhorou — mantendo original`);
  return segments;
}

// Preenche lacunas grandes re-transcrevendo o trecho isolado
async function fillGaps(filePath, segments) {
  const gaps = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const gapSize = segments[i + 1].start - segments[i].end;
    if (gapSize > GAP_THRESHOLD_SECONDS) {
      gaps.push({ start: segments[i].end, end: segments[i + 1].start });
    }
  }

  if (gaps.length === 0) return segments;

  console.log(`[Whisper] ${gaps.length} lacuna(s) detectada(s) — tentando recuperar...`);

  if (!isFFmpegAvailable()) {
    console.warn('[Whisper] ffmpeg não disponível — lacunas não serão recuperadas');
    return segments;
  }

  const recovered = [...segments];
  for (const gap of gaps) {
    const chunkPath = path.join(path.dirname(filePath), `${uuidv4()}_gap.wav`);
    const duration = gap.end - gap.start + 1;
    if (!extractChunk(filePath, gap.start - 0.5, duration + 0.5, chunkPath)) continue;

    try {
      const chunkResult = await callWhisper(chunkPath);
      const segs = (chunkResult.segments || [])
        .filter(s => (s.no_speech_prob ?? 0) < 0.95)
        .map(s => ({ ...s, start: s.start + gap.start - 0.5, end: s.end + gap.start - 0.5 }));

      if (segs.length > 0) {
        console.log(`[Whisper] Recuperou ${segs.length} segmento(s) em ~${Math.round(gap.start)}s`);
        recovered.push(...segs);
      }
    } finally {
      try { fs.unlinkSync(chunkPath); } catch { /* ignora */ }
    }
  }

  return recovered.sort((a, b) => a.start - b.start);
}

// Retorna { text, segments } — segments carregam os timestamps para o karaoke
async function transcribe(filePath) {
  const result = await callWhisper(filePath);
  let segments = filterSegments(result.segments);

  if (segments.length === 0) return { text: result.text || '', segments: [] };

  segments = await ensureEarlyStart(filePath, segments);
  segments = await fillGaps(filePath, segments);

  const text = segments.map(s => s.text.trim()).filter(Boolean).join(' ');
  return { text, segments };
}

module.exports = { transcribe };
