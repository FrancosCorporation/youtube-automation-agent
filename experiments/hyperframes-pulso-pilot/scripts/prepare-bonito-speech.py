#!/usr/bin/env python3
"""Freeze a pt-BR preview narration and phrase timing from actual audio files."""
import json
from pathlib import Path
import subprocess
from gtts import gTTS

root = Path(__file__).resolve().parents[1]
variant = root / 'variants/robo-bonito-animado'
assets = variant / 'assets'
assets.mkdir(parents=True, exist_ok=True)
phrases = [
    'Oi! Eu sou o Pulso.',
    'Agora, eu posso olhar para você, piscar e sorrir.',
    'Enquanto falo, minha boca acompanha a voz.',
    'E meus braços ajudam a explicar cada ideia.',
    'Esse é o primeiro teste do meu novo corpo em movimento.',
    'O que você achou?'
]
cursor, cues, inputs = 0.8, [], []
for i, text in enumerate(phrases):
    target = assets / f'fala-{i:02d}.mp3'
    if not target.exists() or target.stat().st_size < 1000:
        gTTS(text, lang='pt', tld='com.br', timeout=20).save(str(target))
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration', '-of', 'default=nw=1:nk=1', str(target)], text=True))
    cues.append({'start': round(cursor, 4), 'end': round(cursor + duration, 4), 'text': text})
    inputs.extend(['-i', str(target)])
    cursor += duration + 0.4
filters = []
for i, cue in enumerate(cues):
    delay = round(cue['start'] * 1000)
    filters.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=mono,adelay={delay}:all=1[a{i}]')
duration = round(cursor + 0.8, 3)
filters.append(''.join(f'[a{i}]' for i in range(len(cues))) +
    f'amix=inputs={len(cues)}:normalize=0,apad,atrim=duration={duration},alimiter=limit=0.95[mix]')
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs,
    '-filter_complex', ';'.join(filters), '-map', '[mix]', '-ar', '48000',
    '-c:a', 'pcm_s16le', str(assets / 'narracao.wav')], check=True)
metadata = {'provider': 'gTTS', 'lang': 'pt', 'tld': 'com.br', 'duration': duration,
    'cues': cues, 'timing': 'Phrase durations measured by ffprobe; silence inserted explicitly.',
    'fallbackReason': 'Installed Edge-TTS 7.2.8 returned HTTP 403; no paid API used.'}
(assets / 'speech.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'duration': duration, 'phrases': len(cues), 'provider': 'gTTS'}))
