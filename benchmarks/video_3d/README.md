# Benchmark de vídeo 3D

Experimento ilustrativo de 48 s, Full HD a 30 fps, sem inclusão na fila social. A missão é comparar os vídeos efetivos; código e prévias não equivalem à entrega concluída.

```bash
python3 benchmarks/video_3d/run.py --all
```

O runner verifica dependências, prepara/reutiliza a narração, espera o gate e o lock da produção, executa A → B → C → D, copia a mesma faixa AAC para os quatro masters e valida/gera o comparativo. Pacotes npm do benchmark ficam isolados. Não inicia nem reinicia o scheduler.

Para revisar antes de um render completo:

```bash
python3 benchmarks/video_3d/run.py --engine A --preview
python3 benchmarks/video_3d/run.py --engine B --preview
python3 benchmarks/video_3d/run.py --engine C --preview
python3 benchmarks/video_3d/run.py --engine D --preview
node --test benchmarks/video_3d/shared/contracts.test.cjs
```

Use `--prepare` para reconstruir a cena Blender após alterar o contrato espacial. A alteração de uma cena não autoriza reutilizar frames nativos antigos; preserve-os em outro diretório antes de reconstruir. Falhas e tentativas são registradas em `logs/` e `comparacoes/measure-*.json`.

## Fronteiras de implementação

- **A:** CLI e composição `NarrativeEpisode` já existentes. `prepare.cjs` usa `buildChapterInputs`, `buildDeterministicScene`, `normalizeScene`, `normalizeIllustrations`, envelope de fala e validação de props originais. Somente os dados da narrativa/ilustração são adaptados. Three 0.186.1 e robô aprovado do projeto preservados.
- **B:** `motores/threejs/Procedural.jsx`, geometria gerada em Three 0.187.0, R3F e ThreeCanvas. Não carrega GLB.
- **C:** `motores/blender/build.py` cria geometria/material/luzes/câmera e keyframes reais no Blender; Eevee produz a sequência RGBA. Remotion monta os frames com texto e áudio comuns.
- **D:** `motores/hibrido/Hybrid.jsx` carrega o GLB exportado do Blender e aplica poses/câmera a cada frame, usando Three 0.187.0.

`shared/model.cjs` define o mesmo cenário e os mesmos acontecimentos; `shared/entry.jsx` fornece a montagem comum de B/C/D. A usa seus próprios componentes de produção, inclusive o apresentador GLB. A comparação explicita essa diferença; não trata A como um renderer 2D puro.

Há uma única síntese de voz. `roteiro/narracao.wav` é o master PCM; `roteiro/narracao.m4a` é uma única codificação AAC reutilizada sem recodificar em todos os MP4. Storyboard e eventos de palavras são congelados por SHA-256. A fala, a trilha (ausente) e as legendas não mudam entre motores.

O formato final de todos os vídeos é 1920×1080. O palco 3D é 1690×670 dentro desse quadro, igual ao espaço de ilustração do motor original; o Blender renderiza essa área em resolução nativa, sem upscale. Todos usam H.264, CRF 19, preset medium e yuv420p. O comparativo reduz cada master para um quadrante de 960×540.

Os testes espaciais verificam flutuação, piso fixo, ordem das comportas e passagem do barco. Não são um solver de colisão geral. A parede frontal é um corte esquemático; enchimento e deslocamento têm velocidade ilustrativa, sem simulação física de fluido.

Tempo de render e RAM são medidos; a VRAM sysfs é do dispositivo inteiro e não é atribuída exclusivamente ao motor. Julgamentos visuais são vinculados aos hashes dos MP4; uma mudança nos arquivos invalida as notas antigas. Consultar `PROGRESSO.md` para o estado da execução e, ao concluir, `RELATORIO_FINAL.md`.


## Tempos e cache

`comparacoes/metricas.json` separa criação/preparo, render nativo, montagem Remotion, mux, validação e espera por recursos. O total automático até pronto começa com o roteiro e áudio congelados. A síntese inicial desta execução não foi cronometrada: esse campo permanece nulo, sem estimativa fabricada. Execuções futuras sem narração passam a registrar sua geração. O tempo de programação/revisão do benchmark também não é comparado como custo recorrente de um motor.

C e D reutilizam a mesma construção Blender; o custo aparece em cada caminho considerado isoladamente, mas não deve ser somado duas vezes no lote. Se os 1.440 PNGs nativos estiverem válidos, a retomada preserva a medição do render que os produziu. `run.py --all` pode refazer a validação e o comparativo, sem refazer masters cujo hash de entrada e de saída continua válido.

Para verificar retorno visual ao mesmo frame em B/D, após renderizar D:

```bash
node benchmarks/video_3d/shared/guard.cjs node benchmarks/video_3d/shared/seek-check.cjs
```

O teste abre um Studio local temporário na porta 3199, faz 14 comparações reais de pixels e o encerra. Não usa uma sessão autenticada do navegador.

## Assets recuperáveis

A entrega v2.14.0 inclui os cinco MP4 como downloads separados e `video-3d-assets-v2.14.0.zip` com áudio único, cena Blender, GLB, frames de revisão e prancha. Para restaurar, extraia o ZIP dentro de `benchmarks/video_3d/`; seu `assets-manifest.json` contém os hashes. Os 1.440 PNGs intermediários podem ser regenerados e não são duplicados na release. A narração original e as palavras sincronizadas permanecem preservadas; o renderer original encontra o robô já versionado no projeto.
