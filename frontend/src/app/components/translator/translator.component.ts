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

  url = signal('');
  loading = signal(false);
  error = signal<string | null>(null);

  translated = output<TranslationResult>();

  translate(): void {
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
      error: (err) => {
        this.loading.set(false);
        const serverMessage: string = err.error?.error ?? '';

        if (err.status === 0) {
          this.error.set('Não foi possível conectar ao servidor. Verifique se o backend está rodando na porta 3000.');
        } else if (err.status === 400) {
          this.error.set(serverMessage || 'Requisição inválida.');
        } else {
          // Para 500 e outros, exibe a mensagem real vinda do servidor
          this.error.set(serverMessage || 'Erro interno no servidor. Tente novamente.');
        }
      },
    });
  }

  private isYoutubeUrl(url: string): boolean {
    return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(url);
  }
}
