const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { create } = require('yt-dlp-exec');

// Em produção (Render): o build baixa o binário para backend/bin/yt-dlp via curl.
// Em dev (Windows/Mac): usa 'yt-dlp' do PATH do sistema.
const LOCAL_BIN = path.join(__dirname, '../../bin/yt-dlp');
const YT_DLP_BIN = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp';
const ytDlp = create(YT_DLP_BIN);
console.log(`[yt-dlp] usando binário: ${YT_DLP_BIN}`);

const TEMP_DIR = path.join(__dirname, '../../temp');

// Cookies do YouTube — necessário em IPs de datacenter (Render, AWS, etc.)
// No Render: Environment → YOUTUBE_COOKIES = conteúdo do arquivo cookies.txt (formato Netscape)
let COOKIES_FILE = null;
if (process.env.YOUTUBE_COOKIES) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  COOKIES_FILE = path.join(TEMP_DIR, 'yt_cookies.txt');
  fs.writeFileSync(COOKIES_FILE, process.env.YOUTUBE_COOKIES, 'utf8');
  console.log('[yt-dlp] cookies carregados via YOUTUBE_COOKIES');
} else {
  console.warn('[yt-dlp] YOUTUBE_COOKIES não definida — pode falhar em IPs de datacenter');
}

// Normaliza qualquer variante de URL do YouTube para watch?v=ID limpo,
// eliminando &list=, &index=, &start_radio= e outros parâmetros extras.
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
    // --print + --no-check-formats evita a seleção de formato que causa
    // "Requested format is not available" — para metadados não precisamos de formato.
    const raw = await ytDlp(url, ytDlpOptions({
      print: '%(title)s\n%(duration)s',
      skipDownload: true,
      noCheckFormats: true,
    }));

    const lines = String(raw).trim().split('\n');
    const title = lines[0] || 'Música sem título';
    const duration = parseInt(lines[1]) || 0;

    return { title, duration };
  } catch (err) {
    console.error('[yt-dlp] Falha ao buscar metadados:', err.message);
    throw new Error('Não foi possível acessar o vídeo. Verifique a URL ou se o yt-dlp está instalado no PATH.');
  }
}

async function downloadAudio(url) {
  url = normalizeYoutubeUrl(url);
  const filePath = path.join(TEMP_DIR, `${uuidv4()}.mp3`);

  try {
    await ytDlp(url, ytDlpOptions({
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '64K',
      output: filePath,
    }));
  } catch (err) {
    console.error('[yt-dlp] Falha no download do áudio:', err.message);
    throw new Error('Falha ao baixar o áudio. Verifique se yt-dlp e ffmpeg estão instalados no PATH.');
  }

  return filePath;
}

async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignora erro silenciosamente — arquivo pode já ter sido deletado
  }
}

module.exports = { getMetadata, downloadAudio, deleteFile };
