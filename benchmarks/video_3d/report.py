"""Generate the report from measured artifacts; reuse visual judgments only for matching hashes."""
import json
from pathlib import Path
BASE=Path(__file__).resolve().parent

def duration(s):
    if s is None:return 'não medido'
    return f'{int(s//60)}min {s%60:04.1f}s'
def main():
    metrics=json.loads((BASE/'comparacoes/metricas.json').read_text())
    engines=metrics['engines'];board=json.loads((BASE/'roteiro/storyboard.json').read_text())
    evidence=BASE/'comparacoes/avaliacao-visual.json'
    visual=json.loads(evidence.read_text()) if evidence.exists() else {}
    valid_visual=bool(visual) and all(visual.get('outputHashes',{}).get(k)==v['sha256'] for k,v in engines.items())
    rows=[];render_rows=[]
    for k,v in engines.items():
        t=v['timing']
        rows.append(f"| {k} | {duration(t['creationSeconds'])} | {duration(v['renderSeconds'])} | {duration(t['muxSeconds'])} | {duration(t['validationSeconds'])} | **{duration(t['readyFromFrozenNarrationSeconds'])}** | {duration(t['resourceWaitSeconds'])} |")
        render_rows.append(f"| {k} | {v['renderFps']:.2f} | {v['peakTreeRssBytes']/2**30:.2f} | {v['gpuDevicePeakUsedBytes']/2**30:.2f} | {v['sizeBytes']/2**20:.2f} | {v['frames']} | {v['renderFailures']} |")
        if valid_visual:v['qualitativeScores']=visual['engines'][k]['scores']
    fastest=min(engines,key=lambda k:engines[k]['timing']['readyFromFrozenNarrationSeconds'])
    c=engines['C']['timing']
    links='\n'.join(f"- {k}: [{Path(v['path']).name}](outputs/{Path(v['path']).name}) — `{v['path']}`; SHA-256 `{v['sha256']}`." for k,v in engines.items())
    narration=(BASE/'roteiro/narrativa.md').read_text().strip()
    scenes='\n'.join(f"| {s['startFrame']/30:.2f}–{s['endFrame']/30:.2f}s | {s['title']} | {s['objective']} |" for s in board['scenes'])
    visual_section='Avaliação visual ainda pendente; nenhuma nota ou vencedor estético inferido a partir de recursos técnicos.'
    if valid_visual:
        score_rows='\n'.join('| '+k+' | '+' | '.join(str(v['scores'][field]) for field in ['spatial','visual','narrativeClarity','motion','automation'])+' |' for k,v in visual['engines'].items())
        observations='\n\n'.join(f"**{k}:** {v['observations']}" for k,v in visual['engines'].items())
        best_visual=visual['bestVisual'].rstrip('.')
        recommendation=visual['recommendation'].rstrip('.')
        visual_section=f"""{visual['method']}

| Motor | Espaço | Visual | Clareza | Movimento | Automação |
|---|---:|---:|---:|---:|---:|
{score_rows}

{observations}

**Melhor resultado visual observado:** {best_visual}. **Abordagem recomendada neste experimento:** {recommendation}.

Limite da avaliação: {visual['limitations']}"""
    report=f"""# Benchmark real de quatro motores de vídeo 3D

## Resultado e escopo

Quatro masters reais e um comparativo sincronizado, todos com **1920×1080, 30 FPS, 48 segundos, 1.440 frames e a mesma narração PT-BR**. Os arquivos passaram por contagem de frames, decodificação completa, verificação de áudio e inspeção de presença de geometria. A conclusão visual depende da evidência registrada abaixo. O experimento não foi enviado à fila social e não alterou os componentes de produção.

Tema sorteado: **Como uma eclusa levanta um barco**. Semente **1055545869**; seleção `random.Random(seed).choice(candidates)`, lista em `roteiro/tema.json`. É uma demonstração educativa em corte, com dimensões e velocidade ilustrativas, sem solver físico de fluido. A explicação de comportas, equalização de níveis e enchimento por gravidade segue a [TVA](https://www.tva.com/Environment/Managing-the-River/How-the-Navigation-System-Works).

## Narrativa única

{narration}

Uma única síntese Edge TTS, voz `pt-BR-AntonioNeural`, sem trilha. Fala original de 46,584 s, início deslocado em 500 ms e duração final de 48 s. `narracao.wav` é o master PCM; `narracao.m4a` foi codificado uma vez e copiado sem recodificar para todos os MP4. O SHA-256 do áudio canônico é `{board['audioSha256']}`; o hash da fala decodificada é igual nos cinco MP4. Eventos reais de palavras controlam a mesma paginação de legendas.

## Storyboard e acontecimentos

| Intervalo | Conceito | Objetivo visual comum |
|---|---|---|
{scenes}

A câmera orbita, muda para vista lateral, aproxima a passagem de enchimento, entra na área aberta em corte e se afasta para acompanhar a saída. A água e o barco sobem juntos; a comporta inferior fecha antes do enchimento, e a superior abre após equalização. Câmera, poses e eventos derivam dos mesmos frames; o Blender recebe keyframes reais e não imagens estáticas com zoom.

## Arquitetura encontrada e preservada

`scripts/channel-scheduler.js` coordena a produção existente. `scripts/generate-animated-video.js` integra roteiro, QA factual, Edge TTS e autoria de cenas; `utils/narrative-scene-author.js`, planos de episódio/ilustração e trilhas normalizam a encenação. `utils/narrative-episode-renderer.js` aplica o lock e renderiza `NarrativeEpisodeV2.tsx`, que contém o palco `NarrativeIllustrationScene.tsx` e o robô aprovado. Os hashes desses componentes foram registrados em `comparacoes/environment.json`; a verificação final está em `comparacoes/preservation.json`.

A adaptação da narrativa usa esses normalizadores, o envelope da fala e o validador de props. O benchmark tem pacote npm próprio; nenhum upgrade de Three.js foi aplicado à produção.

| Versão | Implementação real | Particularidades |
|---|---|---|
| A | CLI, composição e métodos atuais, com props de eclusa | Mantém robô aprovado e Three 0.186.1. O original já é 3D. |
| B | Remotion + ThreeCanvas + R3F; meshes procedurais | Three r187, materiais físicos, iluminação de ambiente procedural e normais de água vinculadas ao frame; não carrega GLB. |
| C | Python bpy cria meshes, materiais, câmera, luzes e animações; Eevee renderiza PNGs; Remotion monta | Eevee 64 amostras, ray tracing, AgX, DOF e reflexos. Cena `.blend` reproduzível. |
| D | Blender exporta GLB real; GLTFLoader/R3F animam grupos | Bevels e geometria exportada; mesma câmera/eventos por frame. Materiais glTF não reproduzem integralmente os nós do Blender; normal da água recomposta por frame no Three. |

O palco 3D tem **1690×670 pixels dentro do master Full HD**, respeitando a área original; C renderiza essa área nativamente, sem upscale. B/C/D compartilham títulos, legendas e montagem. A preserva seu apresentador existente, ausente nos demais; isso adiciona custo e diferencia a composição, portanto não é uma comparação isolada de bibliotecas. O modelo educativo é equivalente nos quatro.

## Tecnologias e versões

- Remotion / @remotion/three **4.0.537**, React / React DOM **19.2.3**, R3F **9.8.2**.
- Three **0.186.1** em A; **0.187.0 (r187)** em B/D, confirmado no pacote instalado e no [release oficial](https://github.com/mrdoob/three.js/releases/tag/r187).
- Blender **5.2.2 LTS**, exportador Khronos glTF Blender I/O **5.2.40**; FFmpeg **8.0.1**, Node **22.22.1**, Python **3.14.4**.
- Host Xeon E5-2697 v3, 28 threads lógicas, cerca de 30 GiB RAM; AMD Navi 22 com 12 GiB VRAM. Renders serializados, `nice 10`, afinidade de 6 CPUs, Remotion concorrência 1, ANGLE. Outros serviços permaneceram ativos.
- Todos os masters: H.264, CRF 19, preset medium, yuv420p; mesma faixa AAC. Comparativo: cada master reduzido a 960×540, grade 2×2 e áudio único.
- Documentação primária consultada: [Remotion Three](https://www.remotion.dev/docs/three), [ThreeCanvas](https://www.remotion.dev/docs/three-canvas), [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction), [Three.js](https://threejs.org/). API bpy conferida na versão instalada; consulta web ao manual Blender não ficou disponível.

## Tempo de criação até o MP4 pronto

Valores medidos, incluindo criação automática a partir do roteiro/áudio congelados, render, mux e validação completa. Em A/B, a instanciação da geometria acontece dentro do processo de render e está incluída nessa coluna, sem cronômetro separado. A preparação comum é incluída em cada coluna de custo individual; a criação Blender compartilhada entra em C e D para representar cada caminho executado isoladamente. **Não somar essas linhas para estimar o lote**, pois recursos compartilhados seriam contados duas vezes.

| Motor | Criação/preparo | Render + montagem | Mux | Validação | Pronto, trabalho ativo | Espera registrada |
|---|---:|---:|---:|---:|---:|---:|
{chr(10).join(rows)}

**C detalhado:** render nativo Blender {duration(c['nativeRenderSeconds'])}; montagem/encode Remotion {duration(c['remotionRenderSeconds'])}. A espera por lock/recursos fica separada, inclusive quando um motor aguardou outro experimento.

**Limite explícito da medição:** a síntese inicial única e o tempo de desenvolvimento/revisão pelo agente não foram cronometrados separadamente nesta execução. Assim, o total inicial absoluto desde a escolha do tema permanece **não medido**; não é apresentado como se fosse conhecido. Os totais da tabela começam com o roteiro e a voz congelados. O runner agora mede a preparação e, quando não há áudio, também a síntese inicial para execuções futuras. Não ressintetizamos a narração para fabricar esse número.

## Desempenho medido

| Motor | FPS de produção | Pico RAM árvore GiB | Pico VRAM dispositivo GiB | MP4 MiB | Frames | Falhas de processo no render final |
|---|---:|---:|---:|---:|---:|---:|
{chr(10).join(render_rows)}

FPS de produção = 1.440 / tempo de render; em C inclui render nativo e montagem. RAM é soma de RSS da árvore amostrada a cada 500 ms, podendo contar páginas compartilhadas mais de uma vez. VRAM é **o dispositivo inteiro**, incluindo outros processos; consumo exclusivo do motor não foi mensurável. Os resultados são uma execução neste host, sem várias rodadas estatísticas. Tempos incluem empacotamento, carregamento e encode. O menor tempo automático até pronto observado foi **{fastest}**.

Comparativo 2×2: criação e verificação em **{duration(metrics['comparison']['creationAndValidationSeconds'])}**. Métricas brutas, comandos, tentativas e tempos de espera estão em `comparacoes/measure-*.json`; logs locais em `logs/`.

## Verificação, falhas e correções

- FFprobe confirma 1920×1080, 30 FPS, 48 s, 1.440 frames e áudio nos quatro masters. FFmpeg decodifica integralmente, sem erro; hashes do áudio decodificado coincidem com o canônico.
- Detecção de preto/congelamento registrada por motor em `metricas.json`. Presença de geometria verificada aos 3, 11, 16, 23, 29, 36 e 44 s com máscara do cenário, além da inspeção visual. Isso detecta a prévia híbrida vazia que um exit code zero não detectou; não é um detector universal de defeitos gráficos.
- Testes espaciais em todos os 1.440 estados: fundo da câmara fixo, barco flutuando, comportas na ordem correta e espaço de passagem. Teste de repetição de poses após seeks. B/D passaram 14 comparações reais de canvas em navegador, após avanço/retorno: diferença máxima de canal **0**, em `seek-pixels.json`. O renderer observado foi ANGLE/AMD Radeon RX 6750 XT, WebGL 2.0.
- Primeira prévia D terminou sem geometria: Suspense interno ocultava a espera de carregamento do ThreeCanvas. Removido o limite interno; modelo carrega antes de capturar. Evidência preservada em `D-preview-blank.png`, com correção e verificação em `defeitos.json`.
- C tinha granulação nas reflexões com 32 amostras; render final usa 64. B tinha ondulações excessivamente regulares; amplitude reduzida e ondas periódicas combinadas. Passagem da tubulação recebeu abertura no corte da parede.
- A fila também identificava guards aguardando como renders ativos por seus argumentos; corrigido excluindo apenas os próprios guards enquanto o lock está adquirido, sem ocultar filhos reais.
- Gate inicial confundia autoria com render; após adquirir o mesmo lock da produção, apenas o processo exato de autoria é excluído. Filhos de render e limites de RAM/carga continuam protegidos. Espera interrompida não é contabilizada como render fracassado.
- Retomada usa hashes de entradas e saídas; sequência Blender tem manifesto próprio. Frames de outra cena são arquivados, nunca reutilizados silenciosamente. Cache nativo não substitui sua medição original por tempo próximo de zero.

## Avaliação visual e recomendação

{visual_section}

## Limitações restantes e combinação dos motores

Esta é uma encenação específica, com cenário procedural dirigido; não comprova transformar qualquer narrativa arbitrária em 3D cinematográfico nem substituir a autoria do pipeline de notícias. O software reproduz o benchmark sem LLM adicional, depois de fixados roteiro e contrato espacial. Para novos assuntos é necessário elaborar outro contrato visual.

Os enquadramentos e acontecimentos foram mantidos equivalentes. A topologia arredondada do Blender e diferenças de iluminação/material fazem parte da comparação; glTF não preserva todos os shaders nativos. O fluxo de água é indicado de forma esquemática, e a parede frontal é um corte. A avaliação não equivale a teste com público nem a inspeção humana integral em tempo real.

É possível reutilizar modelos Blender em D e reservar C para planos que dependem de reflexos/DOF nativos, usando o mesmo storyboard, narração e composição Remotion. A produção original segue disponível; nenhum motor experimental foi ativado nela automaticamente.

## Arquivos e reprodução

{links}
- [Comparativo sincronizado](outputs/comparativo_4_motores.mp4) — `{BASE}/outputs/comparativo_4_motores.mp4`.
- [Prancha comparativa](comparacoes/comparativo.png), [métricas](comparacoes/metricas.json), [storyboard](roteiro/storyboard.json), [roteiro](roteiro/narrativa.md), [WAV único](roteiro/narracao.wav).
- Modelos: `motores/blender/eclusa.blend` e `motores/hibrido/lock.blender.glb`; frames nativos em `motores/blender/frames/`.
- Evidências de integridade, ambiente e hashes em `comparacoes/`; fontes de cada motor em `motores/`.

```bash
python3 benchmarks/video_3d/run.py --all
node --test benchmarks/video_3d/shared/contracts.test.cjs
```

O comando prepara entradas, constrói a cena Blender quando necessário, aguarda recursos, renderiza ou retoma saídas válidas, verifica os arquivos, gera o comparativo e este relatório. Dependências npm são isoladas e fixadas no lockfile. Pacotes de sistema ausentes são informados explicitamente; nenhum motor é substituído. Conteúdo binário pode ser recuperado pelos assets da release indicada no README. Preservação do projeto e status do serviço são registrados separadamente, sem confundir esse benchmark com comprovação de envio social.
"""
    (BASE/'RELATORIO_FINAL.md').write_text(report)
    names={'A':'Original','B':'Three.js procedural','C':'Blender nativo','D':'Híbrido Blender + Three.js'}
    buttons=''.join(f'<button data-src="outputs/{Path(v["path"]).name}">{k} · {names[k]}</button>' for k,v in engines.items())
    time_rows=''.join(f'<tr><td>{k} · {names[k]}</td><td>{duration(v["timing"]["creationSeconds"])}</td><td>{duration(v["renderSeconds"])}</td><td>{duration(v["timing"]["readyFromFrozenNarrationSeconds"])}</td></tr>' for k,v in engines.items())
    html="""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Eclusa · quatro motores</title>
<style>body{background:#081923;color:#f3eee0;font:17px system-ui;margin:0;padding:clamp(18px,4vw,64px)}main{max-width:1200px;margin:auto}h1{font-size:clamp(28px,4vw,52px);line-height:1.1}p{color:#b5c9c7;line-height:1.6}video{width:100%;background:#061118;border-radius:12px}nav{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}button,a{color:#95d7bc}button{border:1px solid #39595c;padding:12px;background:#102c36;border-radius:8px;cursor:pointer;font:inherit}button[aria-pressed=true]{background:#95d7bc;color:#081923}table{border-collapse:collapse;width:100%;margin:24px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #294750}img{width:100%}.table{overflow:auto}</style>
<main><p>PULSO / BENCHMARK 3D</p><h1>Como uma eclusa levanta um barco</h1><p>A mesma história, a mesma voz e os mesmos acontecimentos. Quatro versões de 48 segundos em Full HD, a 30 FPS.</p><video id="player" controls preload="metadata" src="outputs/comparativo_4_motores.mp4"></video><nav><button data-src="outputs/comparativo_4_motores.mp4" aria-pressed="true">Comparativo 2×2</button>BUTTONS</nav><p><a id="download" href="outputs/comparativo_4_motores.mp4" download>Baixar vídeo selecionado</a> · <a href="RELATORIO_FINAL.md">Relatório completo</a> · <a href="comparacoes/metricas.json">Métricas</a></p><h2>Tempo até o arquivo pronto</h2><div class="table"><table><thead><tr><th>Motor</th><th>Criação/preparo</th><th>Render e montagem</th><th>Pronto após validação</th></tr></thead><tbody>ROWS</tbody></table></div><p>Tempos de processamento com o roteiro e a narração única já preparados, sem espera por recursos. A síntese inicial e o desenvolvimento não foram cronometrados; detalhes e limites no relatório.</p><h2>Os mesmos instantes, lado a lado</h2><a href="comparacoes/comparativo.png"><img src="comparacoes/comparativo.png" alt="Prancha dos quatro motores nos mesmos sete momentos da explicação"></a></main>
<script>const player=document.getElementById('player');document.querySelectorAll('button[data-src]').forEach(b=>b.onclick=()=>{const t=player.currentTime;const playing=!player.paused;player.src=b.dataset.src;player.addEventListener('loadedmetadata',()=>{player.currentTime=Math.min(t,player.duration);if(playing)player.play();},{once:true});document.getElementById('download').href=b.dataset.src;document.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});</script></html>""".replace('BUTTONS',buttons).replace('ROWS',time_rows)
    (BASE/'index.html').write_text(html)
    (BASE/'comparacoes/metricas.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':main()
