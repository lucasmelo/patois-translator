// Em produção (Render): o build baixa o binário para backend/bin/yt-dlp via curl.
// Em dev (Windows/Mac): usa 'yt-dlp' do PATH do sistema.
const { create } = require('yt-dlp-exec');
const LOCAL_BIN = path.join(__dirname, '../../bin/yt-dlp');
const YT_DLP_BIN = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp';
const ytDlp = create(YT_DLP_BIN);
console.log(`[yt-dlp] usando binário: ${YT_DLP_BIN}`);
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const TEMP_DIR = path.join(__dirname, '../../temp');

// Normaliza qualquer variante de URL do YouTube para watch?v=ID limpo,
// eliminando &list=, &index=, &start_radio= e outros parâmetros extras.
function normalizeYoutubeUrl(raw) {
  try {
    const url = new URL(raw.startsWith('http') ? raw : 'https://' + raw);

    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1).split('?')[0];
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // youtube.com/shorts/VIDEO_ID
    if (url.pathname.includes('/shorts/')) {
      const videoId = url.pathname.split('/shorts/')[1].split('/')[0];
      return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // youtube.com/watch?v=VIDEO_ID  (descarta &list= e qualquer outro param)
    const videoId = url.searchParams.get('v');
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;

  } catch { /* URL malformada — deixa o yt-dlp rejeitar */ }

  return raw;
}

async function getMetadata(url) {
  url = normalizeYoutubeUrl(url);
  try {
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
      noPlaylist: true,
    });

    return {
      title: info.title || 'Música sem título',
      duration: info.duration || 0,
    };
  } catch (err) {
    console.error('[yt-dlp] Falha ao buscar metadados:', err.message);
    throw new Error('Não foi possível acessar o vídeo. Verifique a URL ou se o yt-dlp está instalado no PATH.');
  }
}

async function downloadAudio(url) {
  url = normalizeYoutubeUrl(url);
  const fileName = `${uuidv4()}.mp3`;
  const filePath = path.join(TEMP_DIR, fileName);

  try {
    await ytDlp(url, {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: '64K',
      output: filePath,
      noWarnings: true,
      noCheckCertificates: true,
      noPlaylist: true,
    });
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
