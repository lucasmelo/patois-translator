const path = require('node:path');
const fs = require('node:fs');
const { v4: uuidv4 } = require('uuid');
const { create } = require('yt-dlp-exec');
const { spawnSync } = require('node:child_process');

// Em produção (Render): o build baixa o binário para backend/bin/yt-dlp via curl.
// Em dev (Windows/Mac): usa 'yt-dlp' do PATH do sistema.
const LOCAL_BIN = path.join(__dirname, '../../bin/yt-dlp');
const YT_DLP_BIN = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp';
const ytDlp = create(YT_DLP_BIN);
console.log(`[yt-dlp] usando binário: ${YT_DLP_BIN}`);

const TEMP_DIR = path.join(__dirname, '../../temp');

// Cookies do YouTube — necessário em IPs de datacenter (Render, AWS, etc.)
let COOKIES_FILE = null;
if (process.env.YOUTUBE_COOKIES) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  COOKIES_FILE = path.join(TEMP_DIR, 'yt_cookies.txt');
  fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
  console.log('[yt-dlp] cookies carregados via YOUTUBE_COOKIES');
} else {
  console.warn('[yt-dlp] YOUTUBE_COOKIES não definida — pode falhar em IPs de datacenter');
}

function normalizeYoutubeUrl(raw) {
  try {
    const url = new URL(raw.startsWith('http') ? raw : 'https://' + raw);

    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1).split('?')[0];
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    if (url.pathname.includes('/shorts/')) {
      const videoId = url.pathname.split('/shorts/')[1].split('/')[0];
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    const videoId = url.searchParams.get('v');
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

  } catch { /* URL malformada — deixa o yt-dlp rejeitar */ }

  return raw;
}

function ytDlpOptions(extra = {}) {
  return {
    noWarnings: true,
    noCheckCertificates: true,
    noPlaylist: true,
    ...(COOKIES_FILE ? { cookies: COOKIES_FILE } : {}),
    ...extra,
  };
}

async function getMetadata(url) {
  url = normalizeYoutubeUrl(url);
  try {
    const info = await ytDlp(url, ytDlpOptions({
      dumpSingleJson: true,
    }));

    return {
      title: info.title || 'Música sem título',
      duration: info.duration || 0,
    };
  } catch (err) {
    console.error('[yt-dlp] Falha ao buscar metadados:', err.message);
    throw new Error('Não foi possível acessar o vídeo. Verifique a URL ou se o yt-dlp está instalado no PATH.');
  }
}

// Cria uma cópia 16kHz mono WAV do áudio para envio ao Whisper.
// O Whisper resamples tudo para 16kHz internamente — mandar em alta qualidade não melhora a transcrição.
// Separar os dois arquivos permite servir qualidade máxima ao player sem sacrificar espaço no Whisper.
function createWhisperCopy(inputPath) {
  const outputPath = path.join(path.dirname(inputPath), `${uuidv4()}_whisper.wav`);
  const result = spawnSync('ffmpeg', [
    '-i', inputPath,
    '-ar', '16000',
    '-ac', '1',
    '-y', outputPath,
  ], { timeout: 60_000 });

  if (result.status !== 0) {
    throw new Error('Falha ao preparar áudio para transcrição (ffmpeg). Verifique se o ffmpeg está instalado.');
  }
  return outputPath;
}

// Baixa M4A nativo do YouTube (sem reencoding quando possível) para o player/transcrição.
// Retorna { playerPath }:
//   playerPath — M4A de qualidade máxima, servido ao player do browser.
// Fallback para WAV 16kHz é aplicado na rota apenas quando a transcrição falha/parece fraca.
async function downloadAudio(url) {
  url = normalizeYoutubeUrl(url);

  // M4A nativo do YouTube: sem dupla compressão, qualidade de reprodução máxima.
  // yt-dlp faz remux direto quando o stream já é AAC/M4A (sem perda).
  const playerPath = path.join(TEMP_DIR, `${uuidv4()}.m4a`);

  try {
    await ytDlp(url, ytDlpOptions({
      extractAudio: true,
      audioFormat: 'm4a',
      audioQuality: '0',   // melhor qualidade se precisar reencodar (ex: stream Opus → AAC)
      output: playerPath,
    }));
  } catch (err) {
    console.error('[yt-dlp] Falha no download do áudio:', err.message);
    throw new Error('Falha ao baixar o áudio. Verifique se yt-dlp e ffmpeg estão instalados no PATH.');
  }

  return { playerPath };
}

async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignora erro silenciosamente — arquivo pode já ter sido deletado
  }
}

module.exports = { getMetadata, downloadAudio, createWhisperCopy, deleteFile, normalizeYoutubeUrl };
