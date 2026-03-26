---
description: Workflow de desenvolvimento, git e deploy
---

# Workflow de Desenvolvimento

## Git
- Branch principal: `main`
- Commits com Co-Authored-By Claude quando assistido por IA
- Conta: `lucasmelo` no GitHub (`github.com/lucasmelo/patois-translator`)
- Para push autenticado: `git remote set-url origin https://PERSONAL_ACCESS_TOKEN@github.com/lucasmelo/patois-translator.git`
- Sempre restaurar URL sem token após push: `git remote set-url origin https://github.com/lucasmelo/patois-translator.git`

## Dev Local

```bash
# Backend (terminal 1)
cd backend
npm install
# criar .env com: GROQ_API_KEY=gsk_...
npm run dev        # nodemon em :3000

# Frontend (terminal 2)
cd frontend
npm install
ng serve           # http://localhost:4200
```

Requisito local: `yt-dlp` no PATH do sistema.

## Deploy Frontend (Vercel)
Push para `main` → Vercel auto-deploya. Sem configuração extra necessária.
Build: `ng build --configuration production` / Output: `dist/frontend/browser`

## Deploy Backend (Render)
Push para `main` → Render auto-deploya (se configurado com auto-deploy).
O `render.yaml` na raiz define build e start commands.
Após mudar build command no `render.yaml`, precisa de manual redeploy no painel.

## Testar Localmente Antes de Subir
1. `npm run dev` no backend
2. `ng serve` no frontend
3. Testar com uma música curta (< 2 min) para não gastar tokens do Groq
4. Verificar no console do backend os logs de cada etapa [1/5] a [5/5]

## Groq Rate Limits (Free Tier)
- Whisper: limitado por minutos de áudio/hora
- LLaMA 3.3 70B: 100k tokens/dia, 6k tokens/minuto
- Quando 429: a mensagem de erro já extrai o tempo de espera e exibe para o usuário

## Adicionando Termos ao Dicionário Cultural
Editar `backend/src/prompts/systemPrompt.js` → Etapa 2. Formato:
```
- Termo → "tradução PT-BR" (contexto de uso quando necessário)
```
Categorias existentes: inversões semânticas, Rastafari, cotidiano/gírias, status social, cannabis, palavrões, lugares.

## Mudando de Host para o Backend
1. Atualizar `frontend/src/environments/environment.prod.ts` → `apiUrl`
2. Atualizar `FRONTEND_URL` no novo host → URL do Vercel sem trailing slash
3. Configurar variáveis: `GROQ_API_KEY`, `YOUTUBE_COOKIES`
4. Verificar se o host tem restrições de IP do YouTube (se sim, usar alternativa)
