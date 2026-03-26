---
description: Padrões e convenções do backend Node.js/Express
---

# Backend — Padrões e Convenções

## Estrutura de Serviços
Cada responsabilidade em seu próprio arquivo em `backend/src/services/`:
- `audioService.js` — tudo relacionado a yt-dlp (metadata + download + delete)
- `transcriptionService.js` — Groq Whisper
- `translationService.js` — LLaMA 3.3 70B + tratamento de 429
- `prompts/systemPrompt.js` — prompt cultural (o mais importante do projeto)

## Regras do audioService
- **Sempre** chamar `normalizeYoutubeUrl()` antes de qualquer chamada yt-dlp — strips `&list=`, `&start_radio=`, etc.
- O binário yt-dlp usa `create()` do yt-dlp-exec: local em `bin/yt-dlp` (produção) ou PATH (dev)
- Cookies carregados de `YOUTUBE_COOKIES` env var com `.trim()` para evitar corrupção por dashboards
- `downloadAudio()` retorna o path do arquivo; `deleteFile()` SEMPRE chamado no `finally` da rota

## Tratamento de Erros na Rota
```js
// Padrão: retornar err.message para o cliente — nunca esconder o erro real
return res.status(500).json({ error: err.message || 'Erro interno. Tente novamente.' });
```
- **400:** URL inválida, duração excedida — com mensagem específica
- **500:** erros de serviço — mensagem real do servidor (incluindo rate limit do Groq)
- Nunca mencionar "porta 3000" em mensagens de erro ao usuário

## translationService — LLM
- Modelo: `llama-3.3-70b-versatile` (gratuito no Groq, 100k tokens/dia)
- `response_format: { type: 'json_object' }` — garante JSON válido sem markdown
- Rate limit 429: extrai tempo de espera com regex e retorna mensagem PT-BR amigável
- A mensagem do usuário avisa o LLM que a transcrição é um bloco contínuo sem \n

## systemPrompt — Modificações
O prompt em `backend/src/prompts/systemPrompt.js` tem ~160 linhas divididas em 5 etapas. Ao modificar:
- Etapa 2 (dicionário) é a mais importante — manter todas as nuances de cada termo
- Etapa 4 (formatação) é crítica para o display interleaved — nunca remover as instruções de \n
- Ao adicionar termos ao dicionário, seguir o padrão: `termo → "equivalente BR"` com contexto de uso

## CORS
```js
const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
const corsOrigin = frontendUrl ? [frontendUrl, 'http://localhost:4200'] : true;
```
`FRONTEND_URL` sem trailing slash. Se não definida, libera tudo (aceitável em beta).

## Render Build Command
```bash
mkdir -p bin && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp && chmod +x bin/yt-dlp && (apt-get install -y ffmpeg 2>/dev/null || true) && npm install --ignore-scripts
```
`--ignore-scripts` impede yt-dlp-exec de tentar baixar binário próprio (usamos o curl).
