# Pulso / YouTube AI

Produção e distribuição automatizadas de vídeos explicativos. O método aprovado é **Three.js r187 + Remotion**, com humanos GLB locais detalhados, o robô apresentador aprovado e ações específicas de cada narrativa.

O vídeo principal do YouTube é horizontal 16:9, com pelo menos seis minutos de narração real. O projeto produz também composição vertical 9:16 e cortes próprios. Capas fotorealistas separadas são criadas pelo Gemini no emulador Android, com Nano Banana Pro solicitado no prompt; solicitação não confirma o modelo efetivo.

## Retomar o trabalho

- [Decisões vigentes](docs/decisoes-vigentes.md): última aprovação, duração, modelos, capas, autonomia e autorizações.
- [Plano único](plan.md): cursor e 63 objetivos YAI.
- [Workflow autônomo](docs/workflow-autonomo.md): componentes, diagnóstico, estado e recuperação.
- [Direção criativa](docs/padrao-criativo-aprovado.md) e [piloto aprovado](benchmarks/video_3d/reforestation_demo/README.md).
- [Resumo de entregas](resumo.md) e [índice documental](docs/README.md).

## Serviço existente

O único produtor/publicador Pulso é a unidade de usuário `ai-video-scheduler.service`, que executa `scripts/channel-scheduler.js`. O serviço mantém agenda, espera por recursos, checkpoints, QA, filas e reconciliação. A meta configurada de 60 vídeos/dia não é capacidade demonstrada. Consultar o estado recente no plano e no serviço; nenhuma postagem nova é afirmada por este README.

```bash
env XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus   systemctl --user status ai-video-scheduler.service --no-pager
```

YouTube/Shorts usam Studio Android. Não iniciar `npm run scheduler` para retomar Pulso: esse comando pertence ao fluxo independente AgentTube/Express/SQLite. A [fronteira entre pipelines](docs/adr/0001-fronteira-entre-pipelines.md) preserva essas capacidades sem duplicar publicadores.

## Desenvolvimento e histórico

Ler [AGENTS.md](AGENTS.md) antes de alterar código. Testes: `node --test tests/<arquivo>.test.js`; integração: `npm run test:ci`; lint: `npm run lint`. Suítes de integração devem usar estado isolado. Não reiniciar serviço, interromper treino ou repetir envio incerto para validar uma mudança.

O [README anterior do AgentTube](docs/archive/alinhamento-2026-11-02/README.md.original) permanece integral como referência do produto independente; seus comandos/configurações não são instruções de operação do Pulso. Documentos históricos, comparativos e pilotos rejeitados não substituem a última aprovação. Fontes, mídia e trabalho anterior são preservados.

Licença e atribuições existentes: [LICENSE](LICENSE). A documentação original preserva os créditos do projeto de origem.
