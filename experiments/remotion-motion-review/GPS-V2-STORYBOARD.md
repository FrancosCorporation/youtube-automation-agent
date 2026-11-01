# GPS v2 — encenação com apresentador

Pedido atual: continuar a revisão v55 e entregar a melhor versão. O plano vigente continua em `../../plan.md`, §3.0; este documento detalha somente esta composição.

## Entrega

37,167 s / 892 quadros / 24 fps. Horizontal 1920×1080 principal; vertical 1080×1920 reorganizado. Preservar GPS v1. Narração Francisca original, legendas com tempos reais do SRT, GLB Mixamo aprovado e envelope de voz 50 Hz. Publicado e verificado: https://francoscorporation.ddns.net/remotion-review/previews/gps-explainer-20261023-v2/ . Página com seleção de formato, download e duas composições no Studio existente. Duração do contêiner final: 37,169 s.

## Direção

Fundo azul petróleo, tipografia creme, sinais ciano, distância/erro de relógio âmbar, resultado verde. O objeto central executa a ação explicada. O apresentador muda de lado por corte no trecho das esferas, nunca atravessa os gráficos. Vertical: diagrama superior e robô com síntese abaixo, legendas em área independente. Horizontal: demonstração de um lado e apresentador do outro.

| Tempo | Encenação | Movimento / foco |
|---|---|---|
| 0–3,002 | Celular no mapa procurando localização | Abrir de um close do aparelho para o contexto; nenhum pin resolvido antes da explicação. |
| 3,002–6,675 | Satélite em trajetória orbital; dados de horário e posição junto ao emissor | Close no satélite, abrir para incluir o receptor. |
| 6,675–9,664 | Onda percorre o caminho até o celular | Mostrar emissão, trajetória contínua e chegada; relógio acompanha o intervalo. |
| 9,664–14,420 | Tempo se transforma em medida | Régua se estende no mesmo percurso; fórmula curta, sem valores inventados. |
| 14,420–19,407 | Esfera centrada no satélite | Malha projetada em 3D se forma e gira; pontos têm o mesmo raio matemático. |
| 19,407–22,963 | Outras esferas entram em sequência | Sinais chegam e superfícies se cruzam; centros e raios compartilham uma solução 3D. |
| 22,963–24,858 | Quarta medida | Quarto satélite entra; sem afirmar que três sinais comuns já resolvem o relógio. |
| 24,858–29,35 | Close no relógio do celular | Sinal chega, ponteiro inicialmente deslocado se alinha à referência. |
| 29,35–31,365 | Volta às quatro medidas | Destacar posição e correção do relógio calculadas conjuntamente. |
| 31,365–37,167 | Match cut para o celular no mapa | Aproximação, pin aparece; pausa legível após o fim da voz. |

## Fontes e limites

FAA: https://www.faa.gov/about/office_org/headquarters_offices/ato/service_units/techops/navservices/gnss/gps/howitworks

USGS: https://earthquake.usgs.gov/monitoring/gps/about.php

Ambas consultadas em 23/10/2026. Tempo do sinal e dados de posição permitem estimar distâncias; pelo menos quatro medições resolvem posição e desvio do relógio. A quarta medida não é um pacote especial de sincronização: participa do cálculo conjunto. Esferas/tempos/órbitas/mapa são esquemas fora de escala; não ilustram uma posição geográfica real. A narração original contém essa explicação em linguagem acessível e foi preservada.

## Verificação e entrega concluídas

- 64 testes focados passaram; TypeScript e ESLint aprovados.
- 12 capturas por aspecto no Studio, sem overflow em títulos/notas/legendas. Retorno ao frame 196 pixel-idêntico após o frame 879 nos dois formatos.
- Seis benchmarks de 2 s confirmaram o movimento de sinal, esfera e relógio. Depois, os mesmos seis trechos dos MP4s finais foram reproduzidos no Chrome e amostrados sequencialmente.
- Gate dos masters liberou às 20:52 BRT: carga 9,28, RAM disponível 18,4 GiB e nenhum renderer concorrente. ANGLE SwiftShader, concorrência 1. Tempos reais: horizontal 210,046 s (5,65× a duração); vertical 227,138 s (6,11×).
- MP4s finais H.264/AAC, 892 quadros/24 fps, 37,169 s. Decodificação integral aprovada; 12 quadros semânticos de cada master inspecionados pelo agente.
- Mesma voz/tempos, trilha sintetizada original em ganho 0,055 com ducking, quatro SFX e fade final. O render inicial elevou a intensidade ao converter mono para estéreo; o mix foi normalizado já em estéreo e remuxado sem mudar nenhum pacote H.264. Medição dos masters finais: −14,15 LUFS / −3,4 dBTP / LRA 2,6, PCM de áudio idêntico entre formatos. Os relatórios pré-render permanecem históricos.
- Publicação HTTPS verificada: arquivos remotos iguais por SHA-256, Range 206, playback, troca de formato, download, mobile 390×844 sem overflow e ambas as composições no Studio/frame 650; nenhum erro JS/HTTP.
- V1 preservada; apenas prévia pública. Revisão técnica/visual do agente, sem registrar aceite humano.

Evidência consolidada: `../../docs/evidencias/gps-explainer-remotion-2026-10-23/v2-evidence.json`. Relatórios e capturas: `renders/gps-v2-review/`.

## Reprodução

Executar no diretório deste projeto. Os comandos de render revalidam o gate do host. Publicação exige revisão visual aprovada vinculada aos hashes atuais.

```sh
node scripts/prepare-gps-v2-audio.cjs
node scripts/render-gps-v2.mjs masters both
node scripts/finalize-gps-v2-audio.cjs
node scripts/verify-gps-v2-masters.cjs
node scripts/check-gps-v2-motion.cjs masters
```

Inspecionar os quadros e a reprodução, atualizar `visual-review.json` com os hashes efetivamente aprovados e então executar:

```sh
node scripts/publish-gps-v2-preview.cjs
node scripts/deploy-review.mjs
node scripts/check-gps-v2-remote.cjs
```
