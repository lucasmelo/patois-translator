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
