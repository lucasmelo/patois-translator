---
description: Visão geral e arquitetura do Patois Translator
---

# Patois Translator — Visão Geral

Monorepo com dois projetos:
- `backend/` — Node.js + Express (API REST, porta 3000 em dev)
- `frontend/` — Angular 20 standalone + Signals

## Pipeline de Processamento

```
URL YouTube → yt-dlp (download mp3) → Groq Whisper-large-v3 (transcrição)
→ LLaMA 3.3 70B via Groq (tradução cultural) → JSON → Angular frontend
```

## Deploy Atual
- Frontend: Vercel
- Backend: Render (free tier) em `https://patois-translator.onrender.com`
- `environment.prod.ts` tem a URL do backend hardcoded — atualizar se mudar de host

## Variáveis de Ambiente (backend)
- `GROQ_API_KEY` — obrigatório para transcrição e tradução
- `YOUTUBE_COOKIES` — cookies Netscape do YouTube (essencial em IPs de datacenter)
- `FRONTEND_URL` — URL do frontend sem trailing slash (configura CORS)

## Problema Crítico Conhecido
YouTube bloqueia downloads de IPs de datacenter (Render, AWS, etc.) independente de cookies. O `yt-dlp` retorna `Requested format is not available` para todos os vídeos. Funciona perfeitamente em desenvolvimento local. Para produção, considerar: Railway, Fly.io, Oracle Free Tier, ou AssemblyAI (transcreve via URL sem download local).
