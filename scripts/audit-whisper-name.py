#!/usr/bin/env python3
"""Compare local Whisper base recognition with and without a proper-name hint.

The CLI intentionally emits aggregate metrics only; it never prints or writes
the recognized transcript. It requires an already-downloaded local model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Sequence


DEFAULT_MODELS_DIR = Path.home() / '.cache' / 'pulso' / 'models'
REQUIRED_MODEL_FILES = ('model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt')


def normalize_tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize('NFKD', text.casefold())
    normalized = ''.join(char for char in normalized if not unicodedata.combining(char))
    return re.findall(r'[a-z0-9]+', normalized)


def has_phrase(tokens: Sequence[str], phrase: str) -> bool:
    expected = normalize_tokens(phrase)
    if not expected or len(expected) > len(tokens):
        return False
    return any(list(tokens[index:index + len(expected)]) == expected
               for index in range(len(tokens) - len(expected) + 1))


def edit_counts(reference: Sequence[str], hypothesis: Sequence[str]) -> dict[str, int]:
    rows, columns = len(reference), len(hypothesis)
    costs = [[0] * (columns + 1) for _ in range(rows + 1)]
    operations: list[list[str | None]] = [[None] * (columns + 1) for _ in range(rows + 1)]

    for row in range(1, rows + 1):
        costs[row][0] = row
        operations[row][0] = 'deletion'
    for column in range(1, columns + 1):
        costs[0][column] = column
        operations[0][column] = 'insertion'

    for row in range(1, rows + 1):
        for column in range(1, columns + 1):
            same = reference[row - 1] == hypothesis[column - 1]
            choices = (
                (costs[row - 1][column - 1] + (0 if same else 1), 'match' if same else 'substitution'),
                (costs[row - 1][column] + 1, 'deletion'),
                (costs[row][column - 1] + 1, 'insertion'),
            )
            costs[row][column], operations[row][column] = min(choices, key=lambda item: item[0])

    counts = {'substitutions': 0, 'deletions': 0, 'insertions': 0}
    row, column = rows, columns
    while row or column:
        operation = operations[row][column]
        if operation == 'match':
            row -= 1
            column -= 1
        elif operation == 'substitution':
            counts['substitutions'] += 1
            row -= 1
            column -= 1
        elif operation == 'deletion':
            counts['deletions'] += 1
            row -= 1
        elif operation == 'insertion':
            counts['insertions'] += 1
            column -= 1
        else:
            raise ValueError('alinhamento de palavras inválido')
    return counts


def resolve_model_path(env: dict[str, str] | os._Environ[str] = os.environ) -> Path | None:
    explicit = env.get('PULSO_WHISPER_MODEL_PATH')
    if explicit:
        return Path(explicit).expanduser().resolve()

    models_dir = Path(env.get('PULSO_MODELS_DIR', str(DEFAULT_MODELS_DIR))).expanduser()
    snapshots = models_dir / 'models--Systran--faster-whisper-base' / 'snapshots'
    try:
        children = sorted(path for path in snapshots.iterdir() if path.is_dir())
    except OSError:
        return None
    return children[0] if children else None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def transcribe_metrics(model, audio_path: Path, reference: Sequence[str], term: str,
                       prompt: str | None, common_misread: str | None) -> dict:
    segments, info = model.transcribe(
        str(audio_path),
        language='pt',
        word_timestamps=True,
        beam_size=3,
        vad_filter=False,
        condition_on_previous_text=False,
        initial_prompt=prompt,
    )
    hypothesis: list[str] = []
    timestamped_words = 0
    recognized_words = 0
    for segment in segments:
        for word in segment.words or []:
            recognized_words += 1
            hypothesis.extend(normalize_tokens(word.word))
            if word.start is not None and word.end is not None and word.end > word.start:
                timestamped_words += 1

    counts = edit_counts(reference, hypothesis)
    errors = sum(counts.values())
    return {
        'language': info.language,
        'referenceWords': len(reference),
        'recognizedWords': len(hypothesis),
        'timestampedWords': timestamped_words,
        'wordObjects': recognized_words,
        'wer': round(errors / max(len(reference), 1), 4),
        **counts,
        'exactName': has_phrase(hypothesis, term),
        'commonMisreadObserved': has_phrase(hypothesis, common_misread) if common_misread else False,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('audio', type=Path, help='arquivo de áudio local')
    parser.add_argument('reference_json', type=Path, help='JSON local com o roteiro de referência')
    parser.add_argument('--reference-field', default='text', help='campo textual no JSON (padrão: text)')
    parser.add_argument('--term', required=True, help='nome próprio esperado, por exemplo FranRadar')
    parser.add_argument('--common-misread', help='forma incorreta conhecida para rastrear, se houver')
    parser.add_argument('--prompt', required=True, help='dica contextual em português para o nome próprio')
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.audio.is_file() or not args.reference_json.is_file():
        print('áudio ou JSON de referência não existe', file=sys.stderr)
        return 2

    try:
        reference_data = json.loads(args.reference_json.read_text(encoding='utf-8'))
        reference_text = reference_data.get(args.reference_field) if isinstance(reference_data, dict) else None
        if not isinstance(reference_text, str) or not reference_text.strip():
            raise ValueError('campo textual da referência ausente ou vazio')
        reference = normalize_tokens(reference_text)
        if not reference or not has_phrase(reference, args.term):
            raise ValueError('o nome próprio não aparece no texto de referência')
        model_path = resolve_model_path()
        if model_path is None or not model_path.is_dir() or not all((model_path / name).is_file() for name in REQUIRED_MODEL_FILES):
            raise ValueError('modelo Whisper base local incompleto; configure PULSO_WHISPER_MODEL_PATH')

        # Offline mode and local_files_only prevent an implicit model download.
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['HF_DATASETS_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
        from faster_whisper import WhisperModel

        model = WhisperModel(str(model_path), device='cpu', compute_type='int8', cpu_threads=1,
                             num_workers=1, local_files_only=True)
        baseline = transcribe_metrics(model, args.audio, reference, args.term, None, args.common_misread)
        prompted = transcribe_metrics(model, args.audio, reference, args.term, args.prompt, args.common_misread)
        print(json.dumps({
            'sourceSha256': sha256_file(args.audio),
            'referenceWords': len(reference),
            'termPresentInReference': True,
            'device': 'cpu-int8',
            'threads': 1,
            'transcriptEmitted': False,
            'baseline': baseline,
            'prompted': prompted,
        }, ensure_ascii=False))
        return 0
    except Exception as error:  # Keep the source text/transcript out of CLI errors.
        print(f'auditoria Whisper não concluída: {type(error).__name__}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
