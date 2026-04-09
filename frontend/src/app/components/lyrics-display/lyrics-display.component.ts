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
import { TranslationResult, NotaCultural } from '../../models/translation.model';
import { TranslationService } from '../../services/translation.service';

// Offset pequeno para o highlight não parecer atrasado.
const KARAOKE_OFFSET = 0.18;
type KaraokeTimestamp = { start: number; end: number } | null;
type KaraokeGroup = { lineIndexes: number[]; start: number; end: number };

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
  private lastAutoScrolledGroup = -1;

  audioUrl = computed(() => {
    const id = this.result().audioId;
    return id ? this.translationService.getAudioUrl(id) : null;
  });

  hasAudio = computed(() => !!this.audioUrl());

  private isValidTimestamp(ts: KaraokeTimestamp): ts is Exclude<KaraokeTimestamp, null> {
    return !!ts && Number.isFinite(ts.start) && Number.isFinite(ts.end) && ts.end > ts.start;
  }

  private getAdjustedKaraokeTime(): number {
    const current = this.currentTime();
    return Math.max(0, current - KARAOKE_OFFSET);
  }

  private getStableLineStarts(timestamps: KaraokeTimestamp[]): Array<{ index: number; start: number }> {
    const starts: Array<{ index: number; start: number }> = [];
    let lastStart = -1;

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      if (!this.isValidTimestamp(ts)) continue;
      const start = Math.max(ts.start, lastStart + 0.001);
      starts.push({ index: i, start });
      lastStart = start;
    }

    return starts;
  }

  private getLineDuration(index: number, timestamps: KaraokeTimestamp[]): number {
    const ts = timestamps[index];
    if (!this.isValidTimestamp(ts)) return 0;
    return Math.max(0.05, ts.end - ts.start);
  }

  private getLineTextForGrouping(index: number): string {
    return (this.pairedLines()[index]?.en ?? '').trim();
  }

  private isShortLineForGrouping(index: number): boolean {
    const text = this.getLineTextForGrouping(index);
    return text.length > 0 && text.length <= 16;
  }

  private shouldMergeIntoCurrentGroup(
    currentLastLineIndex: number,
    nextLineIndex: number,
    timestamps: KaraokeTimestamp[],
    currentGroupSize: number,
  ): boolean {
    if (currentGroupSize >= 3) return false;

    const prevTs = timestamps[currentLastLineIndex];
    const nextTs = timestamps[nextLineIndex];
    if (!this.isValidTimestamp(prevTs) || !this.isValidTimestamp(nextTs)) return false;

    const gap = nextTs.start - prevTs.end;
    const prevDuration = this.getLineDuration(currentLastLineIndex, timestamps);
    const nextDuration = this.getLineDuration(nextLineIndex, timestamps);
    const prevShort = this.isShortLineForGrouping(currentLastLineIndex);
    const nextShort = this.isShortLineForGrouping(nextLineIndex);

    if (gap > 1.25) return false;

    return (
      gap <= 0.48 ||
      prevDuration <= 1.15 ||
      nextDuration <= 1 ||
      prevShort ||
      nextShort
    );
  }

  private buildKaraokeGroups(timestamps: KaraokeTimestamp[]): KaraokeGroup[] {
    const starts = this.getStableLineStarts(timestamps);
    if (starts.length === 0) return [];

    const groups: KaraokeGroup[] = [];
    let currentLineIndexes: number[] = [starts[0].index];

    for (let i = 1; i < starts.length; i++) {
      const nextLineIndex = starts[i].index;
      const currentLastLineIndex = currentLineIndexes.at(-1) ?? starts[i - 1].index;
      const shouldMerge = this.shouldMergeIntoCurrentGroup(
        currentLastLineIndex,
        nextLineIndex,
        timestamps,
        currentLineIndexes.length,
      );

      if (shouldMerge) {
        currentLineIndexes.push(nextLineIndex);
        continue;
      }

      const firstTs = timestamps[currentLineIndexes[0]];
      const lastTs = timestamps[currentLineIndexes.at(-1) ?? currentLineIndexes[0]];
      groups.push({
        lineIndexes: [...currentLineIndexes],
        start: this.isValidTimestamp(firstTs) ? firstTs.start : starts[i - 1].start,
        end: this.isValidTimestamp(lastTs) ? lastTs.end : starts[i - 1].start + 0.7,
      });
      currentLineIndexes = [nextLineIndex];
    }

    const firstTs = timestamps[currentLineIndexes[0]];
    const lastTs = timestamps[currentLineIndexes.at(-1) ?? currentLineIndexes[0]];
    groups.push({
      lineIndexes: [...currentLineIndexes],
      start: this.isValidTimestamp(firstTs) ? firstTs.start : starts.at(-1)?.start ?? 0,
      end: this.isValidTimestamp(lastTs) ? lastTs.end : (starts.at(-1)?.start ?? 0) + 0.7,
    });

    return groups;
  }

  private findActiveGroupIndex(t: number, groups: KaraokeGroup[]): number {
    if (groups.length === 0) return -1;
    if (t < groups[0].start) return -1;

    let active = 0;
    for (let i = 1; i < groups.length; i++) {
      if (t >= groups[i].start) {
        active = i;
        continue;
      }
      break;
    }
    return active;
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

  karaokeGroups = computed(() => {
    const timestamps = this.result().lineTimestamps ?? [];
    return this.buildKaraokeGroups(timestamps);
  });

  activeGroupIndex = computed(() => {
    const groups = this.karaokeGroups();
    if (groups.length === 0) return -1;
    const t = this.getAdjustedKaraokeTime();
    return this.findActiveGroupIndex(t, groups);
  });

  currentGroupLineSet = computed(() => {
    const groupIdx = this.activeGroupIndex();
    const groups = this.karaokeGroups();
    if (groupIdx < 0 || groupIdx >= groups.length) return new Set<number>();
    return new Set(groups[groupIdx].lineIndexes);
  });

  // Janela visual: grupo atual + 1 anterior + 2 próximos.
  karaokeWindowLineSet = computed(() => {
    const groups = this.karaokeGroups();
    const groupIdx = this.activeGroupIndex();
    if (groupIdx < 0 || groupIdx >= groups.length) return new Set<number>();

    const from = Math.max(0, groupIdx - 1);
    const to = Math.min(groups.length - 1, groupIdx + 2);
    const indexes = new Set<number>();
    for (let i = from; i <= to; i++) {
      for (const lineIndex of groups[i].lineIndexes) indexes.add(lineIndex);
    }
    return indexes;
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
      this.stopPlaybackTracking();
      this.lastAutoScrolledGroup = -1;
    });

    // Auto-scroll para o grupo ativo (evita jitter em linhas muito rápidas).
    effect(() => {
      const groupIdx = this.activeGroupIndex();
      if (groupIdx < 0) return;
      if (groupIdx === this.lastAutoScrolledGroup) return;
      this.lastAutoScrolledGroup = groupIdx;

      const groups = this.karaokeGroups();
      const anchorLine = groups[groupIdx]?.lineIndexes[0];
      if (anchorLine === undefined) return;
      setTimeout(() => {
        document.getElementById(`lyric-line-${anchorLine}`)?.scrollIntoView({
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

  seekBySeconds(deltaSeconds: number): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    const duration = Number.isFinite(el.duration) ? el.duration : this.audioDuration();
    const targetTime = Math.max(0, Math.min(el.currentTime + deltaSeconds, duration || 0));
    el.currentTime = targetTime;
    this.currentTime.set(targetTime);
  }

  seekToValue(event: Event): void {
    const el = this.audioEl?.nativeElement;
    if (!el) return;
    const target = Number.parseFloat((event.target as HTMLInputElement).value);
    if (!Number.isFinite(target)) return;
    const duration = Number.isFinite(el.duration) ? el.duration : this.audioDuration();
    const clamped = Math.max(0, Math.min(target, duration || 0));
    el.currentTime = clamped;
    this.currentTime.set(clamped);
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

  hasLineTimestamp(index: number): boolean {
    return !!(this.result().lineTimestamps ?? [])[index];
  }

  isLineInCurrentGroup(index: number): boolean {
    return this.currentGroupLineSet().has(index);
  }

  isLineInKaraokeWindow(index: number): boolean {
    return this.karaokeWindowLineSet().has(index);
  }

  seekToLine(index: number): void {
    const el = this.audioEl?.nativeElement;
    const ts = (this.result().lineTimestamps ?? [])[index];
    if (!el || !ts) return;
    el.currentTime = ts.start;
    this.currentTime.set(ts.start);
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
