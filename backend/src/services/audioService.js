const ytDlp = require('yt-dlp-exec');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const TEMP_DIR = path.join(__dirname, '../../temp');

async function getMetadata(url) {
  try {
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noWarnings: true,
      noCheckCertificates: true,
      preferFreeFormats: true,
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
