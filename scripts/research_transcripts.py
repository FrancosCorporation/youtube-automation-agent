#!/usr/bin/env python3
"""
Transcript extraction tools for Pulso videos.
Extracts JSON3 subtitles and metadata from YouTube videos.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def default_subtitle_dir() -> Path:
    """Resolve checked-in research evidence relative to this workspace."""
    return Path(__file__).resolve().parents[1] / "docs" / "pesquisa-virais" / "evidencias"


def extract_spans(data: dict) -> list[dict]:
    """
    Extract subtitle spans from JSON3 data.

    Args:
        data: Parsed JSON3 data with 'events' key

    Returns:
        List of spans with start, end, text, inferred_end, approx_segment_words
    """
    events = data.get("events", [])
    spans = []

    for i, event in enumerate(events):
        if "segs" not in event:
            continue

        segs = event["segs"]
        if not segs:
            continue

        text_parts = []
        for seg in segs:
            utf8 = seg.get("utf8", "")
            if utf8:
                text_parts.append(utf8)

        if not text_parts:
            continue

        text = "".join(text_parts)
        text = text.replace("\n", " ")
        text = re.sub(r"\s+", " ", text).strip()

        if not text:
            continue

        start_ms = event.get("tStartMs", 0)
        start = start_ms / 1000.0

        duration_ms = event.get("dDurationMs")
        inferred_end = False

        if duration_ms is not None:
            end = (start_ms + duration_ms) / 1000.0
        else:
            if i + 1 < len(events):
                next_start = events[i + 1].get("tStartMs", start_ms)
                end = next_start / 1000.0
                inferred_end = True
            else:
                end = start
                inferred_end = True

        words = re.findall(r"\b\w+\b", text, re.UNICODE)
        approx_segment_words = len(words)

        spans.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "text": text,
            "inferred_end": inferred_end,
            "approx_segment_words": approx_segment_words
        })

    spans.sort(key=lambda s: s["start"])

    deduped = []
    seen = set()
    for span in spans:
        key = (span["start"], span["end"], span["text"])
        if key not in seen:
            seen.add(key)
            deduped.append(span)

    return deduped


def load_metadata(info_path: Path) -> dict:
    """Load video metadata from .info.json file."""
    with open(info_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_subtitles(subtitle_path: Path) -> dict:
    """Load JSON3 subtitles from file."""
    with open(subtitle_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_index(video_ids: list[str], base_dir: Path, sub_dir: Path | None = None) -> dict:
    """
    Build transcript index for given video IDs.

    Args:
        video_ids: List of YouTube video IDs
        base_dir: Base directory containing observations/ folder
        sub_dir: Optional directory containing subtitle files. Defaults to the production path.

    Returns:
        Index dictionary with metadata and spans for each video
    """
    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "videos": []
    }

    obs_dir = base_dir / "observations"
    if sub_dir is None:
        sub_dir = default_subtitle_dir()

    for vid in video_ids:
        info_path = obs_dir / f"{vid}.info.json"
        sub_path = sub_dir / f"{vid}.en-orig.json3"

        if not info_path.exists():
            print(f"Warning: Metadata not found for {vid}", file=sys.stderr)
            continue
        if not sub_path.exists():
            print(f"Warning: Subtitles not found for {vid}", file=sys.stderr)
            continue

        meta = load_metadata(info_path)
        sub_data = load_subtitles(sub_path)
        spans = extract_spans(sub_data)

        duration = meta.get("duration", 0)
        for span in spans:
            if span["end"] > duration + 1:
                span["source_end"] = span["end"]
                span["end"] = round(duration + 1, 3)
                span["duration_clamped"] = True

        video_entry = {
            "id": meta.get("id"),
            "title": meta.get("title"),
            "channel": meta.get("channel") or meta.get("uploader"),
            "view_count": meta.get("view_count"),
            "duration": meta.get("duration"),
            "upload_date": meta.get("upload_date"),
            "url": meta.get("webpage_url"),
            "spans": spans
        }
        index["videos"].append(video_entry)

    return index
