import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TranslationResult } from '../models/translation.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = environment.apiUrl;

  translate(url: string): Observable<TranslationResult> {
    return this.http.post<TranslationResult>(`${this.apiBase}/api/translate`, { url });
  }

  translateFile(file: File): Observable<TranslationResult> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<TranslationResult>(`${this.apiBase}/api/upload`, formData);
  }

  saveSong(result: TranslationResult): Observable<{ ok: boolean; id: string }> {
    return this.http.post<{ ok: boolean; id: string }>(`${this.apiBase}/api/songs`, result);
  }

  getAudioUrl(audioId: string): string {
    return `${this.apiBase}/api/audio/${audioId}`;
  }

  saveCorrection(payload: {
    titulo?: string;
    linha_en_original: string;
    linha_pt_original: string;
    linha_en_corrigida: string;
    linha_pt_corrigida: string;
  }): Observable<{ ok: boolean; id: string }> {
    return this.http.post<{ ok: boolean; id: string }>(`${this.apiBase}/api/corrections`, payload);
  }
}
