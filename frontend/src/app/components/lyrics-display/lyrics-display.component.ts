import { Component, input, signal, computed } from '@angular/core';
import { TranslationResult, NotaCultural } from '../../models/translation.model';

@Component({
  selector: 'app-lyrics-display',
  standalone: true,
  templateUrl: './lyrics-display.component.html',
  styleUrl: './lyrics-display.component.css',
})
export class LyricsDisplayComponent {
  result = input.required<TranslationResult>();

  expandedNota = signal<string | null>(null);

  hasNotas = computed(() => this.result().notas_culturais?.length > 0);

  // Zipa linha a linha: [{en, pt}, ...]
  pairedLines = computed(() => {
    const en = (this.result().letra_original ?? '').split('\n');
    const pt = (this.result().letra_traduzida ?? '').split('\n');
    const len = Math.max(en.length, pt.length);
    return Array.from({ length: len }, (_, i) => ({ en: en[i] ?? '', pt: pt[i] ?? '' }));
  });

  toggleNota(termo: string): void {
    this.expandedNota.update((current) => (current === termo ? null : termo));
  }

  isExpanded(termo: string): boolean {
    return this.expandedNota() === termo;
  }

  trackByTermo(_index: number, nota: NotaCultural): string {
    return nota.termo;
  }
}
