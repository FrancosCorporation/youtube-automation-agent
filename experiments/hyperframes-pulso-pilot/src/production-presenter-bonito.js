import { createBonitoPresenter } from './presenter-bonito.js';
import designTokens from '../../../utils/visual-design-tokens.js';

const { VISUAL_DESIGN_TOKENS } = designTokens;
const config=window.PULSO_ROBOT_CONFIG||{};
const duration=Math.max(.1,Number(config.durationSeconds)||1),envelope=config.speechEnvelope||{};
function levelAt(t){const levels=envelope.levels||[],pos=t*1000/(envelope.stepMs||10);if(pos<0||pos>=levels.length)return 0;const i=Math.floor(pos),f=pos-i;return (levels[i]||0)*(1-f)+(levels[i+1]||0)*f;}
window.__hf=window.__hf||{};window.__hf.buildReady=window.__hf.buildReady||{};
const accents=Array.isArray(config.accents)&&config.accents.length?config.accents:VISUAL_DESIGN_TOKENS.presenter.fallbackAccents;
window.__hf.buildReady.presenter=createBonitoPresenter({canvas:document.getElementById('three-layer'),assetUrl:config.assetUrl||'assets/pulso-robot.glb',accents,duration,seed:config.seed,mouthCues:config.mouthCues}).then(p=>{
 window.pulsoPresenter=p;window.seekPresenterRobot=t=>{const s=Math.min(duration,Math.max(0,Number(t)||0));p.renderAt(s,levelAt(s));};
 window.setPresenterFraming=name=>p.setFraming(name);window.disposePresenterRobot=()=>p.dispose();window.__pulsoPresenterReady=true;
}).catch(e=>{window.__pulsoPresenterError=String(e.stack||e);throw e;});
