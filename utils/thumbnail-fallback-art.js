'use strict';

const ART_RULES = Object.freeze([
  ['medicine', /\b(?:canetas?|emagre\w*|ozempic|wegovy|mounjaro|medic\w*|remed\w*|diabetes|saude|hospital|doenca|sintomas?)\b/],
  ['fitness', /\b(?:fitness|treino|exercicio|academia|muscul\w*|esporte|corrida|atleta)\b/],
  ['shopping', /\b(?:compr\w*|consumidor\w*|supermercad\w*|carrinho|varej\w*)\b/],
  ['psychology', /\b(?:psicolog\w*|comportamento|ansiedade|cerebro|mente|emoc\w*|cognitiv\w*)\b/],
  ['relationships', /\b(?:relacion\w*|namoro|casamento|casal|filhos?|familia|amor)\b/],
  ['savings', /\b(?:mesada|poupar|economiz\w*|desconto|contas?|orcamento|barat\w*)\b/],
  ['career', /\b(?:vagas?|empreg\w*|trabalho|profissao|carreira|curriculo|sine|salario)\b/],
  ['money', /\b(?:dinheiro|inflacao|precos?|economia|mercado|invest\w*|acoes|bolsa|bilhoes?|financas?)\b/],
  ['technology', /\b(?:ia|inteligencia artificial|openai|anthropic|robos?|modelos?|algoritmos?|tecnolog\w*|software)\b/],
  ['mystery', /\b(?:mister\w*|segredo|descobert\w*|curios\w*|espaco|universo|cientistas?|historia)\b/]
]);

function normalizeTopic(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function classifyThumbnailConcept({ topic = '', title = '', hook = '' } = {}) {
  const source = normalizeTopic(`${topic} ${title} ${hook}`);
  return ART_RULES.find(([, pattern]) => pattern.test(source))?.[0] || 'curiosity';
}

function iconFor(concept, accent) {
  const light = '#eef7ff';

  switch (concept) {
    case 'medicine':
      return `<g transform="rotate(-27 520 360)" filter="url(#soft-shadow)">
        <rect x="285" y="284" width="448" height="148" rx="72" fill="url(#metal)"/>
        <rect x="332" y="304" width="264" height="108" rx="34" fill="#101a2a"/>
        <rect x="365" y="329" width="132" height="58" rx="18" fill="${accent}"/>
        <rect x="379" y="340" width="98" height="10" rx="5" fill="#ffffff" opacity=".78"/>
        <rect x="379" y="361" width="70" height="8" rx="4" fill="#ffffff" opacity=".38"/>
        <path d="M516 317v82m20-82v82m20-82v82m20-82v82" stroke="#b8c8d3" stroke-width="5" opacity=".5"/>
        <rect x="710" y="307" width="89" height="102" rx="31" fill="url(#grip)"/>
        <path d="M799 330h53a22 22 0 0 1 0 56h-53z" fill="#d5e0e8"/>
        <path d="M852 342h54v32h-54" fill="#7c8c99"/>
        <path d="M906 350h32v16h-32" fill="#e2edf4"/>
        <rect x="275" y="321" width="46" height="73" rx="19" fill="#17283a"/>
        <path d="M320 300h348" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".68"/>
        <path d="M360 424h305" stroke="#31445a" stroke-width="8" stroke-linecap="round" opacity=".7"/>
      </g>`;
    case 'money':
      return `<g filter="url(#soft-shadow)">
        <path d="M260 548h550" stroke="#dce9f2" stroke-width="18" stroke-linecap="round" opacity=".76"/>
        <rect x="318" y="360" width="106" height="188" rx="18" fill="url(#metal)"/>
        <rect x="460" y="360" width="106" height="188" rx="18" fill="url(#metal)"/>
        <rect x="602" y="360" width="106" height="188" rx="18" fill="url(#metal)"/>
        <path d="M305 290h410" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round" stroke-dasharray="28 18"/>
        <circle cx="354" cy="383" r="53" fill="${accent}" stroke="#ffe6a6" stroke-width="10"/>
        <circle cx="354" cy="383" r="29" fill="none" stroke="#fff5d6" stroke-width="7" opacity=".86"/>
      </g>`;
    case 'technology':
      return `<g filter="url(#soft-shadow)" stroke-linecap="round" stroke-linejoin="round">
        <path d="M450 230v-84m0 0h-83m83 0h85m-85 84v-50m0 0h-132m132 0h132M340 570v-88m0 0h110m-110 0h-92m352 88v-88m0 0H490m110 0h92" fill="none" stroke="${accent}" stroke-width="18" opacity=".82"/>
        <rect x="335" y="244" width="330" height="310" rx="56" fill="url(#metal)"/>
        <rect x="382" y="291" width="236" height="216" rx="38" fill="#111b2a" stroke="${accent}" stroke-width="12"/>
        <path d="M500 332c-56 0-91 34-91 82 0 42 29 69 72 69 58 0 112-47 112-104 0-30-24-47-54-47-23 0-47 10-66 31" fill="none" stroke="${accent}" stroke-width="21"/>
        <circle cx="500" cy="414" r="19" fill="${light}"/>
        <circle cx="367" cy="146" r="18" fill="${light}"/><circle cx="535" cy="146" r="18" fill="${light}"/>
        <circle cx="208" cy="482" r="18" fill="${light}"/><circle cx="692" cy="482" r="18" fill="${light}"/>
        <circle cx="340" cy="570" r="18" fill="${light}"/><circle cx="600" cy="570" r="18" fill="${light}"/>
      </g>`;
    case 'fitness':
      return `<g transform="rotate(-24 500 360)" filter="url(#soft-shadow)">
        <rect x="432" y="315" width="260" height="90" rx="42" fill="url(#metal)"/>
        <rect x="320" y="245" width="126" height="230" rx="32" fill="${accent}"/>
        <rect x="676" y="245" width="126" height="230" rx="32" fill="${accent}"/>
        <rect x="289" y="281" width="60" height="158" rx="24" fill="url(#metal)"/>
        <rect x="773" y="281" width="60" height="158" rx="24" fill="url(#metal)"/>
        <path d="M364 274v172m456-172v172" stroke="#fff" stroke-width="10" opacity=".54"/>
        <path d="M210 520c92 54 176 54 252 0m110 0c76 54 160 54 252 0" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round" opacity=".6"/>
      </g>`;
    case 'shopping':
      return `<g filter="url(#soft-shadow)" stroke-linecap="round" stroke-linejoin="round">
        <path d="M260 238h84l48 252h339l76-190H368" fill="none" stroke="url(#metal)" stroke-width="34"/>
        <path d="m398 324 332 1-48 120H420Z" fill="${accent}" opacity=".2" stroke="${accent}" stroke-width="13"/>
        <path d="M434 349v68m83-68v68m82-68v68" stroke="#eef7ff" stroke-width="13" opacity=".78"/>
        <path d="M451 324v-47c0-22 18-40 40-40h32c22 0 40 18 40 40v47" fill="none" stroke="#eef7ff" stroke-width="16"/>
        <circle cx="445" cy="541" r="39" fill="#101a2a" stroke="${accent}" stroke-width="15"/>
        <circle cx="681" cy="541" r="39" fill="#101a2a" stroke="${accent}" stroke-width="15"/>
        <path d="m475 302 42-61 40 61m48 1 39-46 38 46" fill="none" stroke="#eef7ff" stroke-width="18"/>
        <circle cx="517" cy="241" r="12" fill="${accent}"/><circle cx="596" cy="257" r="12" fill="${accent}"/><circle cx="644" cy="256" r="12" fill="${accent}"/>
      </g>`;
    case 'psychology':
      return `<g filter="url(#soft-shadow)">
        <path d="M505 186c-132 0-230 92-230 220 0 78 35 143 96 179l-8 89 117-54 64 14c119-10 198-98 198-220 0-131-96-228-237-228Z" fill="url(#metal)"/>
        <path d="M522 256c-97 0-169 68-169 158 0 40 15 75 42 101l93-27 54 27 70-41 54 7c20-23 31-53 31-89 0-81-70-136-175-136Z" fill="#152236" stroke="${accent}" stroke-width="11"/>
        <path d="m395 389 61-40 55 32 49-50 59 39 38-4m-215 57 67 28 58-42 51 31" fill="none" stroke="${accent}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="395" cy="389" r="17" fill="${light}"/><circle cx="456" cy="349" r="17" fill="${light}"/>
        <circle cx="511" cy="381" r="17" fill="${light}"/><circle cx="560" cy="331" r="17" fill="${light}"/>
        <circle cx="619" cy="370" r="17" fill="${light}"/><circle cx="657" cy="366" r="17" fill="${light}"/>
      </g>`;
    case 'relationships':
      return `<g filter="url(#soft-shadow)">
        <path d="M494 511 309 348c-84-74-28-204 76-194 52 5 82 39 109 83 29-44 61-78 114-83 109-10 161 119 75 194L494 511Z" fill="url(#metal)"/>
        <path d="M494 458 344 326c-55-50-21-128 43-122 46 4 74 45 107 91 31-46 62-87 109-91 64-6 98 72 43 122L494 458Z" fill="${accent}"/>
        <path d="M337 565c105 42 210 42 315 0" fill="none" stroke="${light}" stroke-width="18" stroke-linecap="round" opacity=".74"/>
        <circle cx="300" cy="229" r="18" fill="${light}"/><circle cx="694" cy="229" r="18" fill="${light}"/>
      </g>`;
    case 'savings':
      return `<g filter="url(#soft-shadow)">
        <path d="M292 390c0-98 82-166 204-166 65 0 119 21 155 60l75-11-24 80c13 23 20 48 20 76 0 100-87 170-224 170-130 0-206-68-206-164v-45Z" fill="url(#metal)"/>
        <path d="m351 260-10-86 109 56m197 14 55-76 10 111" fill="${accent}" stroke="#e9f2f8" stroke-width="17" stroke-linejoin="round"/>
        <ellipse cx="617" cy="437" rx="38" ry="27" fill="#101a29"/>
        <circle cx="622" cy="430" r="7" fill="${light}"/>
        <path d="M416 535v39m145-42v42" stroke="#9eafbc" stroke-width="28" stroke-linecap="round"/>
        <path d="M426 341h124" stroke="${accent}" stroke-width="16" stroke-linecap="round"/>
        <circle cx="480" cy="410" r="29" fill="${accent}" stroke="#fff0bb" stroke-width="8"/>
      </g>`;
    case 'career':
      return `<g filter="url(#soft-shadow)">
        <rect x="444" y="172" width="263" height="358" rx="32" fill="url(#metal)" transform="rotate(8 575 351)"/>
        <path d="M503 270h146m-138 66h150m-141 66h96" stroke="#8092a2" stroke-width="17" stroke-linecap="round"/>
        <rect x="275" y="356" width="394" height="236" rx="40" fill="${accent}"/>
        <path d="M407 356v-55a45 45 0 0 1 45-45h76a45 45 0 0 1 45 45v55" fill="none" stroke="${light}" stroke-width="25"/>
        <path d="M277 433c111 73 277 73 389 0v90c-111 76-278 76-389 0Z" fill="#183047" opacity=".76"/>
        <rect x="440" y="438" width="70" height="42" rx="14" fill="${light}"/>
      </g>`;
    case 'mystery':
    case 'curiosity':
    default:
      return `<g transform="rotate(-14 500 360)" filter="url(#soft-shadow)">
        <circle cx="490" cy="352" r="188" fill="url(#metal)"/>
        <circle cx="490" cy="352" r="128" fill="#111c2b" stroke="${accent}" stroke-width="17"/>
        <circle cx="490" cy="352" r="78" fill="${accent}" opacity=".22"/>
        <path d="m585 474 182 170" stroke="url(#metal)" stroke-width="62" stroke-linecap="round"/>
        <path d="m610 493 142 132" stroke="${accent}" stroke-width="17" stroke-linecap="round" opacity=".8"/>
        <path d="M432 352h116m-58-58v116" stroke="${light}" stroke-width="20" stroke-linecap="round" opacity=".8"/>
      </g>`;
  }
}

function buildThumbnailFallbackArt({ topic = '', title = '', hook = '', accent = '#60A5FA' } = {}) {
  const concept = classifyThumbnailConcept({ topic, title, hook });
  const safeAccent = /^#[0-9a-f]{6}$/i.test(String(accent)) ? accent : '#60A5FA';
  return `<svg class="hero fallback-illustration" data-concept="${concept}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 720" role="img" aria-label="Ilustração editorial temática" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id="fallback-glow"><stop offset="0" stop-color="${safeAccent}" stop-opacity=".6"/><stop offset="1" stop-color="${safeAccent}" stop-opacity="0"/></radialGradient>
      <linearGradient id="metal" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#ffffff"/><stop offset=".38" stop-color="#b8c8d4"/><stop offset=".68" stop-color="#eef6fa"/><stop offset="1" stop-color="#728697"/></linearGradient>
      <linearGradient id="grip" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${safeAccent}"/><stop offset="1" stop-color="#15283b"/></linearGradient>
      <filter id="soft-shadow" x="-.3" y="-.3" width="1.6" height="1.7"><feGaussianBlur in="SourceAlpha" stdDeviation="18" result="blur"/><feOffset dy="20" result="offset"/><feComponentTransfer><feFuncA type="linear" slope=".55"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <ellipse cx="520" cy="367" rx="425" ry="405" fill="url(#fallback-glow)"/>
    <circle cx="520" cy="360" r="294" fill="none" stroke="${safeAccent}" stroke-opacity=".26" stroke-width="4"/>
    <circle cx="520" cy="360" r="346" fill="none" stroke="${safeAccent}" stroke-opacity=".12" stroke-width="18"/>
    <ellipse cx="520" cy="636" rx="252" ry="36" fill="#02050a" opacity=".64"/>
    ${iconFor(concept, safeAccent)}
    <path d="M118 588c82 48 168 47 244-3" fill="none" stroke="${safeAccent}" stroke-opacity=".5" stroke-width="7" stroke-linecap="round"/>
  </svg>`;
}

module.exports = { buildThumbnailFallbackArt, classifyThumbnailConcept };
