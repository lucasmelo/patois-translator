# Patois Translator — Contexto do Projeto

## O que é

Aplicação web full-stack que transcreve músicas jamaicanas do YouTube e as traduz de **Patois Jamaicano → Português Brasileiro** com profundidade cultural. O diferencial não é a tradução literal — é capturar a **ginga, o swing e a malandragem** da música jamaicana em equivalências culturais brasileiras.

## Estrutura do Monorepo

```
/
├── backend/          Node.js + Express (API REST)
├── frontend/         Angular 20 (standalone + signals)
├── render.yaml       Config de deploy do backend (Render)
└── CLAUDE.md         ← você está aqui
```

## Pipeline de Processamento

```
URL YouTube
  │
  ├─[1]─ yt-dlp → baixa áudio (mp3, 64kbps)
  │       └─ requer: bin/yt-dlp local (baixado no build) + cookies do YouTube
  │
  ├─[2]─ Groq Whisper-large-v3 → transcreve o áudio (inglês)
  │       └─ retorna bloco de texto CONTÍNUO, sem quebras de linha
  │
  ├─[3]─ LLaMA 3.3 70B (via Groq) → tradução cultural
  │       └─ usa system prompt enriquecido (~160 linhas)
  │       └─ DEVE reconstruir quebras de linha poéticas a partir do bloco contínuo
  │
  └─[4]─ JSON → frontend renderiza interleaved (linha EN bold + linha PT abaixo)
```

## Deploy

| Serviço | URL | Notas |
|---|---|---|
| Frontend | Vercel | build `ng build --configuration production` |
| Backend | Render (free tier) | `render.yaml` na raiz |
| Backend prod URL | `https://patois-translator.onrender.com` | atualizar em `environment.prod.ts` se mudar |

## Variáveis de Ambiente (Backend)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Transcrição (Whisper) + Tradução (LLaMA) |
| `YOUTUBE_COOKIES` | ⚠️ | Cookies Netscape do YouTube (necessário em IPs de datacenter) |
| `FRONTEND_URL` | ⚠️ | URL do frontend em produção (configura CORS) — sem trailing slash |
| `PORT` | auto | Render define automaticamente |

## Problema Crítico de Produção — YouTube em Datacenter

YouTube bloqueia downloads de IPs de datacenter (Render, AWS, GCP, etc.) mesmo com cookies válidos. O yt-dlp retorna `Requested format is not available` para TODOS os vídeos.

**Workarounds testados e que não funcionam:** cookies expirados/frescos, player_client ios/android/web_embedded/tv_embedded, --no-check-formats, --geo-bypass, --match-filter.

**Solução real:** hospedar em serviço com IPs residenciais/menos flagrados: Railway, Fly.io, Oracle Free Tier (VPS), ou usar AssemblyAI (transcreve direto de URL do YouTube sem download).

## Desenvolvimento Local

```bash
# Backend
cd backend && npm install
# Criar .env com GROQ_API_KEY=...
node src/index.js   # ou: npm run dev

# Frontend
cd frontend && npm install
ng serve            # http://localhost:4200
```

O yt-dlp precisa estar instalado no PATH para dev local (`pip install yt-dlp` ou `brew install yt-dlp`).
