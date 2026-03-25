const { YoutubeTranscript } = require('youtube-transcript');
const Groq = require('groq-sdk');
const fs = require('fs');

// Extrai o videoId de uma URL normalizada (watch?v=ID)
function extractVideoId(url) {
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}

// Tenta obter legendas automáticas do YouTube (funciona em qualquer IP, sem auth).
// Fallback: tenta sem especificar idioma caso inglês falhe.
async function transcribeViaCaption(videoId) {
  let items;
  try {
    items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  } catch {
    items = await YoutubeTranscript.fetchTranscript(videoId); // sem filtro de idioma
  }
  if (!items || items.length === 0) throw new Error('Transcrição vazia');
  return items.map(t => t.text).join(' ');
}

// Tenta transcrever via Groq Whisper (requer arquivo de áudio local).
// Usado apenas se o arquivo existir (dev local ou futuro suporte a upload).
async function transcribeViaWhisper(filePath) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'text',
    language: 'en',
  });
  return transcription;
}

// Estratégia: captions primeiro (funciona no Render), Whisper como fallback (dev local)
async function transcribe(url, filePath) {
  const videoId = extractVideoId(url);

  // 1. Tenta legendas automáticas do YouTube
  if (videoId) {
    try {
      const text = await transcribeViaCaption(videoId);
      console.log('[transcript] legendas obtidas via YouTube API');
      return text;
    } catch (captionErr) {
      console.warn('[transcript] legendas não disponíveis:', captionErr.message?.slice(0, 80));
    }
  }

  // 2. Fallback: Groq Whisper (requer arquivo de áudio)
  if (filePath && fs.existsSync(filePath)) {
    console.log('[transcript] usando Groq Whisper como fallback');
    return transcribeViaWhisper(filePath);
  }

  throw new Error('Não foi possível transcrever o vídeo. O vídeo não possui legendas automáticas no YouTube.');
}

module.exports = { transcribe };
