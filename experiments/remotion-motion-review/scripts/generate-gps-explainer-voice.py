from pathlib import Path
import json
import os
import re
import subprocess
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "gps-explainer"
OUT.mkdir(parents=True, exist_ok=True)

VOICE = os.environ.get("PULSO_REVIEW_TTS_VOICE", "pt-BR-FranciscaNeural")
RATE = os.environ.get("PULSO_REVIEW_TTS_RATE", "-3%")
PITCH = os.environ.get("PULSO_REVIEW_TTS_PITCH", "-1Hz")
AUDIO_FILE = "narration.mp3"

LINES = [
    ("question", "Seu celular não recebe uma coordenada pronta."),
    ("satellites", "Cada satélite transmite o horário do sinal e sua posição."),
    ("travel_time", "O telefone estima quanto a onda levou para chegar."),
    ("distance", "Como o rádio viaja quase à velocidade da luz, esse atraso vira distância."),
    ("one_range", "Uma distância deixa vários lugares possíveis: uma esfera ao redor do satélite."),
    ("intersection", "As medições de outros satélites cruzam essas esferas."),
    ("fourth_signal", "Por que são pelo menos quatro? O relógio do celular não é atômico: a quarta medida corrige esse erro e ajuda a calcular a posição."),
    ("resolution", "Assim, sinais invisíveis viram um ponto no mapa."),
]


def parse_timestamp(value: str) -> float:
    hours, minutes, rest = value.split(":")
    seconds, milliseconds = rest.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(milliseconds) / 1000


def words(value: str) -> list[str]:
    normalized = unicodedata.normalize("NFD", value.lower())
    unaccented = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.findall(r"[a-z0-9]+", unaccented)


def parse_srt(path: Path) -> list[dict]:
    cues = []
    for block in re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip()):
        lines = block.splitlines()
        timing_index = next((i for i, line in enumerate(lines) if " --> " in line), None)
        if timing_index is None:
            continue
        start, end = lines[timing_index].split(" --> ")
        text = " ".join(lines[timing_index + 1 :]).strip()
        cues.append({"start": parse_timestamp(start), "end": parse_timestamp(end), "text": text})
    if not cues:
        raise RuntimeError("Edge TTS não retornou legendas com tempos para validar a narração")
    return cues


def run_edge_tts(audio_path: Path, subtitles_path: Path) -> None:
    text = " ".join(text for _, text in LINES)
    command = [
        sys.executable,
        "-m",
        "edge_tts",
        "--voice",
        VOICE,
        f"--rate={RATE}",
        f"--pitch={PITCH}",
        "--text",
        text,
        "--write-media",
        str(audio_path),
        "--write-subtitles",
        str(subtitles_path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Edge TTS excedeu 120 s; não houve fallback para voz robótica") from error
    if result.returncode != 0:
        status = re.search(r"\b(429|403|401|5\d\d)\b", result.stderr)
        suffix = f" HTTP {status.group(1)}" if status else ""
        raise RuntimeError(f"Edge TTS falhou{suffix}; sem fallback de voz")


audio_path = OUT / AUDIO_FILE
subtitles_path = OUT / "narration.srt"
run_edge_tts(audio_path, subtitles_path)
(OUT / "narration.txt").write_text(" ".join(text for _, text in LINES) + "\n", encoding="utf-8")
cues = parse_srt(subtitles_path)

segments = []
cue_index = 0
for segment_id, text in LINES:
    expected = words(text)
    collected = []
    selected = []
    while cue_index < len(cues) and len(collected) < len(expected):
        cue = cues[cue_index]
        selected.append(cue)
        collected.extend(words(cue["text"]))
        cue_index += 1
    if collected != expected:
        raise RuntimeError(f"Legenda Edge TTS não corresponde ao beat {segment_id}; composição cancelada")
    segments.append({
        "id": segment_id,
        "text": text,
        "startSeconds": round(selected[0]["start"], 3),
        "durationSeconds": round(selected[-1]["end"] - selected[0]["start"], 3),
    })
if cue_index != len(cues):
    raise RuntimeError("Edge TTS retornou texto extra fora do roteiro; composição cancelada")

audio_duration = float(subprocess.check_output([
    "ffprobe", "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", str(audio_path),
], text=True).strip())
metadata = {
    "provider": "Microsoft Edge Neural TTS",
    "voice": VOICE,
    "rate": RATE,
    "pitch": PITCH,
    "language": "pt-BR",
    "audioFile": AUDIO_FILE,
    "audioDurationSeconds": round(audio_duration, 3),
    "segments": segments,
}
(OUT / "timeline.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(metadata, ensure_ascii=False, indent=2))
