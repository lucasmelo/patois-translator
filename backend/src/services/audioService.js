const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const crypto = require('crypto');
const ytdl = require('@distube/ytdl-core');

const TEMP_DIR = path.join(__dirname, '../../temp');
const MAX_DURATION_SECONDS = 420; // 7 minutos

async function getMetadata(url) {
  try {
    const info = await ytdl.getInfo(url);
    return {
      title: info.videoDetails.title || 'Música sem título',
      duration: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
    };
  } catch (err) {
    throw new Error(`Não foi possível acessar o vídeo. Verifique a URL e tente novamente.`);
  }
}

// Baixa apenas a faixa de áudio (sem vídeo, sem ffmpeg).
// @distube/ytdl-core é Node.js puro — sem binários externos, sem cookies.
// Retorna um arquivo .webm que o Groq Whisper aceita diretamente.
async function downloadAudio(url) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const filePath = path.join(TEMP_DIR, `${crypto.randomUUID()}.webm`);

  const audioStream = ytdl(url, {
    quality: 'lowestaudio',
    filter: 'audioonly',
  });

  await pipeline(audioStream, fs.createWriteStream(filePath));
  return filePath;
}

async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // silencioso — arquivo pode já ter sido deletado
  }
}

module.exports = { getMetadata, downloadAudio, deleteFile, MAX_DURATION_SECONDS };
