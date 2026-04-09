import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslationResult, NotaCultural, KaraokeWordTiming } from '../../models/translation.model';
import { TranslationService } from '../../services/translation.service';

// Offset pequeno para o highlight não parecer atrasado.
const KARAOKE_OFFSET = 0.18;
const KARAOKE_SILENCE_HOLD_SECONDS = 0.3;
type KaraokeTimestamp = { start: number; end: number } | null;

@Component({
  selector: 'app-lyrics-display',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './lyrics-display.component.html',
  styleUrl: './lyrics-display.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  /** Linhas cujo karaoke por palavra foi invalidado após edição manual. */
  readonly karaokeInvalidated = signal<Set<number>>(new Set());

  readonly effectiveKaraokeWords = computed(() => {
    const rows = this.result().karaokeWords ?? [];
    const bad = this.karaokeInvalidated();
    return rows.map((row, i) => (bad.has(i) ? null : row ?? null));
  });

  readonly ptKaraokeTimings = computed(() => {
    const pairs = this.pairedLines();
    const ts = this.result().lineTimestamps ?? [];
    const enKw = this.effectiveKaraokeWords();
    return pairs.map((pair, i) =>
      this.buildPtKaraokeTokens(pair.pt, ts[i] ?? null, enKw[i] ?? null),
    );
  });

  // ── Karaoke ────────────────────────────────────────────────────
  @ViewChild('audioEl') audioEl!: ElementRef<HTMLAudioElement>;
  @ViewChild('playerEl') playerEl!: ElementRef<HTMLElement>;

  isPlaying = signal(false);
  currentTime = signal(0);
  audioDuration = signal(0);
  // Mini-player fixo aparece quando o player principal sai da viewport
  miniPlayerVisible = signal(false);

  private observer: IntersectionObserver | null = null;
  private animationFrameId: number | null = null;

  audioUrl = computed(() => {
    const id = this.result().audioId;
    return id ? this.translationService.getAudioUrl(id) : null;
  });

  hasAudio = computed(() => !!this.audioUrl());

  private getFirstTimestamp(timestamps: KaraokeTimestamp[]): Exclude<KaraokeTimestamp, null> | null {
    return timestamps.find((ts): ts is Exclude<KaraokeTimestamp, null> => !!ts) ?? null;
  }

  private getAdjustedKaraokeTime(timestamps: KaraokeTimestamp[]): number {
    const current = this.currentTime();
    const firstTimestamp = this.getFirstTimestamp(timestamps);

    // Nunca antecipa o highlight antes da primeira voz.
    if (!firstTimestamp || current < firstTimestamp.start) return current;

    return Math.max(0, current - KARAOKE_OFFSET);
  }

  private findActiveIndexAtTime(t: number, timestamps: KaraokeTimestamp[]): number {
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (!ts) continue;
      if (t >= ts.start && t < ts.end) return i;
      if (t < ts.start) break;
    }
    return -1;
  }

  private findPreviousLineIndex(t: number, timestamps: KaraokeTimestamp[]): number {
    let previousIdx = -1;
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (!ts) continue;
      if (t >= ts.end) previousIdx = i;
      if (t < ts.start) break;
    }
    return previousIdx;
  }

  private shouldHoldPreviousLine(
    t: number,
    previousIdx: number,
    timestamps: KaraokeTimestamp[],
  ): boolean {
    if (previousIdx < 0) return false;

    const prev = timestamps[previousIdx];
    if (!prev) return false;

    const next = timestamps
      .slice(previousIdx + 1)
      .find((ts): ts is Exclude<KaraokeTimestamp, null> => !!ts);

    const holdUntil = Math.min(
      prev.end + KARAOKE_SILENCE_HOLD_SECONDS,
      next ? next.start : Number.POSITIVE_INFINITY,
    );

    return t < holdUntil;
  }

  private syncCurrentTimeFromAudio(): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    this.currentTime.set(el.currentTime);
  }

  private stopPlaybackTracking(): void {
    if (this.animationFrameId === null) return;
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private startPlaybackTracking(): void {
    this.stopPlaybackTracking();

    const tick = () => {
      const el = this.audioEl?.nativeElement;
      if (!el) {
        this.animationFrameId = null;
        return;
      }

      this.currentTime.set(el.currentTime);

      if (el.paused || el.ended) {
        this.animationFrameId = null;
        return;
      }

      this.animationFrameId = requestAnimationFrame(tick);
    };

    this.animationFrameId = requestAnimationFrame(tick);
  }

  private stopPlayback(syncToAudio = true): void {
    this.stopPlaybackTracking();
    this.isPlaying.set(false);
    if (syncToAudio) this.syncCurrentTimeFromAudio();
  }

  activeLineIndex = computed(() => {
    const timestamps = this.result().lineTimestamps ?? [];
    if (timestamps.length === 0) return -1;

    const firstTimestamp = this.getFirstTimestamp(timestamps);
    if (firstTimestamp && this.currentTime() < firstTimestamp.start) return -1;

    const t = this.getAdjustedKaraokeTime(timestamps);
    const activeIdx = this.findActiveIndexAtTime(t, timestamps);
    if (activeIdx >= 0) return activeIdx;

    const previousIdx = this.findPreviousLineIndex(t, timestamps);
    if (this.shouldHoldPreviousLine(t, previousIdx, timestamps)) return previousIdx;

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
      this.karaokeInvalidated.set(new Set());
      this.stopPlaybackTracking();
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
    this.stopPlaybackTracking();
    const el = this.audioEl?.nativeElement;
    if (el) { el.pause(); el.src = ''; }
  }

  // ── Handlers do <audio> ────────────────────────────────────────

  onTimeUpdate(event: Event): void {
    if (this.isPlaying()) return;
    this.currentTime.set((event.target as HTMLAudioElement).currentTime);
  }

  onDurationChange(event: Event): void {
    const duration = (event.target as HTMLAudioElement).duration;
    this.audioDuration.set(Number.isFinite(duration) ? duration : 0);
  }

  onEnded(): void {
    this.stopPlayback();
  }

  onPlay(): void {
    this.syncCurrentTimeFromAudio();
    this.isPlaying.set(true);
    this.startPlaybackTracking();
  }

  onPause(): void {
    this.stopPlayback();
  }

  togglePlay(): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    if (this.isPlaying()) { el.pause(); } else { el.play(); }
  }

  seekToValue(event: Event): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    el.currentTime = Number.parseFloat((event.target as HTMLInputElement).value);
    this.currentTime.set(el.currentTime);
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
    this.karaokeInvalidated.update(prev => new Set([...prev, index]));
    this.editingIndex.set(null);
  }

  showWordLevelKaraoke(lineIndex: number): boolean {
    return (
      this.hasAudio() &&
      this.activeLineIndex() === lineIndex &&
      (this.effectiveKaraokeWords()[lineIndex]?.length ?? 0) > 0
    );
  }

  isEnWordActive(lineIndex: number, wordIndex: number): boolean {
    if (this.activeLineIndex() !== lineIndex) return false;
    const t = this.getAdjustedKaraokeTime(this.result().lineTimestamps ?? []);
    const words = this.effectiveKaraokeWords()[lineIndex];
    const w = words?.[wordIndex];
    if (!w) return false;
    const last = (words?.length ?? 0) - 1;
    if (wordIndex === last) return t >= w.start && t <= w.end + 0.08;
    return t >= w.start && t < w.end;
  }

  isPtWordActive(lineIndex: number, wordIndex: number): boolean {
    if (this.activeLineIndex() !== lineIndex) return false;
    const t = this.getAdjustedKaraokeTime(this.result().lineTimestamps ?? []);
    const words = this.ptKaraokeTimings()[lineIndex];
    const w = words?.[wordIndex];
    if (!w) return false;
    const last = (words?.length ?? 0) - 1;
    if (wordIndex === last) return t >= w.start && t <= w.end + 0.08;
    return t >= w.start && t < w.end;
  }

  private buildPtKaraokeTokens(
    ptLine: string,
    ts: { start: number; end: number } | null,
    enWords: KaraokeWordTiming[] | null,
  ): KaraokeWordTiming[] {
    const tokens = this.tokenizeKaraokeLine(ptLine);
    if (tokens.length === 0 || !ts || ts.end <= ts.start) return [];
    const t0 = ts.start;
    const t1 = ts.end;
    const dur = Math.max(0.05, t1 - t0);

    if (enWords && enWords.length === tokens.length) {
      return tokens.map((text, i) => ({
        text,
        start: enWords[i].start,
        end: enWords[i].end,
      }));
    }

    const n = tokens.length;
    return tokens.map((text, i) => ({
      text,
      start: t0 + (i / n) * dur,
      end: t0 + ((i + 1) / n) * dur,
    }));
  }

  private tokenizeKaraokeLine(line: string): string[] {
    const base = line
      .trim()
      .replace(/\s*\(\d+x\)\s*$/i, '')
      .trim();
    if (!base) return [];
    return base.split(/\s+/).filter(Boolean);
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
