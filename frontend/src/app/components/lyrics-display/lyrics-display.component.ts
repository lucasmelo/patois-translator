import { Component, input, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationResult, NotaCultural } from '../../models/translation.model';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-lyrics-display',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lyrics-display.component.html',
  styleUrl: './lyrics-display.component.css',
})
export class LyricsDisplayComponent {
  private readonly translationService = inject(TranslationService);

  result = input.required<TranslationResult>();

  expandedNota = signal<string | null>(null);
  editingIndex = signal<number | null>(null);
  savedIndices = signal<Set<number>>(new Set());
  editEn = signal('');
  editPt = signal('');
  songSaveState = signal<'idle' | 'saving' | 'saved'>('idle');

  hasNotas = computed(() => this.result().notas_culturais?.length > 0);

  // Linhas originais vindas da API
  private readonly sourcePairs = computed(() => {
    const en = (this.result().letra_original ?? '').split('\n');
    const pt = (this.result().letra_traduzida ?? '').split('\n');
    const len = Math.max(en.length, pt.length);
    return Array.from({ length: len }, (_, i) => ({ en: en[i] ?? '', pt: pt[i] ?? '' }));
  });

  // Correções do usuário: índice → {en, pt} corrigido
  private readonly edits = signal<Record<number, { en: string; pt: string }>>({});

  // Display final: sobreporõe edits nas linhas originais
  pairedLines = computed(() =>
    this.sourcePairs().map((pair, i) => this.edits()[i] ?? pair)
  );

  isEdited(index: number): boolean {
    return index in this.edits();
  }

  isSaved(index: number): boolean {
    return this.savedIndices().has(index);
  }

  startEdit(index: number): void {
    const pair = this.pairedLines()[index];
    this.editingIndex.set(index);
    this.editEn.set(pair.en);
    this.editPt.set(pair.pt);
  }

  cancelEdit(): void {
    this.editingIndex.set(null);
  }

  confirmEdit(index: number): void {
    const en = this.editEn().trim();
    const pt = this.editPt().trim();
    this.edits.update(prev => ({ ...prev, [index]: { en, pt } }));
    this.editingIndex.set(null);
  }

  saveCorrection(index: number): void {
    const original = this.sourcePairs()[index];
    const edited = this.edits()[index];
    if (!edited) return;

    this.translationService.saveCorrection({
      titulo: this.result().titulo,
      linha_en_original: original.en,
      linha_pt_original: original.pt,
      linha_en_corrigida: edited.en,
      linha_pt_corrigida: edited.pt,
    }).subscribe({
      next: () => {
        this.savedIndices.update(prev => new Set([...prev, index]));
      },
    });
  }

  saveSong(): void {
    this.songSaveState.set('saving');
    // Usa as linhas com edições aplicadas para salvar a versão mais correta
    const result = {
      ...this.result(),
      letra_original: this.pairedLines().map(p => p.en).join('\n'),
      letra_traduzida: this.pairedLines().map(p => p.pt).join('\n'),
    };
    this.translationService.saveSong(result).subscribe({
      next: () => this.songSaveState.set('saved'),
      error: () => this.songSaveState.set('idle'),
    });
  }

  toggleNota(termo: string): void {
    this.expandedNota.update(current => (current === termo ? null : termo));
  }

  isExpanded(termo: string): boolean {
    return this.expandedNota() === termo;
  }

  trackByTermo(_index: number, nota: NotaCultural): string {
    return nota.termo;
  }
}
