# Direção criativa aprovada — 01/11/2026

O proprietário aprovou a encenação da linha de triagem de laranjas: “é isso”. Ressalva explícita: a fruta atravessava um suporte, o que não deve acontecer. Esta é uma aprovação da criação e do movimento, com correção espacial necessária; não autoriza repetir laranjas/máquinas em narrativas de outros assuntos.

A referência persistente é `utils/narrative-creative-reference.js`, injetada em **todas as chamadas do autor adaptativo**, inclusive reparos. IDs, revisão e hashes participam da identidade de cache. O modelo recebe a direção em texto; não depende de acessar o Markdown ou assistir a um arquivo local.

Para cada narrativa: identificar sujeitos, ações, ambiente, objeto afetado e consequência; desenhar as formas necessárias àquele assunto; estabelecer estado inicial; executar preparação, ação, contato/transformação e resultado; manter identidade/estado entre frases. Sincronizar movimentos à fala e compor os dois formatos. Câmera, texto e robô conduzem a explicação; não substituem a ação dos objetos.

Planejar corredores com a dimensão inteira do objeto. Peças sólidas não atravessam suportes/paredes/portas; contato deve ocorrer antes de empurrar, impactos devem assentar sobre superfícies, articulações precisam de pivô/folga. Sinais conceituais não precisam simular gravidade. Não inventar destruição, causalidade, quantidade ou sucesso que a fala não afirma.

## Integração e verificação sem gasto de modelo revisor

- Autor v2.12: referência permanente e exigência de `spatialChecks` para peças 3D que declaram translação no formato adaptativo compacto.
- Normalizador compartilhado: valida referências de malhas e executa `narrative-spatial-audit` antes de aceitar desenhos; o validador do episódio e a auditoria existente passam pelo mesmo normalizador.
- Verificador local: esferas, caixas orientadas e cilindros; posição/rotação/escala hierárquicas e trilhas globais, nos dois layouts. Amostragem inclui subquadros adaptativos e recusa velocidade que exceda o orçamento de amostragem. Contato é permitido; penetração acima da tolerância gera diagnóstico com objetos, malhas, formato e tempo.
- O diagnóstico retorna ao reparo já existente do autor. Não há chamada adicional de LLM revisor nem aumento de orçamento/tentativas.
- Limites: verifica **pares declarados**, não descobre automaticamente todo sólido possível; esferas elipsoidais e certos pares com cilindros usam aproximações conservadoras. Não é um simulador físico universal, detector de toda topologia, nem prova de qualidade estética. Geometrias complexas devem ser decompostas em sólidos verificáveis. Legacy 2D/receitas existentes continuam compatíveis; a geração recorrente completa ainda exige comprovação real.

## Referência e reprodução

Original aprovado: `docs/evidencias/fruit-sorting-motion-20261101/`, hashes preservados em `narrative-creative-reference.js`. Correção: `docs/evidencias/fruit-sorting-collision-fix-20261101/`. Suportes deslocados para fora da saída, travessas acima do volume de trabalho, acomodação da fruta ajustada à superfície da bandeja. O exemplo fica em `scripts/fixtures/fruit-sorting-motion.cjs`; o renderer continua genérico.

Reprodução local, com áudio/timings preservados: `node scripts/render-directed-scene-test.cjs --sorting --collision-fix`. O áudio original é reutilizado; não há chamada de TTS/modelo nessa reprodução. O script respeita o lock compartilhado do render.

## Próximos passos de produção

1. Manter esta referência no prompt e nos testes de regressão; não trocar por ícones ou imagens paradas.
2. Comprovar uma saída nova do autor real em outra narrativa, respeitando orçamento existente e fonte factual.
3. Ampliar cobertura espacial para descoberta automática de pares, volumes complexos e articulações, com testes que reproduzam defeitos reais; não anunciar cobertura além da implementada.
4. Validar o ciclo geração/QA/publicação do serviço sem interromper jobs ativos. O aceite deste exemplo não comprova cadência ou envio social.
