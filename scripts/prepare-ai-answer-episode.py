#!/usr/bin/env python3
"""Build the approved six-chapter episode with measured speech boundaries."""
import array
import hashlib
import json
import math
import re
import subprocess
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/evidencias/ia-como-responde-2026-10-23"
PUBLIC = ROOT / "experiments/remotion-motion-review/public/ia-answer-20261023"
FPS = 24
VOICE = "pt-BR-FranciscaNeural"


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def normalized(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode())


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def main():
    PUBLIC.mkdir(parents=True, exist_ok=True)
    script_path = EVIDENCE / "script-draft.json"
    script = json.loads(script_path.read_text())
    review = json.loads((EVIDENCE / "factual-review-round1.json").read_text())
    assert review["result"]["verdict"] == "aprovado"
    assert len(set(review["result"]["reviewers"])) >= 2
    dump(EVIDENCE / "factual-review-approved.json", {
        **review,
        "scriptSha256": hashlib.sha256(script_path.read_bytes()).hexdigest(),
        "sourceContextSha256": hashlib.sha256((EVIDENCE / "review-source-context.txt").read_bytes()).hexdigest(),
    })
    chapters, captions, wavs = [], [], []
    offset_frames = 0
    for index, source in enumerate(script["chapters"]):
        stem = PUBLIC / f"chapter-{index + 1:02}"
        narration = " ".join(source["sentences"])
        stem.with_suffix(".txt").write_text(narration)
        audio = stem.with_suffix(".mp3")
        timings = stem.with_suffix(".words.json")
        cache = stem.with_suffix(".cache.json")
        signature = hashlib.sha256((narration + VOICE + "-3%/-1Hz").encode()).hexdigest()
        if not (audio.exists() and timings.exists() and cache.exists()
                and json.loads(cache.read_text()).get("signature") == signature):
            run(sys.executable, ROOT / "scripts/synthesize-edge-tts-word-boundaries.py",
                "--text-file", stem.with_suffix(".txt"), "--audio", audio,
                "--timings", timings, "--voice", VOICE, "--rate=-3%", "--pitch=-1Hz", timeout=180)
            dump(cache, {"signature": signature})
        events = json.loads(timings.read_text())["events"]
        expected = normalized(narration)
        actual = "".join(normalized(event["text"]) for event in events)
        assert actual == expected, f"Word boundary content differs in chapter {index + 1}"
        probe = run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", audio,
                    capture_output=True, text=True)
        speech_duration = float(json.loads(probe.stdout)["format"]["duration"])
        duration_frames = math.ceil((speech_duration + (1.25 if index == 5 else .55)) * FPS)
        duration = duration_frames / FPS
        sentence_rows = []
        cursor = 0
        for sentence_index, sentence in enumerate(source["sentences"]):
            target = normalized(sentence)
            selected, collected = [], ""
            while len(collected) < len(target):
                assert cursor < len(events), "Missing narration boundary"
                selected.append(events[cursor]); collected += normalized(events[cursor]["text"]); cursor += 1
            assert collected == target, f"Sentence alignment mismatch: {sentence}"
            sentence_rows.append({"index": sentence_index, "text": sentence,
                                  "startSeconds": selected[0]["startMs"] / 1000,
                                  "endSeconds": selected[-1]["endMs"] / 1000})
            page = []
            for event_index, event in enumerate(selected):
                if page and len(" ".join([e["text"] for e in page] + [event["text"]])) > 62:
                    captions.append({"text": " ".join(e["text"] for e in page),
                                     "startMs": offset_frames / FPS * 1000 + page[0]["startMs"],
                                     "endMs": offset_frames / FPS * 1000 + event["startMs"],
                                     "timestampMs": None, "confidence": None, "chapter": index})
                    page = []
                page.append(event)
                if event_index == len(selected) - 1:
                    next_start = events[cursor]["startMs"] if cursor < len(events) else speech_duration * 1000
                    captions.append({"text": " ".join(e["text"] for e in page),
                                     "startMs": offset_frames / FPS * 1000 + page[0]["startMs"],
                                     "endMs": offset_frames / FPS * 1000 + min(page[-1]["endMs"] + 220, next_start),
                                     "timestampMs": None, "confidence": None, "chapter": index})
        assert cursor == len(events)
        wav = stem.with_suffix(".wav")
        run("ffmpeg", "-v", "error", "-y", "-i", audio, "-af", "apad", "-t", duration,
            "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav)
        wavs.append(wav)
        chapters.append({**source, "sentences": sentence_rows, "index": index,
                         "startFrame": offset_frames, "durationFrames": duration_frames,
                         "startSeconds": offset_frames / FPS, "durationSeconds": duration,
                         "speechDurationSeconds": speech_duration,
                         "audio": f"ia-answer-20261023/{audio.name}"})
        offset_frames += duration_frames
        print(json.dumps({"chapter": index + 1, "seconds": duration, "words": source["wordCount"]}), flush=True)
    concat = PUBLIC / "concat.txt"
    concat.write_text("".join(f"file '{p.name}'\n" for p in wavs))
    voice = PUBLIC / "narration.wav"
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-c:a", "copy", voice)
    pcm = run("ffmpeg", "-v", "error", "-i", voice, "-f", "f32le", "-ac", "1", "-ar", "8000", "pipe:1", capture_output=True).stdout
    samples = array.array("f"); samples.frombytes(pcm)
    rms = [math.sqrt(sum(v * v for v in samples[i:i + 160]) / len(samples[i:i + 160]))
           for i in range(0, len(samples), 160)]
    reference = sorted(rms)[int(len(rms) * .95)]
    levels = [min(1, (max(0, value - .006) / max(.02, reference)) ** .65) for value in rms]
    dump(PUBLIC / "audio-envelope.json", {"stepMs": 20, "levels": levels})
    dump(PUBLIC / "captions.json", captions)
    timeline = {"title": script["title"], "fps": FPS, "durationFrames": offset_frames,
                "durationSeconds": offset_frames / FPS, "chapters": chapters,
                "preparedAt": datetime.now(timezone.utc).isoformat()}
    dump(PUBLIC / "timeline.json", timeline)
    dump(EVIDENCE / "timeline.json", timeline)
    def stamp(ms):
        value = round(ms); hours, value = divmod(value, 3600000); minutes, value = divmod(value, 60000); seconds, milli = divmod(value, 1000)
        return f"{hours:02}:{minutes:02}:{seconds:02},{milli:03}"
    (PUBLIC / "captions.srt").write_text("\n\n".join(f"{i+1}\n{stamp(c['startMs'])} --> {stamp(c['endMs'])}\n{c['text']}" for i, c in enumerate(captions)) + "\n")
    print(json.dumps({"durationSeconds": offset_frames / FPS, "frames": offset_frames,
                      "captions": len(captions), "chapters": len(chapters)}), flush=True)


if __name__ == "__main__":
    main()
