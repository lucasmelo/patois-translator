export interface NotaCultural {
  termo: string;
  explicacao: string;
}

export interface TranslationResult {
  letra_original: string;
  letra_traduzida: string;
  analise_de_contexto: string;
  notas_culturais: NotaCultural[];
}
