import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const name=process.argv[2]||'robo-bonito-temas';
if(!['robo-bonito-temas','robo-bonito-temas-v3'].includes(name))throw Error('Unknown variant');
const gallery=path.join(root,'variants',name,'gallery');
const palettes=JSON.parse(await readFile(path.join(gallery,'manifest.json'),'utf8'));
const choices=palettes.map(p=>`<option value="${p.id}">${p.brand}</option>`).join('');
const data=JSON.stringify(palettes).replaceAll('<','\\u003c');
const overview=palettes.map(p=>`<button class="sample" type="button" data-theme="${p.id}" style="--sample-color:${p.accents[0]}"><img src="${p.robotImage||p.image}" alt="" loading="lazy"><span>${p.brand}</span><small>${p.colorName||p.accents[0]}</small></button>`).join('');
const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>As cores do Pulso</title>
<style>
:root{color-scheme:dark;--accent:#22D3EE}*{box-sizing:border-box}body{margin:0;background:#0c1420;color:#f3f7fc;font:17px/1.5 system-ui,sans-serif}main{max-width:1160px;margin:auto;padding:30px 22px 60px}h1{font-size:clamp(28px,5vw,44px);margin:0 0 10px;letter-spacing:-.03em}h2{font-size:23px;margin:35px 0 8px}p{color:#b9c9dc;max-width:800px;margin:0 0 20px}.picker{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:22px 0}select{font:inherit;padding:12px 16px;max-width:100%;border:1px solid #526175;border-radius:10px;background:#142131;color:#f3f7fc}.swatch{display:inline-block;width:16px;height:16px;border-radius:50%;background:var(--accent);vertical-align:middle;margin-right:8px}#label{color:var(--accent)}img,video{display:block;width:100%;border-radius:12px;background:#142131}img{height:auto;aspect-ratio:16/9;object-fit:contain}video{aspect-ratio:16/9}a{color:#90dff1}nav{display:flex;flex-wrap:wrap;gap:20px;margin-top:18px}select:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:4px}@media(max-width:550px){main{padding:24px 14px}p{font-size:16px}}
</style><style>
.overview{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:25px 0 30px}.sample{font:inherit;color:#f3f7fc;padding:10px 8px 14px;background:#142131;border:2px solid var(--sample-color);border-radius:12px;cursor:pointer}.sample img{aspect-ratio:1;height:auto;background:transparent;border-radius:0}.sample span,.sample small{display:block}.sample span{font-size:14px;margin-top:8px}.sample small{font-size:13px;color:var(--sample-color)}.sample[aria-pressed="true"]{background:#253b50;box-shadow:0 0 0 2px var(--sample-color)}.sample:focus-visible{outline:3px solid #f1f5f9;outline-offset:3px}@media(max-width:700px){.overview{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><main>
<h1>As cores do Pulso</h1><p>O mesmo personagem, com os olhos, a boca e os detalhes nas cores de cada tema. Escolha uma paleta para comparar.</p>
<div class="overview" aria-label="Comparação das cores por tema">${overview}</div>
<div class="picker"><label for="theme">Tema</label><select id="theme">${choices}</select><span id="label"><span class="swatch"></span><span id="color">Ciano</span></span></div>
<img id="preview" src="ia.png" alt="Robô Pulso no tema Inteligência Artificial" width="1920" height="1080">
<h2>Veja em movimento</h2><p>Teste com a paleta de IA: fala, sorriso, piscadas e gestos.</p>
<video id="video" controls playsinline preload="metadata" poster="ia.png"><source src="../robo-bonito-tema-ia-v2.mp4" type="video/mp4"></video>
<nav><a href="../robo-bonito-tema-ia-v2.mp4">Abrir vídeo horizontal</a><a href="../robo-bonito-tema-ia-v2-vertical.mp4">Abrir vídeo vertical</a><a href="../robo-temas-v2/">Comparar com as cores anteriores</a></nav>
</main><script>
const palettes=${data};const select=document.getElementById('theme');
function update(){const p=palettes.find(p=>p.id===select.value);document.getElementById('preview').src=p.image;document.getElementById('preview').alt='Robô no tema '+p.brand;document.documentElement.style.setProperty('--accent',p.accents[0]);document.getElementById('color').textContent=(p.colorName?p.colorName+' · ':'')+p.accents[0];document.querySelectorAll('.sample').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===p.id)));}
document.querySelectorAll('.sample').forEach(b=>b.addEventListener('click',()=>{select.value=b.dataset.theme;update();}));
select.addEventListener('change',update);update();
</script></body></html>`;
await writeFile(path.join(gallery,'index.html'),html);
console.log('Gallery prepared: 10 palettes and movement preview.');
