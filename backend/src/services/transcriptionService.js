const Groq = require('groq-sdk');
const fs = require('fs');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribe(filePath) {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'verbose_json',
    language: 'en',
    temperature: 0,
  });

  // Ordena por timestamp, filtra segmentos com alta probabilidade de não-fala
  // (alucinações do Whisper têm no_speech_prob próximo de 1.0)
  const segments = transcription.segments || [];
  if (segments.length > 0) {
    return segments
      .sort((a, b) => a.start - b.start)
      .filter(s => (s.no_speech_prob ?? 0) < 0.8)
      .map(s => s.text.trim())
      .filter(Boolean)
      .join(' ');
  }

  return transcription.text || '';
}

module.exports = { transcribe };
