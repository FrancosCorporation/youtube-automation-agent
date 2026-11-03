---
name: video-animado-ia
description: "Manter a produção autônoma do Pulso neste host: roteiro/fonte, TTS, cenas narrativas Three.js e Remotion, humanos GLB locais, capas Gemini Android, QA e publicação pelo serviço existente. Usar para corrigir ou acompanhar esse pipeline; seguir as decisões vigentes do projeto."
---

# Produção autônoma do Pulso

Projeto: `/home/servidor/Git/youtube_ai/youtube-automation-agent/`.

1. Leia `AGENTS.md`, `docs/decisoes-vigentes.md`, o cursor único de `plan.md` e `docs/workflow-autonomo.md` no projeto. Pedidos posteriores do proprietário prevalecem; esta skill não mantém outra fila nem snapshot operacional.
2. A última aprovação adotou Three.js r187 + Remotion, humanos GLB locais detalhados/licenciados e robô aprovado. Ações e cenários explicam cada fala, com layouts independentes 16:9/9:16. Humanos de primitivas e elenco Game Farma foram rejeitados. Sem etapa Mixamo/site por vídeo. Para motion, leia a skill local `.agents/skills/pulso-motion-design/SKILL.md` e confira ambos os formatos.
3. Master YouTube horizontal: mínimo de 360 segundos de narração real, meta 950 palavras/piso 850. Produza vertical próprio e cortes; seis minutos não são o mínimo de cada corte. Não alongue artificialmente fonte curta nem confunda contagem de palavras com duração medida.
4. Gemini no emulador Android cria imagens sob demanda e capas dedicadas por aspecto. Solicite Nano Banana Pro no prompt; registre `requested-not-verified` quando o modelo efetivo não for identificável. Não abra o navegador do host após falha Android. Use locks compartilhados e proteja publicações em andamento.
5. O único produtor/publicador é a unidade de usuário `ai-video-scheduler.service`, executando `scripts/channel-scheduler.js`. Não iniciar outro scheduler ou gerar manualmente cada vídeo para substituir a automação. Neste host, consultar systemd com `XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`. Revalidar processos/health/filas/locks antes de operação; não reiniciar durante geração/render/upload/retry.
6. Corrigir causas no código, escalar writers pequenos quando falham, preservar checkpoints e trabalho aprovado. Revisão factual/supervisão locais, sem revisor LLM rotineiro ou nova aprovação humana por vídeo/capa. Seguir orçamento aplicável; NVIDIA usa a rota OpenCode autorizada sem o antigo teto local de 600 chamadas. Catálogo não prova inferência.
7. YouTube/Shorts/retries usam Studio Android; redes usam contas/adaptadores verificados. Reconciliar resultados incertos antes de reenviar. Não interromper treinamento ou afrouxar QA/recursos. Não alegar publicação por teste verde ou serviço ativo.
8. Registrar evidências no resumo e substituir cursor/linha YAI no plano. Commit/push no fork, minor +0.1 e tag/release já estão autorizados conforme AGENTS; preservar segredos, arquivos e alterações anteriores.

A versão anterior está em `references/legacy-pipeline-2026-11-02.md`, somente para histórico. Seus comandos de outro scheduler, método HyperFrames, Gemini web, cadência de cinco/dia e limites antigos foram superados. Consultá-la não autoriza reproduzir esses passos. Diagnósticos antigos de TTS precisam de reprodução e verificação local; não aplicar patches de endpoint cegamente.
