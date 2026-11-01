'use strict';

const NICHE_GUIDANCE = Object.freeze({
  ia: 'Explique o que mudou para a pessoa comum, o que a ferramenta realmente faz e uma limitação verificável; diferencie anúncio, demonstração e disponibilidade real.',
  curiosidades: 'Transforme a curiosidade em compreensão: explique o mecanismo ou contexto comprovado e separe fato confirmado de hipótese.',
  dinheiro: 'Explique o mecanismo econômico e seus trade-offs; separe dado de interpretação e não prometa riqueza, retorno ou resultado financeiro.',
  saude: 'Priorize evidência e contexto: não diagnostique, prescreva nem universalize resultados; diferencie associação, hipótese e causalidade.',
  economize: 'Entregue uma verificação prática de preço, condição ou alternativa apenas quando a fonte sustentar; não prometa economia nem omita taxas/limites mencionados.',
  psicologia: 'Explique comportamento sem diagnosticar espectadores ou transformar um estudo limitado em regra universal.',
  relacionamentos: 'Trate relações com nuance e respeito; não rotule pessoas, não dê certezas universais e não use insegurança como isca.',
  fitness: 'Explique treino e evidência com limites e contexto; não prometa transformação, prescreva plano individual ou confunda estudo com garantia.',
  misterios: 'Separe cronologia documentada, versões e lacunas; não apresente especulação como solução ou fato.',
  carreira: 'Dê orientação contextualizada e aplicável quando apoiada pela fonte; não prometa emprego, salário ou sucesso.'
});

const FOLLOW_UP_METRICS = Object.freeze({
  youtube: ['visualizações observadas', 'engaged views/tempo assistido e retenção quando disponíveis', 'inscritos ganhos por vídeo quando a Analytics API fornecer'],
  shorts: ['visualizações e engaged views', 'retenção/tempo assistido', 'inscritos ganhos atribuídos quando disponíveis'],
  instagram: ['alcance e tempo médio assistido', 'salvamentos e compartilhamentos', 'seguidores atribuídos ao Reel se Insights disponibilizar'],
  kwai: ['visualizações e completion rate', 'compartilhamentos/comentários', 'seguidores atribuídos se o Creator Center exibir']
});

function audienceGrowthGuidance(themeId) {
  const niche = NICHE_GUIDANCE[themeId] || 'Entregue contexto útil e específico para o público do tema sem extrapolar a fonte.';
  return `OBJETIVO EDITORIAL — descoberta e crescimento com valor real, sem prometer alcance. ${niche}
RETENÇÃO E UTILIDADE: trate os primeiros 1–3 segundos como o gancho já definido; diga claramente o assunto e a pergunta/benefício que será resolvido. Cada seção e mudança visual precisa acrescentar informação ou facilitar compreensão. Remova preenchimento. Construa uma ideia que mereça ser salva ou enviada somente quando houver utilidade, identidade, relevância emocional, surpresa ou problema resolvido sustentados pelo conteúdo; não peça salvamento/compartilhamento de forma artificial. Curiosidade precisa ser paga dentro do próprio vídeo.
CTA: use no máximo uma chamada curta e natural depois de entregar o valor. Convide a acompanhar o canal apenas se houver continuidade editorial concreta; caso contrário encerre sem pedir follow/like/comentário. Não invente urgência, benefício ou resultado.
MEDIÇÃO: formatId identifica uma hipótese editorial, não um vencedor. Mudanças de tema, gancho, estrutura, visual e CTA devem ser testadas em publicações distintas, com uma variável principal registrada. Métrica ausente é indisponível; não deduza seguidores, retenção ou causalidade de views. Use apenas métricas que a API/Insights oficial deste destino fornece, e só atribua seguidores ao vídeo quando a própria plataforma fizer essa atribuição.`;
}

module.exports = { NICHE_GUIDANCE, FOLLOW_UP_METRICS, audienceGrowthGuidance };
