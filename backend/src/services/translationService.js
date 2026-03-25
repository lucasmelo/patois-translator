const Groq = require('groq-sdk');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Llama 3.3 70B: multilíngue, excelente para PT-BR, 100% gratuito no Groq
const MODEL_NAME = 'llama-3.3-70b-versatile';

async function translate(title, originalText) {
  const userMessage = `Título da música: "${title}"\n\nLetra original:\n${originalText}`;

  let completion;
  try {
    completion = await groq.chat.completions.create({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });
  } catch (err) {
    // 429 — limite de tokens diários do Groq atingido
    if (err.status === 429) {
      const waitMatch = err.message?.match(/try again in ([^\\.]+)/i);
      const wait = waitMatch ? waitMatch[1].trim() : 'alguns minutos';
      throw new Error(`Limite de uso da IA atingido. Tente novamente em ${wait}.`);
    }
    throw err;
  }

  const rawText = completion.choices[0]?.message?.content ?? '';

  try {
    return JSON.parse(rawText);
  } catch {
    console.error('[Groq/LLM] Resposta bruta não é JSON válido:\n', rawText);
    throw new Error('O modelo retornou um JSON inválido. Tente novamente.');
  }
}

module.exports = { translate };
