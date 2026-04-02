import { Component, signal, output, inject } from '@angular/core';
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

  mode = signal<'url' | 'file'>('url');
  url = signal('');
  selectedFile = signal<File | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);

  translated = output<TranslationResult>();

  setMode(mode: 'url' | 'file'): void {
    this.mode.set(mode);
    this.error.set(null);
    this.url.set('');
    this.selectedFile.set(null);
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile.set(file);
    this.error.set(null);
  }

  translate(): void {
    if (this.mode() === 'url') {
      this.translateByUrl();
    } else {
      this.translateByFile();
    }
  }

  private translateByUrl(): void {
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

    this.translationService.translate(urlValue).subscribe({
      next: (result) => {
        this.loading.set(false);
        this.translated.emit(result);
      },
      error: (err) => this.handleError(err),
    });
  }

  private translateByFile(): void {
    const file = this.selectedFile();

    if (!file) {
      this.error.set('Selecione um arquivo MP3 ou WAV antes de traduzir.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.translationService.translateFile(file).subscribe({
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
