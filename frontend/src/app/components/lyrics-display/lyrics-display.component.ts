import {
  Component, input, signal, computed, inject, effect,
  ViewChild, ElementRef, OnDestroy, AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationResult, NotaCultural } from '../../models/translation.model';
import { TranslationService } from '../../services/translation.service';

// Offset em segundos: o highlight aparece ligeiramente antes do cantor,
// dando tempo para o olho ler a linha antes de ela ser cantada.
const KARAOKE_OFFSET = 0.4;

@Component({
  selector: 'app-lyrics-display',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lyrics-display.component.html',
  styleUrl: './lyrics-display.component.css',
})
export class LyricsDisplayComponent implements AfterViewInit, OnDestroy {
  private readonly translationService = inject(TranslationService);

  result = input.required<TranslationResult>();

  // ── Edição de linhas ───────────────────────────────────────────
  expandedNota = signal<string | null>(null);
  editingIndex = signal<number | null>(null);
  savedIndices = signal<Set<number>>(new Set());
  editEn = signal('');
  editPt = signal('');
  songSaveState = signal<'idle' | 'saving' | 'saved'>('idle');
  correctionError = signal<number | null>(null);

  hasNotas = computed(() => this.result().notas_culturais?.length > 0);

  private readonly sourcePairs = computed(() => {
    const en = (this.result().letra_original ?? '').split('\n');
    const pt = (this.result().letra_traduzida ?? '').split('\n');
    const len = Math.max(en.length, pt.length);
    return Array.from({ length: len }, (_, i) => ({ en: en[i] ?? '', pt: pt[i] ?? '' }));
  });

  private readonly edits = signal<Record<number, { en: string; pt: string }>>({});

  pairedLines = computed(() =>
    this.sourcePairs().map((pair, i) => this.edits()[i] ?? pair)
  );

  // ── Karaoke ────────────────────────────────────────────────────
  @ViewChild('audioEl') audioEl!: ElementRef<HTMLAudioElement>;
  @ViewChild('playerEl') playerEl!: ElementRef<HTMLElement>;

  isPlaying = signal(false);
  currentTime = signal(0);
  audioDuration = signal(0);
  // Mini-player fixo aparece quando o player principal sai da viewport
  miniPlayerVisible = signal(false);

  private observer: IntersectionObserver | null = null;

  audioUrl = computed(() => {
    const id = this.result().audioId;
    return id ? this.translationService.getAudioUrl(id) : null;
  });

  hasAudio = computed(() => !!this.audioUrl());

  activeLineIndex = computed(() => {
    // Subtrai o offset para compensar o adiantamento do highlight
    const t = Math.max(0, this.currentTime() - KARAOKE_OFFSET);
    const timestamps = this.result().lineTimestamps;
    if (!timestamps || timestamps.length === 0) return -1;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (ts && t >= ts.start && t < ts.end) return i;
    }
    return -1;
  });

  formattedTime = computed(() => {
    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    return `${fmt(this.currentTime())} / ${fmt(this.audioDuration())}`;
  });

  progressPercent = computed(() => {
    const dur = this.audioDuration();
    return dur > 0 ? (this.currentTime() / dur) * 100 : 0;
  });

  constructor() {
    // Reseta player ao receber nova música
    effect(() => {
      this.result();
      this.isPlaying.set(false);
      this.currentTime.set(0);
      this.audioDuration.set(0);
      this.edits.set({});
      this.editingIndex.set(null);
      this.savedIndices.set(new Set());
      this.songSaveState.set('idle');
      this.correctionError.set(null);
    });

    // Auto-scroll para a linha ativa
    effect(() => {
      const idx = this.activeLineIndex();
      if (idx < 0) return;
      setTimeout(() => {
        document.getElementById(`lyric-line-${idx}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 50);
    });
  }

  ngAfterViewInit(): void {
    if (!this.playerEl) return;
    // Observa o player principal: mini-player aparece quando ele sai da tela
    this.observer = new IntersectionObserver(
      ([entry]) => this.miniPlayerVisible.set(!entry.isIntersecting),
      { threshold: 0 }
    );
    this.observer.observe(this.playerEl.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    const el = this.audioEl?.nativeElement;
    if (el) { el.pause(); el.src = ''; }
  }

  // ── Handlers do <audio> ────────────────────────────────────────

  onTimeUpdate(event: Event): void {
    this.currentTime.set((event.target as HTMLAudioElement).currentTime);
  }

  onDurationChange(event: Event): void {
    this.audioDuration.set((event.target as HTMLAudioElement).duration);
  }

  onEnded(): void { this.isPlaying.set(false); }
  onPlay(): void  { this.isPlaying.set(true); }
  onPause(): void { this.isPlaying.set(false); }

  togglePlay(): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    if (this.isPlaying()) { el.pause(); } else { el.play(); }
  }

  seekToValue(event: Event): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    el.currentTime = Number.parseFloat((event.target as HTMLInputElement).value);
  }

  // ── Edição ─────────────────────────────────────────────────────

  isEdited(index: number): boolean { return index in this.edits(); }
  isSaved(index: number): boolean  { return this.savedIndices().has(index); }

  startEdit(index: number): void {
    const pair = this.pairedLines()[index];
    this.editingIndex.set(index);
    this.editEn.set(pair.en);
    this.editPt.set(pair.pt);
  }

  cancelEdit(): void { this.editingIndex.set(null); }

  confirmEdit(index: number): void {
    this.edits.update(prev => ({ ...prev, [index]: { en: this.editEn().trim(), pt: this.editPt().trim() } }));
    this.editingIndex.set(null);
  }

  saveCorrection(index: number): void {
    const original = this.sourcePairs()[index];
    const edited = this.edits()[index];
    if (!edited) return;
    this.correctionError.set(null);
    this.translationService.saveCorrection({
      titulo: this.result().titulo,
      linha_en_original: original.en,
      linha_pt_original: original.pt,
      linha_en_corrigida: edited.en,
      linha_pt_corrigida: edited.pt,
    }).subscribe({
      next: () => this.savedIndices.update(prev => new Set([...prev, index])),
      error: () => this.correctionError.set(index),
    });
  }

  saveSong(): void {
    this.songSaveState.set('saving');
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

  isExpanded(termo: string): boolean { return this.expandedNota() === termo; }

  trackByTermo(_index: number, nota: NotaCultural): string { return nota.termo; }
}
