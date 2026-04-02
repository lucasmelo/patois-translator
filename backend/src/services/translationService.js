const Anthropic = require('@anthropic-ai/sdk');
const SYSTEM_PROMPT = require('../prompts/systemPrompt');
const songsService = require('./songsService');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Claude Sonnet: melhor qualidade para tradução cultural criativa
const MODEL_NAME = 'claude-sonnet-4-6';

async function translate(title, originalText, corrections = []) {
  // Exemplos de traduções validadas pelo usuário para enriquecer o estilo
  let vocabBlock = '';
  const examples = songsService.getVocabExamples();
  if (examples.length > 0) {
    const lines = examples.map(e => `  • "${e.en}" → "${e.pt}"`).join('\n');
    vocabBlock = `\n\n📚 EXEMPLOS DE TRADUÇÕES VALIDADAS PELO USUÁRIO (use como referência de estilo e vocabulário):\n${lines}`;
  }

  let correctionsBlock = '';
  if (corrections.length > 0) {
    const lines = corrections
      .map(c => `  • Original: "${c.linha_en_original}" → EN corrigido: "${c.linha_en_corrigida}" | PT corrigido: "${c.linha_pt_corrigida}"`)
      .join('\n');
    correctionsBlock = `\n\n✅ CORREÇÕES HUMANAS VALIDADAS PARA ESTA MÚSICA (aplique exatamente — um humano revisou e corrigiu estas linhas):
${lines}
Ao encontrar estas linhas ou variações próximas, use as versões corrigidas acima.`;
  }

  const userMessage = `Título da música: "${title}"

⚠️ ATENÇÃO — TRANSCRIÇÃO AUTOMÁTICA COM ANGLICIZAÇÃO:
O áudio foi transcrito pelo Whisper (IA) que não conhece Patois Jamaicano. Ele angliciza as palavras automaticamente. Exemplos do que pode ter ocorrido:
- "mi" → transcrito como "me", "my" ou "I"
- "nah/nuh" → transcrito como "no", "not" ou "na"
- "di/de" → transcrito como "the"
- "inna" → transcrito como "in a" ou "in the"
- "fi" → transcrito como "to" ou "for"
- "bwoy/bwai" → transcrito como "boy"
- "gyal" → transcrito como "girl" ou "gal"
- "likkle" → transcrito como "little"
- "cyaan" → transcrito como "can't" ou "can"
- "haffi" → transcrito como "have to"
- "wah gwan" → transcrito como "what's going on"
- "pickney" → transcrito como "picking" ou errado
- "dutty" → transcrito como "dirty"
- "riddim" → transcrito como "rhythm"

Mesmo que o texto abaixo pareça inglês comum, trate-o como música jamaicana. Reconheça o contexto cultural, aplique o dicionário Patois→PT-BR e faça a equivalência cultural brasileira.

Letra original (transcrição contínua — sem quebras de linha, reconstrua a estrutura poética):
${originalText}${vocabBlock}${correctionsBlock}`;

  let message;
  try {
    message = await anthropic.messages.create({
      model: MODEL_NAME,
      max_tokens: 4096,
      temperature: 0.7,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    if (err.status === 429) {
      throw new Error('Limite de uso da IA atingido. Tente novamente em alguns minutos.');
    }
    throw err;
  }

  const rawText = message.content[0]?.text ?? '';

  // Extrai o objeto JSON mesmo que o Claude adicione texto ou ```json``` ao redor
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  const jsonStr = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;

  try {
    return JSON.parse(jsonStr);
  } catch {
    console.error('[Claude] Resposta bruta não é JSON válido:\n', rawText);
    throw new Error('O modelo retornou um JSON inválido. Tente novamente.');
  }
}

module.exports = { translate };
