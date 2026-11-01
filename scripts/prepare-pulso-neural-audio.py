"""Freeze a public evaluation narration and its real word alignment in CPU."""
from pathlib import Path
import hashlib,json,os,sys,wave
from importlib.metadata import PackageNotFoundError,version
from piper import PiperVoice,SynthesisConfig
from pulso_word_alignments import align_words

root=Path(__file__).resolve().parents[1]/'experiments/hyperframes-pulso-pilot'
default_out=root/'variants/phonetic-robo-bonito/assets'
out=Path(os.environ.get('PULSO_NEURAL_AUDIO_OUTPUT_DIR',default_out)).expanduser().resolve()
out.mkdir(parents=True,exist_ok=True)
sentences=[
 ('Olá!','Oi! Eu sou o Pulso.'),
 ('Converse comigo','Agora eu posso conversar com você, responder perguntas e ajudar a usar o site.'),
 ('Compare preços','Quer comparar preços?'),
 ('FranRadar','Abra o FranRadar.'),
 ('Guia interativo','Eu vou destacar o botão certo e mostrar o caminho.'),
 ('Ajuda no dispositivo','Se o servidor atingir o limite, o assistente continua no seu dispositivo.'),
 ('Experimente','Vamos experimentar?')
]
text=' '.join(s[1]for s in sentences)
models_dir=Path(os.environ.get('PULSO_MODELS_DIR',Path.home()/'.cache'/'pulso'/'models')).expanduser()
model=Path(os.environ.get('PULSO_PIPER_MODEL',models_dir/'piper'/'pt_BR-faber-medium.onnx')).expanduser()
if not model.is_file():
 raise SystemExit(f'Modelo Piper não encontrado: {model} (configure PULSO_PIPER_MODEL)')
model_hash=hashlib.sha256(model.read_bytes()).hexdigest()
expected_hash=os.environ.get('PULSO_PIPER_MODEL_SHA256','').strip().lower()
if expected_hash and expected_hash!=model_hash:
 raise SystemExit(f'SHA-256 do modelo Piper diverge: esperado {expected_hash}, encontrado {model_hash}')
voice=PiperVoice.load(model,include_alignments=True)
groups=[];offset=0
audio=out/'narration.wav'
with wave.open(str(audio),'wb')as wav:
 for chunk in voice.synthesize(text,include_alignments=True,syn_config=SynthesisConfig(length_scale=.96)):
  if offset==0:wav.setnchannels(chunk.sample_channels);wav.setsampwidth(chunk.sample_width);wav.setframerate(chunk.sample_rate)
  wav.writeframes(chunk.audio_int16_bytes)
  start=None;cursor=offset
  for alignment in chunk.phoneme_alignments:
   end=cursor+int(alignment.num_samples)/chunk.sample_rate
   if alignment.phoneme in ' ^$.,!?;:':
    if start is not None:groups.append({'start':start,'end':cursor});start=None
   elif start is None:start=cursor
   cursor=end
  if start is not None:groups.append({'start':start,'end':cursor})
  offset+=len(chunk.audio_int16_array)/chunk.sample_rate
words=align_words(text,groups,voice.phonemize)
timings=[];index=0
for sentence_index,(_,sentence) in enumerate(sentences):
 count=len(sentence.split());selected=words[index:index+count];index+=count
 begin=0 if sentence_index==0 else selected[0]['start']
 end=words[index]['start'] if index<len(words)else offset
 timings.append({'audioOffsetMs':round(begin*1000),'sentences':[{'text':sentence,'words':[w['word']for w in selected],'startMs':0,'durationMs':round((end-begin)*1000),'wordTimes':[round((w['start']-begin)*1000)for w in selected]}]})
try:
 piper_version=version('piper-tts')
except PackageNotFoundError:
 piper_version='unknown'
manifest={'text':text,'sentences':sentences,'words':words,'timings':timings,'duration':offset,'voice':'pt_BR-faber-medium','piperVersion':piper_version,'pythonVersion':sys.version.split()[0],'modelPath':str(model.resolve()),'modelSha256':model_hash,'lengthScale':.96,'audioSha256':hashlib.sha256(audio.read_bytes()).hexdigest()}
(out/'voice-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
assert sum(len(t['sentences'][0]['words'])for t in timings)==len(text.split())
print(json.dumps({'duration':offset,'words':len(words),'phonemeGroups':len(groups),'audio':str(audio)}))
