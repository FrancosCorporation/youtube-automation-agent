#!/usr/bin/env python3
"""Synthesize Edge TTS audio and retain Microsoft's per-word boundary events."""

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import edge_tts


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text-file", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--timings", required=True)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--rate", required=True)
    parser.add_argument("--pitch", required=True)
    parser.add_argument("--max-chunk-bytes", type=int, default=1800)
    return parser.parse_args()


def chunk_text(text, max_bytes=1800):
    """Bound requests without dropping words or splitting UTF-8 characters."""
    if max_bytes < 100:
        raise ValueError("Limite de texto TTS inválido")
    chunks = []
    current = ""
    for sentence in re.split(r"(?<=[.!?…])\s+", text.strip()):
        if not sentence:
            continue
        candidate = f"{current} {sentence}".strip()
        if len(candidate.encode("utf-8")) <= max_bytes:
            current = candidate
            continue
        if current:
            chunks.append(current)
            current = ""
        for word in sentence.split():
            if len(word.encode("utf-8")) > max_bytes:
                raise ValueError("Palavra excede o limite de texto TTS")
            candidate = f"{current} {word}".strip()
            if len(candidate.encode("utf-8")) > max_bytes:
                chunks.append(current)
                current = word
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", *map(str, args)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


async def synthesize(args):
    text = Path(args.text_file).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Texto vazio para síntese Edge TTS")

    chunks = chunk_text(text, args.max_chunk_bytes)
    events = []
    audio_path = Path(args.audio)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_cursor_ms = 0
    with tempfile.TemporaryDirectory(prefix="pulso-edge-chunks-") as temporary:
        directory = Path(temporary)
        combined = directory / "combined.pcm"
        for index, part in enumerate(chunks):
            part_mp3 = directory / f"part-{index}.mp3"
            part_pcm = directory / f"part-{index}.pcm"
            communicate = edge_tts.Communicate(part, args.voice, rate=args.rate,
                                             pitch=args.pitch, boundary="WordBoundary")
            part_events = []
            with part_mp3.open("wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        start_ms = chunk["offset"] / 10_000
                        duration_ms = chunk["duration"] / 10_000
                        event_text = str(chunk.get("text", "")).strip()
                        if event_text:
                            part_events.append({"text": event_text,
                                                "startMs": round(audio_cursor_ms + start_ms, 3),
                                                "endMs": round(audio_cursor_ms + start_ms + duration_ms, 3)})
            if not part_events:
                raise RuntimeError("Edge TTS não retornou eventos de limite por palavra")
            events.extend(part_events)
            if len(chunks) == 1:
                shutil.copyfile(part_mp3, audio_path)
            else:
                # Exact decoded sample counts keep chunk offsets aligned with
                # the concatenated narration; no estimated word timings.
                ffmpeg("-i", part_mp3, "-ar", "24000", "-ac", "1", "-f", "s16le", part_pcm)
                audio_cursor_ms += part_pcm.stat().st_size / (24000 * 2) * 1000
                with combined.open("ab") as destination, part_pcm.open("rb") as source:
                    shutil.copyfileobj(source, destination)
        if len(chunks) > 1:
            ffmpeg("-f", "s16le", "-ar", "24000", "-ac", "1", "-i", combined,
                   "-codec:a", "libmp3lame", "-b:a", "128k", "-threads", "1", audio_path)

    if not events:
        raise RuntimeError("Edge TTS não retornou eventos de limite por palavra")
    Path(args.timings).write_text(json.dumps({
        "version": 1,
        "alignment": "edge-tts-word-boundary-events",
        "voice": args.voice,
        "chunks": len(chunks),
        "events": events,
    }, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(synthesize(parse_args()))
