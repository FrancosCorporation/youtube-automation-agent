'use strict';
const { narrativeLabelCueFrame } = require('./narrative-word-cue');
const { normalizeAnimationTracks } = require('./narrative-animation-tracks');
const { normalizeSpatialChecks, assertSpatialChecks } = require('./narrative-spatial-audit');
const { ACTOR_CATALOG, MOTIONS, resolveHumanActor } = require('./narrative-human-actors');
const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const number = (value, min, max, name, context = '') => {
  if (!Number.isFinite(value) || value < min || value > max) {
    const received = typeof value === 'number' ? String(value) : `tipo ${typeof value}`;
    throw new Error(`illustration: ${name} fora dos limites${context ? ` em ${context}` : ''}; recebido ${received}; permitido ${min}–${max}`);
  }
  return value;
};
const color = value => value === 'none' || /^#[a-f0-9]{6}$/i.test(value || '');
const fail = text => { throw new Error(`illustration: ${text}`); };
const SHAPES = new Set(['rect', 'ellipse', 'path', 'line']);
const PROPS = new Set(['computer', 'phone', 'server', 'envelope', 'fridge', 'document', 'parcel', 'wallet', 'building']);
const ATTRIBUTES = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'x1', 'x2', 'y1', 'y2', 'strokeWidth', 'opacity'];
const vector = (value, fallback, min, max, context = '') => {
  const array = value ?? fallback;
  if (!Array.isArray(array) || array.length !== 3) fail(`vetor 3D inválido${context ? ` em ${context}` : ''}; use três números [x,y,z]`);
  return array.map((item, index) => number(item, min, max, 'vetor 3D', `${context}[${index}]`));
};

function pose(value, context = '') {
  return { x: number(value?.x, .02, .98, 'x', context), y: number(value?.y, .02, .98, 'y', context),
    scale: number(value?.scale ?? 1, .05, 3, 'scale', context), rotate: number(value?.rotate ?? 0, -360, 360, 'rotate', context) };
}

function normalizeIllustrations(raw, sentences, fps) {
  if (raw == null || Array.isArray(raw) && raw.length === 0) return [];
  if (!Array.isArray(raw) || raw.length !== sentences.length) fail('uma composição por frase é obrigatória');
  const seen = new Set();
  return raw.map(item => {
    const sentence = sentences.find(cue => cue.id === item.cueSentenceId);
    if (!sentence || seen.has(sentence.id)) fail('frase ausente ou repetida');
    seen.add(sentence.id);
    if (typeof item.explanation !== 'string' || item.explanation.length < 12 || item.explanation.length > 600) fail('explicação visual ausente');
    if (!Array.isArray(item.nodes) || item.nodes.length < 2 || item.nodes.length > 32) fail('usar 2 a 32 partes do desenho');
    const dimension = item.dimension === '3d' ? '3d' : '2d';
    const ids = new Set();
    const nodes = item.nodes.map(node => {
      if (!/^[a-z][a-z0-9_-]{0,39}$/i.test(node.id || '') || ids.has(node.id) || node.id === 'camera') fail('ID inválido ou repetido');
      ids.add(node.id);
      const evidenceSentence = node.evidenceSentenceId ? sentences.find(cue => cue.id === node.evidenceSentenceId) : sentence;
      if (!evidenceSentence || !node.evidence || !clean(evidenceSentence.text).includes(clean(node.evidence))) fail('parte sem trecho literal da fala');
      const label = String(node.label || '');
      if (label.length > 36 || label && !clean(evidenceSentence.text).includes(clean(label))) fail(`rótulo não narrado em ${sentence.id}/${node.id}; use literalLabels da frase ou vazio, máximo 36 caracteres`);
      const shapes = (node.shapes || []).map(shape => {
        if (!SHAPES.has(shape.type)) fail('primitiva não permitida');
        if (!color(shape.fill || 'none') || !color(shape.stroke || 'none')) fail('cor inválida');
        const result = { type: shape.type, fill: shape.fill || 'none', stroke: shape.stroke || 'none' };
        for (const key of ATTRIBUTES) if (shape[key] !== undefined) result[key] = number(shape[key], ['opacity', 'width', 'height', 'rx', 'ry', 'strokeWidth'].includes(key) ? 0 : -500, key === 'opacity' ? 1 : key === 'strokeWidth' ? 30 : 500, key);
        if (shape.type === 'path') {
          if (typeof shape.d !== 'string' || shape.d.length > 2200 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\s-]+$/.test(shape.d) || !/^[Mm]/.test(shape.d)) fail('path SVG inválido');
          const values = shape.d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [];
          if (values.some(value => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1200)) fail('path fora do desenho');
          result.d = shape.d;
        }
        return result;
      });
      const meshes = (node.meshes || []).map((mesh, meshIndex) => {
        const context = `${sentence.id}/${node.id}.meshes[${meshIndex}]`;
        if (!['box', 'sphere', 'cylinder', 'cone', 'torus', 'tube', 'extrude'].includes(mesh.type) || !color(mesh.color) || mesh.color === 'none') fail('malha 3D inválida');
        const result = { type: mesh.type, color: mesh.color, position: vector(mesh.position, [0, 0, 0], -8, 8, `${context}.position`),
          rotation: vector(mesh.rotation, [0, 0, 0], -6.3, 6.3, `${context}.rotation`), size: vector(mesh.size, [1, 1, 1], .01, 12, `${context}.size`),
          opacity: number(mesh.opacity ?? 1, .1, 1, 'opacity'), metalness: number(mesh.metalness ?? .15, 0, 1, 'metalness') };
        if (mesh.type === 'tube' || mesh.type === 'extrude') {
          if (!Array.isArray(mesh.points) || mesh.points.length < 2 || mesh.points.length > 40) fail('percurso 3D inválido');
          result.points = mesh.points.map((point, index) => vector(point, null, -12, 12, `${context}.points[${index}]`));
        }
        return result;
      });
      const actorId = node.actorId == null ? null : String(node.actorId);
      const actor = actorId ? resolveHumanActor(actorId) : null;
      if (actorId && !actor) fail(`ator humano não permitido: ${actorId}`);
      if (actorId && dimension !== '3d') fail('ator humano detalhado requer ilustração 3D');
      if (actorId && (shapes.length || meshes.length || node.prop)) fail('ator humano usa malha licenciada, sem primitivas substitutas');
      if (node.prop === 'person') fail('não desenhe pessoas com pictogramas; use actorId em cena 3D');
      if (shapes.length > 100 || meshes.length > 60 || !shapes.length && !meshes.length && !PROPS.has(node.prop) && !actorId) fail('desenho vazio ou excessivo');
      if (node.prop && !PROPS.has(node.prop)) fail('prop desconhecido; desenhar com shapes');
      const actorMotion = actorId ? String(node.actorMotion || 'Idle') : null;
      if (actorId && (!MOTIONS.has(actorMotion) || !actor.animations.includes(actorMotion))) fail(`movimento humano não suportado: ${actorMotion}`);
      const actorMotionCueText = actorId && actorMotion !== 'Idle' ? String(node.actorMotionCueText || '') : '';
      if (actorId && actorMotion !== 'Idle' && (!actorMotionCueText || !clean(sentence.text).includes(clean(actorMotionCueText)))) {
        fail('movimento humano precisa de cue literal na fala');
      }
      const actorMotionStartFrame = actorId && actorMotionCueText
        ? (narrativeLabelCueFrame(actorMotionCueText, sentence) ?? sentence.startFrame)
        : evidenceSentence.startFrame;
      return { id: node.id, evidence: node.evidence, ...(node.evidenceSentenceId ? { evidenceSentenceId: node.evidenceSentenceId } : {}), label,
        ...(node.prop ? { prop: node.prop } : {}), ...(actorId ? { actorId, actorSha256: actor.sha256, actorMotion, actorMotionStartFrame,
          ...(actorMotionCueText ? { actorMotionCueText } : {}) } : {}), shapes, meshes,
        depth: number(node.depth ?? 0, -4, 4, 'depth'),
        layout: { landscape: pose(node.layout?.landscape, `${sentence.id}/${node.id}.landscape`), portrait: pose(node.layout?.portrait, `${sentence.id}/${node.id}.portrait`) } };
    });
    const tracks = normalizeAnimationTracks(item.tracks, nodes, sentences, fps);
    const hasActorMotion = nodes.some(node => node.actorId && node.actorMotion !== 'Idle');
    if ((!Array.isArray(item.motions) || !item.motions.length) && !tracks.length && !hasActorMotion || (item.motions || []).length > 32) fail('ações narrativas ausentes ou excessivas');
    const motions = (item.motions || []).map(motion => {
      if (!ids.has(motion.targetId)) fail('ação sem alvo');
      if (!motion.cueText || !clean(sentence.text).includes(clean(motion.cueText))) fail('ação sem cue literal');
      if (!['move', 'draw', 'reveal', 'rotate', 'scale'].includes(motion.kind)) {
        const kind = /^[a-zA-Z_-]{1,30}$/.test(String(motion.kind || '')) ? motion.kind : 'inválida';
        fail(`motions.kind ${kind} desconhecido; use move, draw, reveal, rotate ou scale; opacity usa tracks.property, não motions.kind`);
      }
      const timedFrame = narrativeLabelCueFrame(motion.cueText, sentence);
      const startFrame = Math.min(sentence.endFrame - 2, (timedFrame ?? sentence.startFrame) + Math.round(number(motion.delaySeconds ?? 0, 0, 2, 'delaySeconds') * fps));
      const duration = Math.round(number(motion.durationSeconds ?? 1.2, .15, 6, 'durationSeconds') * fps);
      const result = { targetId: motion.targetId, cueText: motion.cueText, kind: motion.kind, startFrame,
        durationSeconds: motion.durationSeconds ?? 1.2, delaySeconds: motion.delaySeconds ?? 0,
        endFrame: Math.min(sentence.endFrame - 1, startFrame + duration), cueAlignment: timedFrame === null ? 'sentence-boundary' : 'word' };
      if (motion.kind === 'move') result.to = { landscape: pose(motion.to?.landscape, `${sentence.id}/${motion.targetId}.to.landscape`), portrait: pose(motion.to?.portrait, `${sentence.id}/${motion.targetId}.to.portrait`) };
      if (motion.kind === 'rotate') result.amount = number(motion.amount, -360, 360, 'amount', `${sentence.id}/${motion.targetId}.rotate`);
      if (motion.kind === 'scale') result.amount = number(motion.amount, .05, 3, 'amount', `${sentence.id}/${motion.targetId}.scale`);
      return result;
    });
    if (dimension === '2d' && tracks.some(track => track.property !== 'opacity' || track.meshIndex != null || track.targetId === 'camera')) fail('trilha espacial requer cena 3D');
    if (dimension === '3d' && nodes.some(node => !node.meshes.length && !node.actorId)) fail('cena 3D precisa de malhas ou ator humano licenciado em cada parte');
    if (/\b(pessoa|pessoas|homem|mulher|mulheres|homens|algu[eé]m|fam[ií]lia|paciente|profissional|trabalhador|trabalhadora|pesquisador|pesquisadora|operador|operadora|motorista|cliente|morador|moradora|volunt[aá]rio|volunt[aá]ria|crian[cç]a|estudante|aluno|aluna|astronauta|m[eé]dico|m[eé]dica|enfermeiro|enfermeira|cientista|equipe)\b/i.test(sentence.text)
      && !nodes.some(node => node.actorId)) fail('a narração menciona pessoas; incluir ator humano detalhado no plano 3D');
    if (nodes.some(node => node.actorId) && dimension !== '3d') fail('atores humanos exigem ilustração 3D');
    const cameras = {};
    for (const aspect of ['landscape', 'portrait']) {
      const camera = item.camera?.[aspect];
      if (camera) cameras[aspect] = { position: vector(camera.position, [0, 2.6, 15], -24, 24, `${sentence.id}/${aspect}.camera.position`),
        target: vector(camera.target, [0, 0, 0], -12, 12, `${sentence.id}/${aspect}.camera.target`), fov: number(camera.fov ?? 34, 20, 65, 'fov') };
    }
    const spatialChecks = normalizeSpatialChecks(item.spatialChecks, nodes);
    if (spatialChecks.length && dimension !== '3d') fail('spatialChecks requer cena 3D');
    const illustration = { version: 3, dimension, cueSentenceId: sentence.id, explanation: item.explanation, nodes, motions, tracks, camera: cameras, spatialChecks };
    assertSpatialChecks(illustration, sentence);
    return illustration;
  });
}

function illustrationPrompt() {
  return `
DIREÇÃO ADAPTATIVA — campo illustrations obrigatório em cada cena:
Os pictogramas e as ações antigas são metadados. O desenho principal vem de illustrations, uma composição original POR FRASE. Interprete cenário, sujeitos, mecanismo, causa e consequência; não procure um template de assunto. Mar, costa, edifícios, moléculas, órgãos, chips, modelos matemáticos e qualquer outra forma podem ser desenhados com shapes SVG. Não use um computador ou envelope se a fala não precisar deles. Não copie exemplos anteriores.
Schema de illustrations: [{cueSentenceId, explanation: "como o desenho explica exatamente a fala", nodes: [{id, evidence: "trecho literal desta frase que sustenta esta parte", label: "rótulo literal curto ou vazio", layout: {landscape:{x,y,scale,rotate},portrait:{x,y,scale,rotate}}, shapes:[{type:"path",d:"M...",fill:"#95d7bc",stroke:"#e9eee0",strokeWidth:2}]}], motions:[{targetId,cueText:"palavra ou trecho literal pronunciado",kind:"move",durationSeconds:1.5,to:{landscape:{x,y,scale,rotate},portrait:{x,y,scale,rotate}}}]}].
DESENHO: plano útil inteiro 1100x650 horizontal / 900x730 vertical, já separado de título, legenda e robô. Coordenadas de layout normalizadas .02–.98 dentro desse plano. Cada node tem origem no seu centro; shapes usam coordenadas locais em pixels -300 a +300. Use camadas em ordem de fundo para frente, silhuetas reconhecíveis, volumes com sombra e luz, detalhes funcionais e composição com escala. 2–32 nodes por frase, até 100 shapes por node. Separe partes móveis (onda, gota, ponteiro, corrente, raiz, sinal) do cenário fixo. Nenhum cartão genérico alinhado. Paleta petróleo #163b3e, creme #f3eee0, verde #95d7bc, azul #75baca, âmbar #ecb47e; outras cores hex coerentes permitidas.
PRIMITIVAS: rect(x,y,width,height,rx), ellipse(cx,cy,rx,ry), path(d), line(x1,y1,x2,y2), com fill/stroke hex ou none, strokeWidth, opacity. Texto somente em label literal. Um node pode usar prop (computer,phone,server,envelope,fridge,document,parcel,wallet,building) em vez de shapes quando esse objeto é precisamente o da fala. Props são atalhos opcionais, nunca o limite criativo. Para qualquer outro objeto, desenhe shapes próprios. Pessoas nunca são ícones ou primitivas: quando uma pessoa/grupo atua ou é mencionada, use actorId de um perfil humano licenciado no catálogo abaixo, em uma cena 3D. O ator é fictício/ilustrativo e não identifica uma pessoa real. Não introduza URLs, imagens externas, HTML ou código executável.
ATORES HUMANOS LOCAIS (cache versionado, sem site/Mixamo por vídeo): ${JSON.stringify(ACTOR_CATALOG.actors.map(actor => ({ id: actor.id, heightMeters: actor.heightMeters, animations: actor.animations })))}. Use actorMotion Idle, Walk, Carry idle, Carry walk ou Use / press, escolhendo só um clip listado para o perfil. Para clips diferentes de Idle, forneça actorMotionCueText copiado da narração; o código alinha o clip à fala. Em 3D, use nodes no formato {id,evidence,label,actorId,actorMotion,actorMotionCueText,layout:{landscape:{x,y,scale,rotate},portrait:{x,y,scale,rotate}}}; não envie meshes/shapes/prop para o node humano. Em humanos, y representa o contato dos pés com o piso; escala e enquadramento devem deixar corpo inteiro visível nos dois formatos. O modelo só pode atuar com clip compatível; movimento de cenário/objetos continua independente.
MOVIMENTO: move altera a posição até to; draw revela o traçado; reveal traz uma parte antes oculta; rotate exige amount numérico em graus entre -360 e 360; scale exige amount numérico entre .05 e 3 (multiplicador, nunca vetor e nunca omitido). Todas as ações começam na cueText real da narração, durationSeconds .15–6, delaySeconds opcional 0–2. Ao menos uma ação explicativa por frase; não conte entrada decorativa como explicação. Faça mudanças acontecerem no objeto certo, incluindo percurso e estado final; o cenário continua visível. Composição diferente nos dois formatos; vertical empilha causa e consequência quando necessário.
FIDELIDADE: evidence e cueText são trechos exatos desta frase. Geometria é ilustração, não medição. Não invente quantidade, localização, porcentagem ou resultado; preserve negações, hipóteses e incerteza. Esquema de LLM é representação conceitual, não arquitetura alegadamente real. Ilustração de desastre não inventa mapa/geografia nem vítimas. A notícia pode pedir fonte identificada; nunca simule prova fotográfica.
CENAS 3D: use dimension:"3d" quando volume, profundidade, estrutura interna ou percurso espacial ajudam a explicação; pessoas sempre exigem esta dimensão e um actorId do catálogo (não as represente com malhas primitivas). Em 3d cada node sem actorId usa meshes em vez de shapes/prop: [{type:"box"|"sphere"|"cylinder"|"cone"|"torus"|"tube",color:"#95d7bc",position:[x,y,z],size:[sx,sy,sz],rotation:[rx,ry,rz],opacity:1,metalness:.15}]. Unidades 3D locais; cena útil x=-6..6,y=-3.5..3.5, câmera em [0,3,14] olhando para origem. Nodes continuam usando layout normalizado (x,y), scale e depth (-4..4). Mesh position local -8..8, size .01..12, rotation em radianos entre -6.3 e 6.3 em cada eixo. Box size largura/altura/profundidade; sphere elipsoide size; cylinder/cone dimensões xyz; torus raio .5 e tubo .12 escalados por size; tube points:[[x,y,z],...] define curva e size[0] é raio. Luz, sombras e materiais são aplicados pelo motor. Não esconda toda a ação dentro de um bloco opaco: corte esquemático, partes afastadas ou transparência justificável. 3D também precisa de ações em cues e composição vertical própria. Não desenhe um chip só porque 3D está disponível; escolha a forma do tema narrado.
REFERÊNCIAS DE COLISÃO: humano actorId usa {nodeId:"ID do humano"} SEM meshIndex, pois sua malha é interna e o verificador usa o volume do catálogo. Um node com meshes usa {nodeId:"ID do objeto",meshIndex:0}, com índice real de uma box, sphere ou cylinder. Cada subject precisa de obstacles não vazios, sem referência a si mesmo; inclua os sólidos relevantes ao percurso. spatialChecks fica na composição que contém esses nodes. Deslocamento físico usa tracks position3d, não motions move no mesmo node checado; movimentos e colisões de câmera não precisam de spatialChecks.
Perfis 3D próprios: type:"extrude", points:[[x,y,0],...] (polígono fechado, até 40 pontos), size:[escalaX,escalaY,profundidade] cria geometria volumétrica original. camera opcional por formato: {landscape:{position:[x,y,z],target:[x,y,z],fov:34},portrait:{...}}. Use cenário, piso/superfícies, luz e composição espacial, não apenas objetos isolados. Vista ampla para estabelecer espaço e detalhes que expliquem o mecanismo.
ANIMAÇÃO CONTÍNUA: mova e articule partes; mover o bloco inteiro ou revelar peças não basta para representar uma ação. Use tracks:[{targetId,meshIndex opcional,property:"position3d"|"rotation3d"|"scale3d"|"opacity",keyframes:[{cueSentenceId,boundary:"word",cueText:"palavra literal",offsetSeconds:0,value:[x,y,z],easing:"linear"}]}]. boundary também aceita start/end da frase. Dois ou mais estados por trilha, em tempos crescentes; trilhas usam o tempo GLOBAL do capítulo e continuam entre frases. position3d é deslocamento local em unidades 3D, rotation3d é rotação adicional em radianos, scale3d é multiplicador XYZ; opacity usa um número 0–1. meshIndex anima uma peça em torno de sua própria origem; omitir anima o objeto inteiro. Curvas linear/smooth/ease-in/ease-out. Para giro contínuo, use ângulo acumulado (por exemplo 0 a 30 radianos) e linear, sem reset ao mudar legenda. Para queda, acelere até o contato e descreva ressalto/acomodação em estados seguintes. Para empurrar/abrir/dobrar/quebrar, separe as peças e faça cada uma mudar posição/rotação/escala. Respeite contato e causalidade, não acrescente destruição se a fala não a afirma. Câmera também pode usar targetId:"camera", property position3d ou target3d. Objetos persistentes podem ter evidenceSentenceId de outra frase deste capítulo. Mantenha IDs e trilhas ao continuar o mesmo ambiente. A cada ação narrada deve corresponder movimento visível e um estado final claro.
LIMITES DAS TRILHAS: até 128 tracks e 64 keyframes por track; offsets -12 a 12 segundos relativos à cue. Posição/target entre -24 e 24, escala .001–10; rotação acumulada em radianos -1000..1000. A curva no keyframe controla o trecho que chega a ele. Posição e target da câmera também são deslocamentos somados à câmera própria de cada formato. Não use ID camera em nodes: é reservado à câmera. Trilha espacial exige dimension 3d; em 2d somente opacity por node é aceita. Mantenha objetos afastados o suficiente para não atravessarem uns aos outros e preserve o resultado de cada ação, sem saltar ao estado inicial na próxima frase.
TIPOS DE VALUE: tracks property opacity usa value:0 ou value:1 (um número entre 0 e 1, NUNCA vetor). position3d, rotation3d, scale3d e target3d usam value:[x,y,z]. A opacity base de mesh deve ficar entre 0.1 e 1; para ocultar uma peça, use uma trilha opacity com value:0, sem colocar opacity:0 na malha. motions.kind aceita APENAS move, draw, reveal, rotate, scale; opacity, fade, translate e transform não são kinds de motions.
`;
}
module.exports = { normalizeIllustrations, illustrationPrompt };
