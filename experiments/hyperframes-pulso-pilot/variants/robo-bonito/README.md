# Novo candidato — robô bonito

Em 12/10/2026, o usuário pediu uma nova versão 3D baseada em `../../renders/exemplo robo bonito.png`, pelo mesmo processo do último robô gerado. O original foi preservado em `assets/exemplo-robo-bonito-original.png`. O imagegen integrado preparou uma referência frontal de corpo inteiro em A-pose e fundo branco, preservando o desenho compacto, a cabeça grande, o casco branco, os mecanismos escuros e o sorriso azul. Prompt: `prompt-referencia.txt`; saída: `assets/robo-bonito-referencia-apose.png`.

A referência foi enviada pela interface autenticada do Tencent Hunyuan 3D V3.1, com 500k faces selecionadas. A cota visível passou de 19 para 18. O GLB foi baixado pelo controle GLB do próprio asset; nenhuma URL assinada, credencial ou cookie foi copiado para o projeto.

## Resultado

| Item | Medida |
|---|---|
| Arquivo | `assets/robo-bonito-hunyuan.glb` |
| Tamanho | 49.815.868 bytes |
| Triângulos / vértices | 500.036 / 315.191 |
| Malhas / materiais / imagens | 1 / 1 / 3, imagens incorporadas |
| Skins / clips | 0 / 0 |
| Prévia MP4 | 8 segundos, 1920×1080, 24 fps, 192 quadros, H.264/yuv420p |
| Áudio | Ausente, conforme a prévia visual anterior |
| HyperFrames / Three.js | 0.8.149 / 0.186.1 |

Vídeo: `../../renders/pulso-robo-bonito-preview.mp4`. Frente, perfil, costas e rosto do arquivo codificado: `../../renders/pulso-robo-bonito-video-{frente,perfil,costas,close}.png`. O contato `../../renders/pulso-robo-bonito-video-cortes.png` reúne os quadros 47/48, 95/96 e 143/144, antes/depois dos cortes em 2/4/6 s.

O check estrito passou sem erros/avisos de lint, runtime ou motion, sem problemas de layout em nove amostras e com 51/51 contrastes WCAG AA. A renderização usou GPU de hardware (RX 6750 XT), com um worker. A auditoria estrutural não detectou índices inválidos, posições/normals/UVs não finitos, triângulos de área zero, índices repetidos ou faces duplicadas por índice. Não certifica auto-interseções ou deformação. Relatórios: `mesh-audit.json`, `check.log`, `video-metrics.json`, `qa-metrics.json`.

O candidato anterior também foi revalidado: `revalidacao-anterior.json`, `revalidacao-malha-anterior.json` e `revalidacao-anterior.log`. O GLB anterior e seu MP4 foram preservados.

## Inspeção visual e limites

O novo GLB mantém a silhueta compacta, cabeça grande, olhos em arcos e sorriso da referência preparada. Mãos e pés estão presentes e o corpo cabe nos planos abertos. Perfil e costas foram inferidos pelo gerador a partir de uma única vista. O visor tem reflexos mais fortes do que a imagem original; o close permite avaliar irregularidades de textura/superfície. A captura do Tencent não substitui a inspeção do MP4.

A malha é estática: olhos/boca são gráficos do material e não possuem controles independentes. A prévia movimenta o objeto inteiro e troca a câmera; não demonstra fala, piscadas, gestos separados ou skinning. Para animar, preparar articulações/rig e controles faciais e validar amplitudes/deformação antes de substituir o apresentador ativo. Esta variante não foi promovida para produção.

## Reprodução

A partir da raiz do piloto:

```bash
node scripts/build-bonito-robot-preview.js
python3 scripts/audit-generated-glb.py variants/robo-bonito/assets/robo-bonito-hunyuan.glb --output variants/robo-bonito/mesh-audit.json
env -u DISPLAY -u XAUTHORITY node scripts/qa-bonito-robot-preview.js
env -u DISPLAY -u XAUTHORITY HYPERFRAMES_NO_TELEMETRY=1 npx --yes hyperframes@0.8.149 check variants/robo-bonito --strict --snapshots
env -u DISPLAY -u XAUTHORITY HYPERFRAMES_NO_TELEMETRY=1 npx --yes hyperframes@0.8.149 render variants/robo-bonito --output renders/pulso-robo-bonito-preview.mp4 --fps 24 --quality high --workers 1 --gpu --browser-gpu
```

Prévia persistente: http://localhost:3005/#project/robo-bonito. O usuário pode examinar e editar o projeto no Studio.

Dois workers NVIDIA Nemotron fizeram extrações de código e baseline em scratch. Relatórios e revisão: `worker-reports/`; os números e os seeks foram conferidos pelo orquestrador. `candidate` do executor não equivale a aprovação visual.

## Prévia no DNS

Vídeo público: https://francoscorporation.ddns.net/games/play/pulso-ia/robo-bonito-preview.mp4

Cópia persistente em `/home/servidor/Git/site_corp/games_public/pulso-ia/robo-bonito-preview.mp4`, servida pela rota estática existente do Caddy. HTTPS 200, Content-Type video/mp4, SHA-256 idêntico ao original e Range 206. Reprodução em Chromium confirmou 8 s, 1920×1080, avanço do player e ausência de erro. Evidência: `dns-publication.json`.
