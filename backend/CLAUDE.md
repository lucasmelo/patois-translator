# Backend — Patois Translator

## Stack

- **Runtime:** Node.js ≥ 18 (usa `fetch` nativo, `fs.promises`)
- **Framework:** Express 4
- **Transcrição:** Groq Whisper-large-v3 (via `groq-sdk`)
- **Tradução:** LLaMA 3.3 70B Versatile (via `groq-sdk`, mesmo cliente)
- **Download:** yt-dlp-exec + binário yt-dlp baixado no build
- **Outros:** uuid, cors, dotenv

## Estrutura

```
backend/
├── bin/              yt-dlp binário (gerado no build, no .gitignore)
├── temp/             arquivos de áudio temporários (no .gitignore)
├── src/
│   ├── index.js      servidor Express, CORS, rota /api
│   ├── routes/
│   │   └── translate.js    pipeline completo (5 etapas)
│   ├── services/
│   │   ├── audioService.js        yt-dlp: getMetadata + downloadAudio
│   │   ├── transcriptionService.js Groq Whisper
│   │   └── translationService.js  LLaMA 3.3 70B
│   └── prompts/
│       └── systemPrompt.js        prompt cultural (~160 linhas)
```

## Rota Principal: POST /api/translate

```
Body: { url: "https://www.youtube.com/watch?v=..." }

Resposta: {
  letra_original: string,    // Patois com \n entre linhas
  letra_traduzida: string,   // PT-BR com mesmo número de \n
  analise_de_contexto: string,
  notas_culturais: [{ termo, explicacao }]
}
```

Pipeline em `routes/translate.js`:
1. Valida URL (regex: youtube.com, m.youtube.com, youtu.be)
2. `audioService.getMetadata()` → título + duração
3. Valida duração ≤ 420s (7 minutos)
4. `audioService.downloadAudio()` → arquivo mp3 em `temp/`
5. `transcriptionService.transcribe()` → texto contínuo (sem \n)
6. `translationService.translate()` → JSON com \n reconstruídos
7. `finally`: deleta arquivo de áudio (`audioService.deleteFile()`)

## audioService.js — Detalhes Importantes

### Binário yt-dlp
```js
const LOCAL_BIN = path.join(__dirname, '../../bin/yt-dlp');
const YT_DLP_BIN = fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp';
const ytDlp = create(YT_DLP_BIN);
```
Em produção o binário é baixado pelo build command. Em dev usa o yt-dlp do PATH.

### Cookies do YouTube
Escritos em `temp/yt_cookies.txt` ao iniciar, a partir de `YOUTUBE_COOKIES` (formato Netscape). Trim automático aplicado para evitar corrupção por espaços inseridos por dashboards.

### normalizeYoutubeUrl()
Strips `&list=`, `&start_radio=`, `&index=` e similares. Converte `youtu.be/ID` e `/shorts/ID` para `watch?v=ID`. SEMPRE aplicar antes de passar para yt-dlp.

### downloadAudio — Formato
Usa `extractAudio: true, audioFormat: 'mp3', audioQuality: '64K'`. Output em `temp/UUID.mp3`. Arquivo deletado no `finally` da rota.

## translationService.js — O Coração do App

### Modelo
`llama-3.3-70b-versatile` via Groq. Gratuito (100k tokens/dia no free tier). `response_format: { type: 'json_object' }` garante JSON válido.

### Rate Limit (429)
Tratado explicitamente: extrai o tempo de espera da mensagem de erro e retorna mensagem amigável em PT-BR para o usuário.

### Mensagem do Usuário
```js
`Título da música: "${title}"\n\nLetra original (transcrição contínua — sem quebras de linha, você precisa reconstruir a estrutura poética):\n${originalText}`
```
O aviso sobre "transcrição contínua" é intencional — o Whisper não insere \n entre versos.

## systemPrompt.js — Filosofia Cultural

**Este é o arquivo mais importante do projeto.** ~160 linhas divididas em 5 etapas:

### Etapa 1 — Identificação de Vibe
Roots/Conscious · Lovers Rock · Dancehall/Bashment · Culture/Nyahbinghi · Ska/Rocksteady

### Etapa 2 — Dicionário Patois→PT-BR (USE SEMPRE)
Contém termos críticos com nuances que a IA genérica erra:

**Inversões semânticas (armadilhas mais comuns):**
- `bad / bad man` → "foda", "brabo" (NUNCA "mau" ou "vilão")
- `wicked` → "sinistro", "bruto demais" (NUNCA "malvado")
- `hard` → "craque", "monstro" (habilidoso)
- `dread` → "poderoso", "sagrado" (só "terrível" em contexto de Babylon)

**Categorias no dicionário:**
- Espiritualidade Rastafari (Babylon, Zion, JAH, I and I, Livity, Ital...)
- Cotidiano e gírias (Wah gwan, Irie, Riddim, Bredren, Dutty...)
- Status e hierarquia social (Lion, Don Dada, Raggamuffin, Rude boy...)
- Cultura cannabis (Herb/Ganja, Chalice, Spliff, Sinsemilla, Lambsbread...)
- Palavrões com equivalência cultural (Bloodclaat, Bumbaclaat, Rass...)
- Gramática crítica do Patois (marcador "A", "fi", "cyaan", "nah", "dem", "him" neutro)

**Equivalência cultural brasileira:**
- Gueto jamaicano ↔ favela, quebrada, periferia
- Rebel music ↔ rap nacional, baile funk consciente
- Lovers rock ↔ pagode romântico, samba-canção
- Dancehall ostentação ↔ funk ostentação, trap brasileiro

### Etapa 4 — Formatação das Letras (CRÍTICO)
O LLM DEVE reconstruir quebras de linha poéticas a partir do bloco contínuo do Whisper:
- `\n` entre cada frase musical (5-12 palavras)
- `\n\n` entre estrofes
- `letra_original` e `letra_traduzida` com EXATAMENTE o mesmo número de `\n`

Se a IA não gerar \n, o display interleaved no frontend mostra um bloco único ilegível.

## Karaoke: `lineTimestamps` e `karaokeWords`

As rotas `POST /api/translate` e `POST /api/upload` devolvem também:

- **`audioId`** — id do ficheiro servido em `/api/audio/:id` (quando aplicável).
- **`lineTimestamps`** — por linha de `letra_original`, `{ start, end }` em segundos ou `null` (linhas vazias / separadores).
- **`karaokeWords`** — por linha, array de `{ text, start, end }` para highlight palavra a palavra na UI, ou `null`.

Geração:

1. **`lyricsUtils.alignLinesToSegments`** — alinha linhas aos segmentos/palavras do Whisper (Groq).
2. **`karaokeWordAlign.buildKaraokeWordTimestamps`** — mapeia palavras do Whisper aos tokens da linha exibida (DP monotónico + interpolação).
3. **WhisperX (opcional)** — `scripts/whisperx_force_align.py` refina limites de linha e, quando o modelo devolve `words` nos segmentos, envia **`lineWords`** no mesmo JSON; o Node faz merge dos **timestamps** mantendo o **texto** da UI quando o número de tokens coincide.

### Variáveis de ambiente (alinhador)

| Variável | Efeito |
|----------|--------|
| `FORCED_ALIGNMENT_ENABLED` | Se `false`, não executa Python (só heurística JS). |
| `ALIGNER_PYTHON` | Caminho explícito ao interpretador Python (venv). |
| `WHISPERX_DEVICE` / `WHISPERX_COMPUTE_TYPE` | Dispositivo e precisão do WhisperX (ex.: `cpu`, `int8`). |

### Deploy (Render)

O `render.yaml` usa **runtime Node** sem Python nem modelos WhisperX. Em produção no Render, o alinhamento forçado **normalmente fica desligado ou indisponível**; o karaoke fino continua a funcionar com dados do Whisper (Groq) via `karaokeWords`. Para WhisperX em produção, é preciso imagem Docker com Python + dependências, ou um **worker** separado (VPS, Fly.io, etc.).

### Cache de alinhamento (futuro)

Hoje, mesmo com áudio reutilizado por URL (`audioStore.findByUrl`), a transcrição volta a correr. Um cache de resultado por `url + hash(letra_original)` ou por `videoId` poderia poupar Groq e Python; ainda não está implementado.

## Tratamento de Erros

| Cenário | Comportamento |
|---|---|
| URL inválida | 400 com mensagem clara |
| Vídeo > 7 min | 400 com duração exata |
| 429 Groq | 500 com tempo de espera extraído |
| yt-dlp falha | 500 com mensagem amigável (sem mencionar porta 3000) |
| JSON inválido do LLM | 500 solicitando nova tentativa |

## Build Command (Render)
```bash
mkdir -p bin && \
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp && \
chmod +x bin/yt-dlp && \
(apt-get install -y ffmpeg 2>/dev/null || true) && \
npm install --ignore-scripts
```
`--ignore-scripts` evita que yt-dlp-exec tente baixar um binário (usamos o curl acima).
`apt-get ffmpeg` é tentado mas ignorado em caso de falha (alguns ambientes não têm apt).
