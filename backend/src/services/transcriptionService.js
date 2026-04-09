const Groq = require('groq-sdk');
const fs = require('node:fs');
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { spawnSync } = require('node:child_process');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const GAP_THRESHOLD_SECONDS = 8;
const LATE_START_THRESHOLD = 5;
const LOW_CONFIDENCE_MIN_WORDS = 8;
const LOW_CONFIDENCE_MIN_TEXT_CHARS = 24;
const LOW_CONFIDENCE_LATE_START_SECONDS = 14;

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
    timestamp_granularities: ['word', 'segment'],
    language: 'en',
    temperature,
  });
}

function filterWords(words) {
  return (words || [])
    .filter(word =>
      Number.isFinite(word?.start) &&
      Number.isFinite(word?.end) &&
      word.end > word.start &&
      String(word.word ?? '').trim().length > 0
    )
    .sort((a, b) => a.start - b.start);
}

function filterSegments(segments) {
  return (segments || [])
    .sort((a, b) => a.start - b.start)
    .filter(s => (s.no_speech_prob ?? 0) < 0.95);
}

function normalizeTranscriptionResult(result) {
  return {
    segments: filterSegments(result?.segments),
    words: filterWords(result?.words),
  };
}

function getFirstSpeechStart(data) {
  const firstSegmentStart = data.segments[0]?.start ?? Number.POSITIVE_INFINITY;
  const firstWordStart = data.words[0]?.start ?? Number.POSITIVE_INFINITY;
  return Math.min(firstSegmentStart, firstWordStart);
}

// Retry se o início for suspeito (primeiro segmento começa tarde)
async function ensureEarlyStart(filePath, data) {
  const firstStart = getFirstSpeechStart(data);
  if (!Number.isFinite(firstStart) || firstStart <= LATE_START_THRESHOLD) return data;

  console.log(`[Whisper] Início suspeito em ${firstStart.toFixed(1)}s — fazendo retry...`);
  const retry = normalizeTranscriptionResult(await callWhisper(filePath, 0.3));
  const retryFirst = getFirstSpeechStart(retry);

  if (retryFirst < firstStart) {
    console.log(`[Whisper] Retry capturou início em ${retryFirst.toFixed(1)}s — usando retry`);
    return retry;
  }

  console.log(`[Whisper] Retry não melhorou — mantendo original`);
  return data;
}

// Preenche lacunas grandes re-transcrevendo o trecho isolado
async function fillGaps(filePath, data) {
  const { segments, words } = data;
  const gaps = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const gapSize = segments[i + 1].start - segments[i].end;
    if (gapSize > GAP_THRESHOLD_SECONDS) {
      gaps.push({ start: segments[i].end, end: segments[i + 1].start });
    }
  }

  if (gaps.length === 0) return data;

  console.log(`[Whisper] ${gaps.length} lacuna(s) detectada(s) — tentando recuperar...`);

  if (!isFFmpegAvailable()) {
    console.warn('[Whisper] ffmpeg não disponível — lacunas não serão recuperadas');
    return data;
  }

  const recoveredSegments = [...segments];
  const recoveredWords = [...words];
  for (const gap of gaps) {
    const chunkPath = path.join(path.dirname(filePath), `${uuidv4()}_gap.wav`);
    const duration = gap.end - gap.start + 1;
    if (!extractChunk(filePath, gap.start - 0.5, duration + 0.5, chunkPath)) continue;

    try {
      const chunkResult = normalizeTranscriptionResult(await callWhisper(chunkPath));
      const segs = chunkResult.segments
        .map(s => ({ ...s, start: s.start + gap.start - 0.5, end: s.end + gap.start - 0.5 }));
      const chunkWords = chunkResult.words
        .map(word => ({ ...word, start: word.start + gap.start - 0.5, end: word.end + gap.start - 0.5 }));

      if (segs.length > 0) {
        console.log(`[Whisper] Recuperou ${segs.length} segmento(s) em ~${Math.round(gap.start)}s`);
        recoveredSegments.push(...segs);
      }

      if (chunkWords.length > 0) {
        recoveredWords.push(...chunkWords);
      }
    } finally {
      try { fs.unlinkSync(chunkPath); } catch { /* ignora */ }
    }
  }

  recoveredSegments.sort((a, b) => a.start - b.start);
  recoveredWords.sort((a, b) => a.start - b.start);

  return {
    segments: recoveredSegments,
    words: recoveredWords,
  };
}

// Retorna { text, segments } — segments carregam os timestamps para o karaoke
async function transcribe(filePath) {
  let data = normalizeTranscriptionResult(await callWhisper(filePath));
  let { segments, words } = data;

  if (segments.length === 0 && words.length === 0) {
    const result = await callWhisper(filePath);
    return { text: result.text || '', segments: [], words: [] };
  }

  data = await ensureEarlyStart(filePath, data);
  data = await fillGaps(filePath, data);
  ({ segments, words } = data);

  const text = segments.length > 0
    ? segments.map(s => s.text.trim()).filter(Boolean).join(' ')
    : words.map(w => String(w.word).trim()).filter(Boolean).join(' ');
  return { text, segments, words };
}

function isTranscriptionSuspicious(result) {
  const text = String(result?.text ?? '').trim();
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  const words = Array.isArray(result?.words) ? result.words : [];

  if (!text) return true;
  if (segments.length === 0 && words.length < LOW_CONFIDENCE_MIN_WORDS) return true;
  if (text.length < LOW_CONFIDENCE_MIN_TEXT_CHARS && words.length < LOW_CONFIDENCE_MIN_WORDS) return true;

  const firstSegmentStart = segments[0]?.start ?? Number.POSITIVE_INFINITY;
  const firstWordStart = words[0]?.start ?? Number.POSITIVE_INFINITY;
  const firstStart = Math.min(firstSegmentStart, firstWordStart);
  if (Number.isFinite(firstStart) && firstStart > LOW_CONFIDENCE_LATE_START_SECONDS) return true;

  return false;
}

module.exports = { transcribe, isTranscriptionSuspicious };
