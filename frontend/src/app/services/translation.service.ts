import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TranslationResult } from '../models/translation.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiUrl;

  translateUrl(url: string): Observable<TranslationResult> {
    return this.http.post<TranslationResult>(`${this.apiBase}/api/translate`, { url });
  }

  translateText(title: string, text: string): Observable<TranslationResult> {
    return this.http.post<TranslationResult>(`${this.apiBase}/api/translate`, { title, text });
  }
}
