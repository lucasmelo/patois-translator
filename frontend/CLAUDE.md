# Frontend — Patois Translator

## Stack

- **Framework:** Angular 20 (standalone components, sem NgModules)
- **Estado:** Signals (`signal()`, `computed()`, `input()`, `output()`)
- **HTTP:** `HttpClient` via `inject()` em serviço standalone
- **Estilo:** CSS puro por componente (sem Tailwind, sem Material)
- **Build:** `ng build --configuration production` → Vercel

## Estrutura

```
frontend/src/app/
├── app.component.ts/html/css     shell: gerencia `result` signal, scroll suave
├── models/
│   └── translation.model.ts     interfaces: TranslationResult, NotaCultural
├── services/
│   └── translation.service.ts   HTTP POST /api/translate
├── environments/
│   ├── environment.ts            { production: false, apiUrl: 'http://localhost:3000' }
│   └── environment.prod.ts       { production: true, apiUrl: 'https://patois-translator.onrender.com' }
└── components/
    ├── translator/               input de URL + botão + estados de loading/erro
    └── lyrics-display/           exibe resultado: análise, letras, notas culturais
```

## Padrões Angular 20 Usados

### Signals
```ts
url = signal('');
loading = signal(false);
result = signal<TranslationResult | null>(null);
pairedLines = computed(() => { ... });  // derivado, nunca signal manual
```

### Inputs/Outputs modernos
```ts
result = input.required<TranslationResult>();   // não usa @Input()
translated = output<TranslationResult>();        // não usa @EventEmitter
```

### Control flow (@if / @for)
```html
@if (result()) { <app-lyrics-display [result]="result()!" /> }
@for (nota of result().notas_culturais; track trackByTermo($index, nota)) { ... }
```

**Nunca usar** `*ngIf`, `*ngFor` ou `NgIf`/`NgFor` — projeto 100% Angular 20 moderno.

## Componente: translator

Responsabilidades:
- Validação de URL no frontend (regex: youtube.com, m.youtube.com, youtu.be)
- Gerencia loading state durante a requisição
- Trata erros por status HTTP:
  - `status === 0` → servidor inacessível (mensagem genérica, não menciona porta)
  - `status === 400` → mensagem do servidor (URL inválida, vídeo longo)
  - `status >= 500` → mensagem real do servidor (rate limit, etc.)
- Emite resultado via `output()` para o `AppComponent`

## Componente: lyrics-display

### Display interleaved (linha a linha)
O `pairedLines` computed zipa as duas letras linha por linha:
```ts
pairedLines = computed(() => {
  const en = (this.result().letra_original ?? '').split('\n');
  const pt = (this.result().letra_traduzida ?? '').split('\n');
  const len = Math.max(en.length, pt.length);
  return Array.from({ length: len }, (_, i) => ({ en: en[i] ?? '', pt: pt[i] ?? '' }));
});
```

Renderização:
- Linha com conteúdo → `<div class="line-pair">`: linha EN em **bold** + linha PT com borda verde à esquerda
- Linha vazia (entre estrofes) → `<div class="line-break">` (1rem de espaço)

**DEPENDÊNCIA CRÍTICA:** esse display só funciona bem se o backend retornar `\n` entre os versos. Se o LLM retornar um bloco sem `\n`, tudo aparece numa linha só. Veja `backend/CLAUDE.md` → systemPrompt.js → Etapa 4.

### Notas Culturais
Cards clicáveis com `expandedNota` signal. `toggleNota()` abre/fecha. `trackByTermo()` como track function no `@for`.

## Design System (CSS Variables)

Definidas em `styles.css` global:
```css
--jamaica-green: #007A3D    /* verde da bandeira */
--jamaica-yellow: #FFD100   /* amarelo da bandeira */
--surface, --surface-2, --surface-3  /* backgrounds em camadas */
--text-primary, --text-secondary
--font-lyrics: /* fonte monospace/poética para as letras */
--radius: border-radius padrão
```

Paleta tema dark inspirada nas cores da bandeira jamaicana. Manter consistência com estas variáveis ao adicionar novos elementos.

## Serviço de Tradução

```ts
translate(url: string): Observable<TranslationResult> {
  return this.http.post<TranslationResult>(`${this.apiBase}/api/translate`, { url });
}
```

`apiBase` vem de `environment.apiUrl`. **Nunca hardcodar URLs** — sempre usar o environment.

## Para Atualizar a URL do Backend em Produção

1. Alterar `frontend/src/environments/environment.prod.ts` → `apiUrl`
2. Rebuild e redeploy no Vercel

## Deploy (Vercel)

- Build command: `ng build --configuration production`
- Output dir: `dist/frontend/browser`
- Framework: Angular (detectado automático)
- Sem variáveis de ambiente necessárias no frontend (apiUrl está no build)
