---
description: Padrões Angular 20 e convenções do frontend
---

# Frontend — Padrões Angular 20

## Regra Principal: Angular 20 Moderno
**Nunca usar APIs legadas.** Este projeto usa exclusivamente:
- `signal()`, `computed()`, `input()`, `output()` — sem `@Input()`, `@Output()`, `EventEmitter`
- `@if` / `@for` no template — sem `*ngIf`, `*ngFor`, `NgIf`, `NgFor`
- Componentes standalone — sem NgModules, sem `declarations`
- `inject()` — sem construtor para injeção de dependência

## Exemplo de Componente Correto
```ts
@Component({ selector: 'app-foo', standalone: true, ... })
export class FooComponent {
  value = input.required<string>();
  changed = output<string>();
  doubled = computed(() => this.value() + this.value());
}
```

## Estado Global
`AppComponent` gerencia `result = signal<TranslationResult | null>(null)`. Fluxo:
1. `TranslatorComponent` emite via `translated = output<TranslationResult>()`
2. `AppComponent.onResult()` recebe e seta o signal
3. `LyricsDisplayComponent` recebe via `result = input.required<TranslationResult>()`

## Display Interleaved de Letras
`pairedLines` computed em `LyricsDisplayComponent` faz zip das duas letras linha por linha. **Depende de `\n` no response do LLM.** Se o display aparecer como bloco único, o problema é no backend (LLM não gerou \n) — não no frontend.

```ts
pairedLines = computed(() => {
  const en = (this.result().letra_original ?? '').split('\n');
  const pt = (this.result().letra_traduzida ?? '').split('\n');
  const len = Math.max(en.length, pt.length);
  return Array.from({ length: len }, (_, i) => ({ en: en[i] ?? '', pt: pt[i] ?? '' }));
});
```

## CSS — Design System
Usar sempre as CSS variables definidas em `styles.css`:
- `--jamaica-green: #007A3D` e `--jamaica-yellow: #FFD100` — cores da bandeira jamaicana
- `--surface`, `--surface-2`, `--surface-3` — backgrounds em camadas (dark theme)
- `--text-primary`, `--text-secondary`
- `--font-lyrics` — fonte para as letras das músicas
- `--radius` — border-radius padrão

## API URL
Sempre usar `environment.apiUrl` do serviço de tradução. Nunca hardcodar URLs.
- Dev: `http://localhost:3000`
- Prod: `https://patois-translator.onrender.com` (em `environment.prod.ts`)

## Tratamento de Erros HTTP no Translator
- `status === 0` → sem conexão (mensagem genérica, não menciona porta)
- `status === 400` → mensagem do servidor (URL inválida, vídeo longo)
- `status >= 500` → mensagem real vinda do servidor (`err.error?.error`)

## Notas Culturais
Cards clicáveis com signal `expandedNota`. Um card aberto de cada vez. Track function `trackByTermo` no `@for`.
