import { Component, signal } from '@angular/core';
import { TranslatorComponent } from './components/translator/translator.component';
import { LyricsDisplayComponent } from './components/lyrics-display/lyrics-display.component';
import { TranslationResult } from './models/translation.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [TranslatorComponent, LyricsDisplayComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  result = signal<TranslationResult | null>(null);

  onResult(result: TranslationResult): void {
    this.result.set(result);
    setTimeout(() => {
      document.getElementById('resultado')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }
}
