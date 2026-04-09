export interface NotaCultural {
  termo: string;
  explicacao: string;
}

export interface LineTimestamp {
  start: number; // segundos
  end: number;   // segundos
}

/** Palavra/token com tempo para karaoke fino (alinhado ao áudio). */
export interface KaraokeWordTiming {
  text: string;
  start: number;
  end: number;
}

export interface TranslationResult {
  titulo?: string;
  letra_original: string;
  letra_traduzida: string;
  analise_de_contexto: string;
  notas_culturais: NotaCultural[];
  audioId?: string;
  lineTimestamps?: (LineTimestamp | null)[];
  /** Por linha: tokens da letra original com timestamps; null = linha vazia ou sem dados. */
  karaokeWords?: (KaraokeWordTiming[] | null)[];
}
