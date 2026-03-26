const Groq = require('groq-sdk');
const fs = require('fs');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Vocabulário Patois como prompt inicial para o Whisper.
// O Whisper usa isso para calibrar as probabilidades dos primeiros tokens,
// melhorando drasticamente o reconhecimento de termos jamaicanos que soam
// parecido com inglês padrão (ex: "nah" vs "no", "fi" vs "for", "cyaan" vs "can't").
const PATOIS_PROMPT =
  'Jamaican reggae and dancehall lyrics in Patois. ' +
  'Babylon, Zion, JAH, Jah Rastafari, irie, riddim, dutty, ' +
  'wah gwan, nah, cyaan, bredren, sistren, fi, dem, ' +
  'livity, overstanding, downpressor, I and I, ' +
  'rude boy, bad man, one love, big up, seen.';

async function transcribe(filePath) {
  const transcription = await groq.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-large-v3',
    response_format: 'text',
    language: 'en',
    prompt: PATOIS_PROMPT,
  });

  return transcription;
}

module.exports = { transcribe };
