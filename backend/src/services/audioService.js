const path = require('path');
const fs = require('fs');
const https = require('https');
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

// Busca título via YouTube oEmbed (API pública, sem autenticação, sem seleção de formato).
// Retorna apenas o título — duração é verificada no download via --match-filter.
async function getMetadata(url) {
  url = normalizeYoutubeUrl(url);

  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

  return new Promise((resolve) => {
    const req = https.get(oembedUrl, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const title = json.title || 'Música sem título';
          console.log(`[oEmbed] título: "${title}"`);
          // duration=0 → rota usa --match-filter no download para checar duração
          resolve({ title, duration: 0 });
        } catch {
          console.warn('[oEmbed] falha ao parsear resposta, usando título padrão');
          resolve({ title: 'Música sem título', duration: 0 });
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[oEmbed] erro de rede:', err.message);
      resolve({ title: 'Música sem título', duration: 0 });
    });

    req.setTimeout(8000, () => {
      req.destroy();
      console.warn('[oEmbed] timeout');
      resolve({ title: 'Música sem título', duration: 0 });
    });
  });
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
      // Rejeita vídeos com mais de 7 minutos (420s) diretamente no yt-dlp
      matchFilter: 'duration <= 420',
    }));
  } catch (err) {
    // yt-dlp sinaliza vídeo longo com "does not pass filter" na mensagem
    if (err.message && err.message.includes('does not pass filter')) {
      throw new Error('Vídeo muito longo. O limite é 7 minutos.');
    }
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
