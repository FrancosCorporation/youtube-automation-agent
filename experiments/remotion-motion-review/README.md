# Remotion video

## Papel atual no Pulso — 24/10/2026

Este projeto contém as referências aprovadas GPS v2/PulsoStory e a composição compartilhada `src/NarrativeEpisode.tsx`, usada pela integração recorrente em `../../utils/narrative-episode-renderer.js`. `AiAnswerExplainer.tsx` pertence ao primeiro episódio específico já publicado; não é o gerador universal. O renderer usa Remotion 4.0.537, plano/áudio/assets por hash, gate de recursos e checkpoint por aspecto. Integração no código ainda não comprova um ciclo recorrente concluído.

Leia o [workflow autônomo](../../docs/workflow-autonomo.md) para o estado real, melhorias pesquisadas (bundle reutilizável, validação de metadata/props, recursos, outputs atômicos e retomada), QA e rollout. As melhorias estão identificadas como pendentes. O processo de produção é a unidade de usuário `ai-video-scheduler.service`; não iniciar renders paralelos sem conferir processos/locks e recursos. `npm run build` prepara bundle; não publica vídeos. Os comandos de atualização de versão abaixo são ferramentas disponíveis, não uma instrução de atualizar as dependências fixadas.

<p align="center">
  <a href="https://github.com/remotion-dev/logo">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-dark.apng">
      <img alt="Animated Remotion Logo" src="https://github.com/remotion-dev/logo/raw/main/animated-logo-banner-light.gif">
    </picture>
  </a>
</p>

Welcome to your Remotion project!

## Commands

**Install Dependencies**

```console
npm i --loglevel=error
```

**Start Preview**

```console
npm run dev
```

**Render video**

```console
npx remotion render
```

**Upgrade Remotion**

```console
npx remotion upgrade
```

## Docs

Get started with Remotion by reading the [fundamentals page](https://www.remotion.dev/docs/the-fundamentals).

## Help

We provide help on our [Discord server](https://discord.gg/6VzzNDwUwV).

## Issues

Found an issue with Remotion? [File an issue here](https://github.com/remotion-dev/remotion/issues/new).

## License

Note that for some entities a company license is needed. [Read the terms here](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md).

## Revisão externa do Studio

[Abrir PulsoStory](https://francoscorporation.ddns.net/games/play/remotion-review/?/PulsoStory).
É a interface do Remotion Studio em modo de revisão, com composição, Play/pausa,
áudio e timeline. O Studio local continua em `http://localhost:3000/PulsoStory`.
A versão externa é um snapshot: após alterações validadas, atualize com:

```sh
node scripts/deploy-review.mjs
node scripts/check-remote-review.cjs
```

O deploy cria uma release estática e troca o índice de entrada atomicamente na
rota HTTPS existente. Não altera DNS/Caddy nem expõe a API do servidor de desenvolvimento.
Não renderiza MP4. Evidências: `renders/remote-review-deployment.json` e
`renders/remote-review-qa.json`. A configuração atual usa o diretório público
`/home/servidor/Git/site_corp/games_public/remotion-review/` deste host.
