import argparse
import json
import sys
from typing import Any


def print_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def probe() -> int:
    try:
        import whisperx  # noqa: F401
        print_json({"available": True})
    except Exception as exc:  # pragma: no cover - probe only
        print_json({"available": False, "error": str(exc)})
    return 0


def align_segments(whisperx, model_a, metadata, audio, device, segments):
    if not segments:
        return {"segments": []}
    return whisperx.align(
        segments,
        model_a,
        metadata,
        audio,
        device,
        return_char_alignments=False,
    )


def segment_to_word_entries(segment: dict[str, Any]) -> list[dict[str, float | str]]:
    raw = segment.get("words")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, float | str]] = []
    for w in raw:
        if not isinstance(w, dict):
            continue
        text = str(w.get("word", "")).strip()
        start = w.get("start")
        end = w.get("end")
        if not text or start is None or end is None:
            continue
        try:
            fs = float(start)
            fe = float(end)
        except (TypeError, ValueError):
            continue
        if fe <= fs:
            continue
        out.append({"text": text, "start": fs, "end": fe})
    return out


def force_align(payload: dict[str, Any]) -> int:
    import whisperx

    audio_path = payload["audioPath"]
    language = payload.get("language", "en")
    device = payload.get("device", "cpu")
    line_entries = payload.get("lines", [])

    audio = whisperx.load_audio(audio_path)
    model_a, metadata = whisperx.load_align_model(language_code=language, device=device)

    segments = [
        {
            "text": entry["text"],
            "start": float(entry["start"]),
            "end": float(entry["end"]),
            "index": int(entry["index"]),
            "original_start": float(entry["originalStart"]),
            "original_end": float(entry["originalEnd"]),
        }
        for entry in line_entries
        if entry.get("text")
    ]

    try:
        aligned = align_segments(whisperx, model_a, metadata, audio, device, segments)
    except Exception:
        recovered_segments = []
        for segment in segments:
            try:
                result = align_segments(whisperx, model_a, metadata, audio, device, [segment])
                recovered_segments.extend(result.get("segments", []))
            except Exception:
                recovered_segments.append(segment)
        aligned = {"segments": recovered_segments}

    fallback_by_pos: list[dict[str, float | int]] = [
        {
            "index": int(segment["index"]),
            "start": float(segment["original_start"]),
            "end": float(segment["original_end"]),
        }
        for segment in segments
    ]

    out_lines = []
    out_line_words: list[dict[str, Any]] = []
    for pos, segment in enumerate(aligned.get("segments", [])):
        fallback = fallback_by_pos[pos] if pos < len(fallback_by_pos) else None

        start = segment.get("start", segment.get("original_start"))
        end = segment.get("end", segment.get("original_end"))
        if start is None or end is None or end <= start:
            start = segment.get("original_start")
            end = segment.get("original_end")

        if (start is None or end is None or end <= start) and fallback is not None:
            start = fallback["start"]
            end = fallback["end"]

        raw_idx = segment.get("index")
        if raw_idx is None and fallback is not None:
            raw_idx = fallback["index"]
        if raw_idx is None or start is None or end is None or end <= start:
            continue
        idx = int(raw_idx)

        out_lines.append({
            "index": idx,
            "start": float(start),
            "end": float(end),
        })
        word_entries = segment_to_word_entries(segment)
        if word_entries:
            out_line_words.append({"index": idx, "words": word_entries})

    print_json({"lines": out_lines, "lineWords": out_line_words})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", action="store_true")
    args = parser.parse_args()

    if args.probe:
        return probe()

    payload = json.load(sys.stdin)
    return force_align(payload)


if __name__ == "__main__":
    raise SystemExit(main())
