# Runtime de áudio reproduzível

Este guia descreve uma instalação isolada para verificar as dependências sem substituir o ambiente usado pelo scheduler. Os binários e pesos permanecem externos ao repositório; caminhos configuráveis ficam no `.env` local e no `.env.example`.

O código não depende de caminhos absolutos de uma máquina específica. Rhubarb é encontrado pelo `PATH` ou por `PULSO_RHUBARB_PATH`; por padrão, os modelos ficam sob `~/.cache/pulso/models` e podem ser relocados com `PULSO_MODELS_DIR` ou substituídos arquivo a arquivo com `PULSO_PIPER_MODEL`/`PULSO_WHISPER_MODEL_PATH`.

## Node e ferramentas

Em um clone/cópia de trabalho isolada, instale exatamente o `package-lock.json`:

```bash
npm ci
npm run preflight -- --json
```

O preflight é somente leitura e não carrega `.env`. Ele compara as dependências instaladas com o lock e verifica Node, FFmpeg, Rhubarb, Python e modelos. Execute o perfil neural só depois de configurar os caminhos:

```bash
npm run preflight -- --neural
```

No perfil `--neural`, o script também compara as versões instaladas de todas as distribuições em `requirements-neural.lock` com os pins exatos; presença do módulo sem a versão fixada é reportada como erro. O modo padrão continua tratando o perfil neural como opcional.

## Piper, alinhamento e Whisper

O lock opcional de Python foi validado em Python 3.14.4 / Linux x86_64. Crie um ambiente virtual separado e instale as versões fixadas:

```bash
python3.14 -m venv .venv-neural
.venv-neural/bin/python -m pip install -r requirements-neural.lock
```

Configure, sem copiar os pesos para o Git:

```bash
export PYTHON_PATH=/caminho/do/projeto/.venv-neural/bin/python
export PULSO_PIPER_MODEL=/caminho/externo/pt_BR-faber-medium.onnx
export PULSO_PIPER_MODEL_SHA256=SHA256_DO_MODELO_AQUI
export PULSO_WHISPER_MODEL_PATH=/caminho/externo/faster-whisper-base
export PULSO_RHUBARB_PATH=/caminho/externo/rhubarb
```

`requirements-neural.lock` inclui `onnx`, necessário para a geração Piper com alinhamentos fonéticos. PyAV está fixado em 18.1.0 porque Faster-Whisper 1.2.1 chama `av.open(..., metadata_errors=...)`, parâmetro removido no PyAV 19; o upstream registrou e corrigiu essa incompatibilidade depois. Consulte o [issue e correção no repositório oficial Faster-Whisper](https://github.com/SYSTRAN/faster-whisper/issues/1589).

O lock registra versões exatas de pacotes, sem hashes de wheels. O SHA-256 do modelo Piper é validado quando `PULSO_PIPER_MODEL_SHA256` está configurado. Pesos do Whisper são identificados por caminho/revisão local; o preflight verifica os arquivos requeridos, não baixa nem altera modelos.

`preflight-runtime.js` deliberadamente não lê `.env`: assim, um comando de auditoria não importa configurações privadas por acidente. Informe apenas os caminhos de mídia necessários no ambiente do comando:

```bash
PULSO_RHUBARB_PATH=/caminho/rhubarb \
PULSO_MODELS_DIR=/caminho/modelos \
PULSO_PIPER_MODEL=/caminho/modelos/piper/pt_BR-faber-medium.onnx \
PULSO_PIPER_MODEL_SHA256=SHA256_DO_MODELO_AQUI \
npm run preflight -- --neural --json
```

## Validação

Depois de configurar as variáveis no processo/ambiente isolado:

```bash
PULSO_PIPER_MODEL_SHA256=SHA256_DO_MODELO_AQUI npm run preflight -- --neural --json
```

Um smoke local pode sintetizar alguns segundos com Piper e transcrever o WAV com Faster-Whisper em CPU, apontando a saída para `/tmp`. Ele não publica, renderiza vídeo nem inicia serviços. A ferramenta deve validar que a fala existe, os alinhamentos são produzidos e o modelo Whisper consegue decodificar o áudio; a transcrição continua sujeita a erro e requer revisão quando usada em conteúdo final.

Para reproduzir o asset demonstrativo, configure `PYTHON_PATH`, `PULSO_MODELS_DIR` e `PULSO_PIPER_MODEL` no shell antes de executar `python scripts/prepare-pulso-neural-audio.py`; o script não carrega `.env` nem imprime ou importa outras configurações. Por padrão, o WAV e o manifesto vão para a pasta de assets do experimento. Em smoke/QA, defina `PULSO_NEURAL_AUDIO_OUTPUT_DIR` para uma pasta temporária, por exemplo `/tmp/pulso-neural-smoke`, para preservar os assets locais.

## Estado operacional em 17/10/2026

- Rhubarb Lip Sync 1.14.0 (release Linux x86_64 do [repositório oficial](https://github.com/DanielSWolf/rhubarb-lip-sync/releases/tag/v1.14.0)) está instalado fora do checkout em `~/.local/share/pulso/rhubarb-1.14.0/Rhubarb-Lip-Sync-1.14.0-Linux/`; `~/.local/bin/rhubarb` aponta para o executável, e esse diretório já faz parte do `PATH` do scheduler. A release oficial declara licença MIT. SHA-256 local do executável: `d9aefa0627f843cd306333cc761368c4750ceddfa43236f0e607fa074249390c`. O arquivo ZIP temporário foi removido.
- `npm run preflight -- --json` passou com 27 verificações OK, quatro avisos exclusivos do perfil neural opcional e zero erros. Uma auditoria real de áudio existente, entre 24 s e 84 s, produziu 420 cues, 419 transições e sete formas de boca; o SHA-256 da fonte bate com a evidência já registrada.
- O checkout agora tem `.venv-neural/` isolado, ignorado pelo Git, criado com Python 3.14.4 e instalado a partir de `requirements-neural.lock`; `pip check` e imports de Piper/Faster-Whisper/ONNX passaram. O perfil de produção do serviço não foi alterado.
- Os modelos estão no cache externo em `~/.cache/pulso/models`: Piper `rhasspy/piper-voices` v1.0.0 (`pt_BR-faber-medium`, SHA-256 `858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7`; [modelo e modelo-card](https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/pt/pt_BR/faber/medium), modelo-card identifica o dataset como CC0) e Faster-Whisper base `Systran/faster-whisper-base` no commit `ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66` (`model.bin` SHA-256 `d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9`; [snapshot MIT](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66)). A configuração do Piper ficou em link simbólico para os arquivos do cache.
- Com `PYTHON_PATH` apontando explicitamente ao venv e SHA esperado do Piper, `npm run preflight -- --neural --json` passou 73 verificações, zero avisos e zero erros. O smoke `scripts/prepare-pulso-neural-audio.py` produziu `/tmp/pulso-neural-smoke-20261017/narration.wav` de 15,302 s, 49 palavras e 50 grupos fonéticos; Faster-Whisper transcreveu os mesmos 15,302 s em CPU/int8 em sete segmentos. A fala foi reconhecida, com erros em nome próprio e algumas palavras (“Pulso”, “comparar preços”, “FranRadar”); isso valida execução, não precisão textual.
- No Python padrão, o perfil estrito `--neural` teve 41 verificações OK e 32 erros em 17/10 às 14:11: dois módulos neurais ausentes e 30 pins de dependências ausentes/divergentes. O perfil de produção não exige esses módulos e teve 29 OK, dois avisos opcionais e zero erros. O perfil neural isolado continua passando 73/0/0; nenhuma variável do `.env` ou do serviço foi alterada. A ativação coordenada e o rollback continuam pendentes.
- **Rechecagem somente leitura — 17/10/2026, 14:09 BRT:** perfil de produção: 29 verificações OK, dois avisos opcionais (`piper-python` e `faster-whisper-python` no Python global) e zero erros. Com `PYTHON_PATH=/home/servidor/Git/youtube_ai/youtube-automation-agent/.venv-neural/bin/python`, `PULSO_MODELS_DIR=/home/servidor/.cache/pulso/models` e SHA esperado do Piper, perfil neural: 73 OK, zero avisos e zero erros; `pip check`: `No broken requirements found.` O comando consultou versões/arquivos e hash, sem carregar `.env`, instalar ou executar inferência. Isso revalida o ambiente isolado e não autoriza ativar/trocar o runtime persistente; coordenação e rollback continuam pendentes.

## Estado observado em 13/10/2026

- `npm ci` numa cópia temporária passou e o preflight de produção encontrou zero divergências de pacote nessa cópia. O `node_modules` do checkout/runtime ativo ainda tinha oito divergências; não foi substituído nem houve restart.
- Um venv temporário com Piper 1.8.0 + alinhamento, Faster-Whisper 1.2.1, gTTS 2.5.4 e PyAV 18.1.0 passou no preflight neural: 32 verificações OK, zero avisos/erros. O Piper produziu 3,27 s de WAV com 70 alinhamentos; Faster-Whisper transcreveu o arquivo em CPU. Esse smoke valida execução, não precisão textual.
- O venv não foi instalado no diretório persistente de runtime e o lock precisa de revisão de licenças antes de empacotamento/distribuição, em especial o componente Piper. Nenhum serviço foi reiniciado.

## Troca futura do runtime Node e rollback

Este procedimento é uma preparação, não uma autorização para implantação. **Não execute enquanto scheduler, geração, render ou upload estiverem ativos.** A atualização de `node_modules` troca dependências usadas pelo processo e pode quebrar uma operação já iniciada. A janela precisa estar sem escritores e deve preservar a fila e o ledger.

Antes da janela, confirme no checkout real `package.json`, `package-lock.json`, script de CI e uma instalação temporária reproduzível. Registre `node scripts/preflight-runtime.js --json` e rode os testes de dependência em uma cópia. Identifique o mecanismo real do serviço e seu diretório de trabalho sem imprimir variáveis de ambiente; não presuma nome de unidade systemd.

Na janela aprovada e sem processos usando o runtime:

1. Confirme que não há geração/upload em curso e que fila, locks e estado operacional foram preservados.
2. Crie um diretório temporário **no mesmo sistema de arquivos** do checkout, copie para ele somente `package.json` e `package-lock.json` e execute `npm ci` nesse diretório. Isso prepara `node_modules` novo sem tocar no runtime atual.
3. Valide o preflight e os testes locais contra a instalação preparada antes da troca. Se falharem, descarte apenas a pasta temporária e mantenha o runtime existente.
4. Preserve o diretório `node_modules` original com nome de rollback; renomeie o `node_modules` preparado para o caminho esperado pelo checkout. Mantenha o rollback até smoke e operação confirmarem o runtime.
5. Se smoke ou inicialização falhar, faça rollback pela mesma janela sem escritores: mova o diretório novo para quarentena, restaure o diretório original e valide o preflight. Investigue a divergência antes de nova tentativa.
6. A inicialização/ativação do serviço requer um procedimento autorizado e o unit/gerenciador real identificado no host. Nenhuma ordem de restart faz parte deste runbook.

O teste isolado atual não satisfaz esta etapa operacional. Na leitura de 13/10/2026, o processo de geração estava ativo e o preflight encontrou 21 verificações OK, dois avisos (módulos neurais ausentes no Python global) e oito erros de versão instalada: axios, express, form-data, Microsoft Speech SDK, moment, node-cron, sharp e sqlite3. FFmpeg, Rhubarb, Python, Edge TTS e modelos locais foram localizados. Nenhuma instalação, troca de diretório ou restart foi executado.

### Rechecagem de runtime — IMP-20261013-67

O preflight neural foi chamado em modo somente leitura com uma allowlist de caminhos/hash extraída de `.env` em memória; nenhum valor foi registrado no relatório. Resultado: 22 verificações OK e 10 erros. Os oito módulos JavaScript `axios`, `express`, `form-data`, `microsoft-cognitiveservices-speech-sdk`, `moment`, `node-cron`, `sharp` e `sqlite3` continuam diferentes das versões do lockfile. O Python selecionado não oferece `piper` ou `faster_whisper`; os binários e arquivos de modelo foram localizados. Uma instalação `npm ci` em cópia temporária confirma o lock atual, mas não sincroniza o ambiente persistente. A CI completa passou apontando o teste de Google Auth à cópia limpa. O runtime só deve ser alinhado no procedimento acima, em janela sem processos escritores e com rollback.

### Verificação estrita do lock Python — IMP-20261014-49

O preflight neural agora lê o lock e compara cada pin exato com `importlib.metadata`, sem chamar pip ou alterar o ambiente. No Python padrão do shell, a reauditoria encontrou 41 distribuições: 11 coincidentes e 30 ausentes/divergentes; o relatório completo também identificou Rhubarb, Piper/Faster-Whisper e modelos faltantes nesse perfil. Isso é um diagnóstico do Python padrão, não uma afirmação sobre o venv ou runtime configurado, e não fecha a troca/rollback operacional. Os testes usam um processo Python injetado e fixtures temporárias.
