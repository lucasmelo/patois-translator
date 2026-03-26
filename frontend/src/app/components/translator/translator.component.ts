import { Component, signal, computed, output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationService } from '../../services/translation.service';
import { TranslationResult } from '../../models/translation.model';

@Component({
  selector: 'app-translator',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './translator.component.html',
  styleUrl: './translator.component.css',
})
export class TranslatorComponent {
  private readonly translationService = inject(TranslationService);

  inputMode = signal<'url' | 'text'>('url');
  url = signal('');
  songTitle = signal('');
  lyricsText = signal('');
  loading = signal(false);
  error = signal<string | null>(null);

  translated = output<TranslationResult>();

  statusMessage = computed(() =>
    this.inputMode() === 'url'
      ? 'Buscando legendas e traduzindo com IA... isso pode levar ~15 segundos.'
      : 'Traduzindo com IA...'
  );

  setMode(mode: 'url' | 'text'): void {
    this.inputMode.set(mode);
    this.error.set(null);
  }

  translate(): void {
    if (this.inputMode() === 'url') {
      this.translateUrl();
    } else {
      this.translateText();
    }
  }

  private translateUrl(): void {
    const urlValue = this.url().trim();

    if (!urlValue) {
      this.error.set('Cole um link do YouTube antes de traduzir.');
      return;
    }

    if (!this.isYoutubeUrl(urlValue)) {
      this.error.set('URL inválida. Use um link do YouTube (youtube.com ou youtu.be).');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.translationService.translateUrl(urlValue).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.translated.emit(result);
      },
      error: (err) => this.handleError(err),
    });
  }

  private translateText(): void {
    const text = this.lyricsText().trim();

    if (!text) {
      this.error.set('Cole a letra da música antes de traduzir.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.translationService.translateText(this.songTitle().trim(), text).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.translated.emit(result);
      },
      error: (err) => this.handleError(err),
    });
  }

  private handleError(err: any): void {
    this.loading.set(false);
    const serverMessage: string = err.error?.error ?? '';

    if (err.status === 0) {
      this.error.set('Não foi possível conectar ao servidor. Tente novamente em alguns instantes.');
    } else if (err.status === 400) {
      this.error.set(serverMessage || 'Requisição inválida.');
    } else {
      this.error.set(serverMessage || 'Erro interno no servidor. Tente novamente.');
    }
  }

  private isYoutubeUrl(url: string): boolean {
    return /^(https?:\/\/)?((www\.|m\.)?youtube\.com|youtu\.be)\/.+/.test(url);
  }
}
